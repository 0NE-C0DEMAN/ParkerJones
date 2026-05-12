"""
sync_engine.py — Bidirectional sync between local SQLite (db_local) and
Turso cloud (db_turso). Runs as a background thread spawned by db_hybrid.

Algorithm:
    Every SYNC_INTERVAL_SECONDS:
        push_outbox(): users first → POs (FK order)
            For each outbox entry:
              - Read current local row state
              - Upsert into Turso (LWW: only overwrite if our updated_at is newer)
              - On success: delete the outbox row if its queued_at hasn't changed
                (avoids deleting a NEW edit that landed mid-push)
              - On failure: attempts++, last_error stored
        pull_remote(): users first → POs
            For each remote row newer than last_pull_at:
              - Upsert into local via LWW (`db_local.upsert_*_from_remote`)
            Advance last_pull_at to max(remote.updated_at) of returned rows.

Robustness:
    - _do_sync is serialized via a threading.Lock — manual + bg can't collide
    - _loop catches every exception and keeps going
    - Skip-after-MAX_ATTEMPTS surfaces as `stuck_pos` / `stuck_users` in status()
"""
from __future__ import annotations

import os
import sys
import threading
import time
import traceback
from datetime import datetime
from typing import Optional

import db_local
import db_turso


SYNC_INTERVAL_SECONDS = int(os.environ.get("FOUNDRY_SYNC_INTERVAL_SECONDS", "30"))
MAX_ATTEMPTS = 5  # outbox entries past this stop trying but stay queued (visible as "stuck")

_thread: Optional[threading.Thread] = None
_stop = threading.Event()
_sync_lock = threading.Lock()       # serializes _do_sync — bg loop & manual call can't collide
_last_run_lock = threading.Lock()
_last_run: dict = {
    "started_at": None,
    "finished_at": None,
    "status": "idle",        # idle | running | ok | error
    "error": None,
    "pushed": 0,
    "pulled": 0,
    "consecutive_errors": 0,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def start_background_thread() -> None:
    """Start the sync thread if it isn't already running."""
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True, name="foundry-sync")
    _thread.start()
    print("[sync] background thread started", file=sys.stderr)


def stop_background_thread() -> None:
    _stop.set()


def sync_now() -> dict:
    """Run one full sync cycle synchronously and return the result."""
    return _do_sync()


def status() -> dict:
    """Snapshot of the most recent sync attempt + current queue depth."""
    with _last_run_lock:
        snap = dict(_last_run)
    snap["pending_pos"] = db_local.pending_po_count()
    snap["pending_users"] = db_local.pending_user_count()
    # Count entries that have failed too many times (visible as "stuck")
    snap["stuck_pos"] = _count_stuck(db_local.outbox_pos_pending())
    snap["stuck_users"] = _count_stuck(db_local.outbox_users_pending())
    snap["last_pull_pos_at"] = db_local.get_state("last_pull_pos_at")
    snap["last_pull_users_at"] = db_local.get_state("last_pull_users_at")
    snap["sync_interval_seconds"] = SYNC_INTERVAL_SECONDS
    return snap


# ---------------------------------------------------------------------------
# Background loop (always-on, error-resilient)
# ---------------------------------------------------------------------------

def _loop():
    """Keeps running for the life of the process. Catches everything so a
    bad sync cycle never silently kills the thread."""
    while not _stop.is_set():
        try:
            _do_sync()
        except Exception as e:
            # Belt-and-suspenders — _do_sync should catch its own, but if not, log + continue
            print(f"[sync] loop caught fatal: {e}\n{traceback.format_exc()}", file=sys.stderr)
            time.sleep(5)
        _stop.wait(SYNC_INTERVAL_SECONDS)


def _do_sync() -> dict:
    # Serialize: bg loop + manual sync_now can't run concurrently.
    if not _sync_lock.acquire(blocking=False):
        # A sync is already in flight; return the most recent state.
        with _last_run_lock:
            return dict(_last_run)
    try:
        with _last_run_lock:
            _last_run["started_at"] = _now()
            _last_run["status"] = "running"
            _last_run["error"] = None
            _last_run["pushed"] = 0
            _last_run["pulled"] = 0

        try:
            pushed = _push_users() + _push_pos()
            pulled = _pull_users() + _pull_pos()
            with _last_run_lock:
                _last_run["finished_at"] = _now()
                _last_run["status"] = "ok"
                _last_run["pushed"] = pushed
                _last_run["pulled"] = pulled
                _last_run["consecutive_errors"] = 0
            return dict(_last_run)
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[sync] error: {e}\n{tb}", file=sys.stderr)
            with _last_run_lock:
                _last_run["finished_at"] = _now()
                _last_run["status"] = "error"
                _last_run["error"] = str(e)
                _last_run["consecutive_errors"] = (_last_run.get("consecutive_errors") or 0) + 1
            return dict(_last_run)
    finally:
        _sync_lock.release()


# ---------------------------------------------------------------------------
# Push (local outbox → Turso)
# ---------------------------------------------------------------------------

def _push_users() -> int:
    pushed = 0
    for entry in db_local.outbox_users_pending():
        if entry["attempts"] >= MAX_ATTEMPTS:
            continue
        user_id = entry["user_id"]
        queued_at = entry["queued_at"]
        local_row = db_local.raw_user_row(user_id)
        if not local_row:
            db_local.outbox_user_done(user_id, expected_queued_at=queued_at)
            continue
        try:
            db_turso.upsert_user_lww(local_row)
            db_local.outbox_user_done(user_id, expected_queued_at=queued_at)
            pushed += 1
        except Exception as e:
            db_local.outbox_user_failed(user_id, f"{type(e).__name__}: {e}")
            print(f"[sync] push user {user_id} failed: {e}", file=sys.stderr)
    return pushed


def _push_pos() -> int:
    pushed = 0
    for entry in db_local.outbox_pos_pending():
        if entry["attempts"] >= MAX_ATTEMPTS:
            continue
        po_id = entry["po_id"]
        queued_at = entry["queued_at"]
        local_row = db_local.raw_po_row(po_id)
        if not local_row:
            db_local.outbox_po_done(po_id, expected_queued_at=queued_at)
            continue
        try:
            db_turso.upsert_po_full_lww(local_row, local_row.get("line_items") or [])
            db_local.outbox_po_done(po_id, expected_queued_at=queued_at)
            pushed += 1
        except Exception as e:
            db_local.outbox_po_failed(po_id, f"{type(e).__name__}: {e}")
            print(f"[sync] push PO {po_id} failed: {e}", file=sys.stderr)
    return pushed


# ---------------------------------------------------------------------------
# Pull (Turso → local)
# ---------------------------------------------------------------------------

def _pull_users() -> int:
    since = db_local.get_state("last_pull_users_at")
    rows = db_turso.users_since(since)
    n = 0
    high_water = since or ""
    for r in rows:
        d = dict(r)
        ts = d.get("last_login_at") or d.get("created_at") or d.get("deleted_at") or ""
        if ts > high_water:
            high_water = ts
        try:
            verb = db_local.upsert_user_from_remote(d)
            if verb in ("inserted", "updated_local"):
                n += 1
        except Exception as e:
            print(f"[sync] pull user {d.get('id')} failed: {e}", file=sys.stderr)
    if high_water:
        db_local.set_state("last_pull_users_at", high_water)
    return n


def _pull_pos() -> int:
    since = db_local.get_state("last_pull_pos_at")
    rows = db_turso.pos_since(since)
    if not rows:
        return 0
    line_rows = db_turso.line_items_for_pos([r["id"] for r in rows])
    high_water = since or ""
    n = 0
    for r in rows:
        d = dict(r)
        ts = d.get("updated_at") or ""
        if ts > high_water:
            high_water = ts
        po_lines = [ln for ln in line_rows if ln.get("po_id") == d["id"]]
        try:
            verb = db_local.upsert_po_from_remote(d, [dict(ln) for ln in po_lines])
            if verb in ("inserted", "updated_local"):
                n += 1
        except Exception as e:
            print(f"[sync] pull PO {d.get('id')} failed: {e}", file=sys.stderr)
    if high_water:
        db_local.set_state("last_pull_pos_at", high_water)
    return n


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now().isoformat()


def _count_stuck(entries: list[dict]) -> int:
    return sum(1 for e in entries if (e.get("attempts") or 0) >= MAX_ATTEMPTS)
