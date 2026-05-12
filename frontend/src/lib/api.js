/* ==========================================================================
   api.js — HTTP client for the FastAPI backend (port 8503).
   Provides CRUD + Excel export + duplicate detection.
   ========================================================================== */
(() => {
  'use strict';

  const BACKEND_PORT = 8503;
  // Two deployment modes:
  //   1. Streamlit dev (`streamlit run app.py`) — React lives inside a
  //      components.html iframe with `srcdoc=<html>`, so its
  //      window.location.protocol is "about:" — relative URLs are useless
  //      there. Hit the FastAPI subprocess on 127.0.0.1:8503 directly.
  //   2. Production (HF Spaces / any single-port deploy) — FastAPI itself
  //      serves the React HTML at "/", so same-origin relative URLs work
  //      and we don't need to know the host.
  const BASE = (typeof window !== 'undefined'
                && window.location
                && window.location.protocol !== 'about:'
                && window.location.protocol !== 'file:')
    ? ''                                // same-origin (HF Spaces)
    : `http://127.0.0.1:${BACKEND_PORT}`; // Streamlit srcdoc iframe

  async function request(path, opts = {}) {
    const url = BASE + path;
    const authHeaders = window.App?.auth?.authHeader?.() || {};
    let res;
    try {
      res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...authHeaders, ...(opts.headers || {}) },
        ...opts,
      });
    } catch (e) {
      throw new Error(`Backend unreachable at ${BASE}. Is the server running?`);
    }
    if (res.status === 401) {
      // Session expired — clear and reload to land on the login screen.
      window.App?.auth?.clearSession?.();
      const err = new Error('Session expired — please sign in again.');
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        msg = body?.detail || body?.error || JSON.stringify(body);
      } catch {
        try { msg = await res.text() || msg; } catch { /* ignore */ }
      }
      throw new Error(msg);
    }
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) return res.json();
    return res;
  }

  async function checkHealth() {
    try {
      const r = await request('/api/health');
      return r.status === 'ok';
    } catch {
      return false;
    }
  }

  async function listPOs({ query = '', period = 'all' } = {}) {
    const qs = new URLSearchParams();
    if (query) qs.set('query', query);
    if (period && period !== 'all') qs.set('period', period);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request(`/api/pos${suffix}`);
  }

  async function getPO(id) {
    return request(`/api/pos/${id}`);
  }

  async function findByPONumber(po_number) {
    if (!po_number) return null;
    try {
      return await request(`/api/pos/by-number/${encodeURIComponent(po_number)}`);
    } catch {
      return null;
    }
  }

  async function createPO(data) {
    return request('/api/pos', { method: 'POST', body: JSON.stringify(data) });
  }

  async function updatePO(id, data) {
    return request(`/api/pos/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async function deletePO(id) {
    return request(`/api/pos/${id}`, { method: 'DELETE' });
  }

  async function clearAll() {
    return request('/api/pos', { method: 'DELETE' });
  }

  async function getStats() {
    return request('/api/stats');
  }

  /**
   * Triggers a download of the current ledger as XLSX. Returns nothing on
   * success; throws on failure.
   */
  async function downloadLedgerXlsx(filename = 'po_ledger.xlsx') {
    const res = await fetch(`${BASE}/api/pos/export.xlsx`);
    if (!res.ok) throw new Error(`Excel export failed (HTTP ${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // Give the browser a tick to start downloading before revoking
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  /**
   * Upload the original source file (PDF/image/etc.) for a saved PO.
   * Stored on the backend filesystem and streamable via getSourceUrl(id).
   */
  async function uploadSource(po_id, file) {
    if (!po_id || !file) return null;
    const form = new FormData();
    form.append('file', file, file.name);
    // Don't set Content-Type — the browser sets it with the multipart boundary.
    // But we DO need the Authorization header now that backend requires auth.
    const authHeaders = window.App?.auth?.authHeader?.() || {};
    const res = await fetch(`${BASE}/api/pos/${po_id}/source`, {
      method: 'POST',
      headers: { ...authHeaders },
      body: form,
    });
    if (res.status === 401) {
      window.App?.auth?.clearSession?.();
      const err = new Error('Session expired — please sign in again.');
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json())?.detail || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  function getSourceUrl(po_id) {
    if (!po_id) return null;
    return `${BASE}/api/pos/${po_id}/source`;
  }

  async function updateStatus(po_id, status) {
    return request(`/api/pos/${po_id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async function bulkDelete(ids) {
    return request('/api/pos/bulk/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  async function bulkStatus(ids, status) {
    return request('/api/pos/bulk/status', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    });
  }

  async function getDistinct(field) {
    const data = await request(`/api/distinct/${encodeURIComponent(field)}`);
    return data.values || [];
  }

  async function syncStatus() {
    return request('/api/sync/status');
  }

  async function syncNow() {
    return request('/api/sync/now', { method: 'POST' });
  }

  async function listTeam() {
    return request('/api/team');
  }

  async function setUserActive(user_id, is_active) {
    return request('/api/team/active', {
      method: 'POST',
      body: JSON.stringify({ user_id, is_active }),
    });
  }

  window.App = window.App || {};
  window.App.backend = {
    BASE,
    checkHealth,
    listPOs,
    getPO,
    findByPONumber,
    createPO,
    updatePO,
    deletePO,
    clearAll,
    getStats,
    downloadLedgerXlsx,
    uploadSource,
    getSourceUrl,
    updateStatus,
    bulkDelete,
    bulkStatus,
    getDistinct,
    listTeam,
    setUserActive,
    syncStatus,
    syncNow,
  };
})();
