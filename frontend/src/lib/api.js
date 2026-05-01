/* ==========================================================================
   api.js — HTTP client for the FastAPI backend (port 8503).
   Provides CRUD + Excel export + duplicate detection.
   ========================================================================== */
(() => {
  'use strict';

  const BACKEND_PORT = 8503;
  // Hardcode http:// — Streamlit's srcdoc iframe sets window.location.protocol
  // to `about:` which would produce an invalid URL. 127.0.0.1 is always
  // local-loopback HTTP for our use.
  const BASE = `http://127.0.0.1:${BACKEND_PORT}`;

  async function request(path, opts = {}) {
    const url = BASE + path;
    let res;
    try {
      res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        ...opts,
      });
    } catch (e) {
      throw new Error(`Backend unreachable at ${BASE}. Is the server running?`);
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
    const res = await fetch(`${BASE}/api/pos/${po_id}/source`, {
      method: 'POST',
      body: form,
    });
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
  };
})();
