/* ==========================================================================
   SyncStatus.jsx — Small pill in the topbar showing sync state.

   States:
     - synced   : all changes pushed, nothing pending
     - syncing  : currently in a sync cycle
     - pending  : we have local changes not yet pushed
     - offline  : last sync failed (Turso unreachable)
     - n/a      : backend doesn't use sync (sqlite/turso/sheets direct)
   ========================================================================== */
(() => {
  'use strict';
  const { useEffect, useState, useCallback } = React;
  const { cn, relativeTime } = window.App.utils;
  const { Icon } = window.App;

  const POLL_MS = 10_000;  // ask the server every 10s

  function SyncStatus() {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);

    const fetchStatus = useCallback(async () => {
      try {
        const r = await window.App.backend.syncStatus();
        setData(r);
      } catch {
        setData({ status: 'offline' });
      }
    }, []);

    useEffect(() => {
      fetchStatus();
      const id = setInterval(fetchStatus, POLL_MS);
      return () => clearInterval(id);
    }, [fetchStatus]);

    const refresh = async () => {
      setBusy(true);
      try {
        const r = await window.App.backend.syncNow();
        setData(r);
      } catch {
        await fetchStatus();
      } finally {
        setBusy(false);
      }
    };

    if (!data) return null;
    // Backend doesn't use hybrid — hide the pill
    if (data.status === 'n/a') return null;

    const pending = (data.pending_pos || 0) + (data.pending_users || 0);
    const stuck = (data.stuck_pos || 0) + (data.stuck_users || 0);
    const isSyncing = busy || data.status === 'running';
    const isError = data.status === 'error';
    const finishedAt = data.finished_at;

    let tone = 'success';
    let label = 'Synced';
    let icon = 'check-circle';

    if (isSyncing) { tone = 'info';    label = 'Syncing…';     icon = 'rotate-cw'; }
    else if (stuck > 0) { tone = 'danger'; label = `${stuck} stuck`; icon = 'alert-triangle'; }
    else if (isError) { tone = 'danger'; label = 'Sync failed'; icon = 'alert-triangle'; }
    else if (pending > 0) { tone = 'warning'; label = `${pending} pending`; icon = 'inbox'; }

    return (
      <button
        type="button"
        className={cn('sync-pill', `sync-pill-${tone}`, isSyncing && 'spinning')}
        onClick={refresh}
        title={
          isError
            ? (data.error || 'Sync failed — click to retry')
            : pending > 0
              ? `${pending} local change${pending === 1 ? '' : 's'} not yet pushed. Click to sync now.`
              : finishedAt
                ? `Last sync ${relativeTime(finishedAt)}. Click to refresh.`
                : 'Click to sync now'
        }
        disabled={busy}
      >
        <Icon name={icon} size={12} />
        <span>{label}</span>
        {finishedAt && !isSyncing && !isError && pending === 0 && (
          <span className="sync-pill-time">{relativeTime(finishedAt)}</span>
        )}
      </button>
    );
  }

  window.App = window.App || {};
  window.App.SyncStatus = SyncStatus;
})();
