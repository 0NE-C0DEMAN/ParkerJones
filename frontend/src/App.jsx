/* ==========================================================================
   App.jsx — Root. Owns view routing, repository state (loaded from FastAPI
   backend), pending PO under review, edit mode, and toast queue.

   Backend status:
     - Boots: pings /api/health on mount; if down, shows offline banner
       and falls back gracefully (CRUD just shows error toasts).
     - All persistence is via window.App.backend (no localStorage for POs).
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useCallback, useEffect, useRef } = React;
  const { uuid } = window.App.utils;
  const {
    Sidebar, TopBar, ToastContainer, Button, Icon, Badge,
    UploadView, ReviewView, RepositoryView, SettingsView,
  } = window.App;
  const { useToasts, useKeyboardShortcut } = window.App.hooks;

  function App() {
    const [view, setView] = useState('upload');
    // pending: { filename, status: 'extracting'|'review', stage?, data?, isEdit?, editId?, duplicate? }
    const [pending, setPending] = useState(null);
    const [repository, setRepository] = useState([]);
    const [loading, setLoading] = useState(true);
    const [backendOnline, setBackendOnline] = useState(true);
    const { toasts, push, dismiss } = useToasts();
    const refreshTimer = useRef(null);

    // ---- backend bootstrap ----
    const refreshRepository = useCallback(async () => {
      try {
        const list = await window.App.backend.listPOs();
        setRepository(list);
        setBackendOnline(true);
        return list;
      } catch (err) {
        setBackendOnline(false);
        throw err;
      }
    }, []);

    useEffect(() => {
      let mounted = true;
      (async () => {
        // Retry health check — auto-spawned backend can take 1-2s to come up
        let ok = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          ok = await window.App.backend.checkHealth();
          if (ok || !mounted) break;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
        if (!mounted) return;
        setBackendOnline(ok);
        if (!ok) {
          push({
            type: 'error',
            message: 'Backend offline. Restart with start_streamlit.bat.',
            duration: 6000,
          });
          setLoading(false);
          return;
        }
        try {
          await refreshRepository();
        } catch (err) {
          push({ type: 'error', message: `Failed to load ledger: ${err.message}` });
        } finally {
          if (mounted) setLoading(false);
        }
      })();
      return () => { mounted = false; };
    }, [push, refreshRepository]);

    // ---- shortcuts ----
    useKeyboardShortcut('Escape', () => {
      if (pending) {
        setPending(null);
        setView(view === 'review' ? 'upload' : view);
      }
    }, [pending, view]);

    // ---- file extraction flow ----
    const handleFiles = useCallback(async (files) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (files.length > 1) {
        push({
          type: 'info',
          message: `Processing "${file.name}" — ${files.length - 1} more queued (one at a time for now).`,
        });
      }

      setPending({
        filename: file.name,
        fileSize: file.size,
        file,                          // keep the File object so PdfPreview can blob-URL it
        status: 'extracting',
        stage: 'parsing',
      });
      setView('review');

      try {
        const data = await window.App.api.extractPO(file, {
          onStage: (stage) => setPending((curr) => curr ? { ...curr, stage } : curr),
        });

        // Duplicate detection
        let duplicate = null;
        if (data.po_number && backendOnline) {
          duplicate = await window.App.backend.findByPONumber(data.po_number);
        }

        setPending((curr) => curr ? {
          ...curr,
          status: 'review',
          data,
          duplicate,
        } : curr);
      } catch (err) {
        console.error('Extraction failed', err);
        push({ type: 'error', message: err.message || 'Extraction failed.' });
        setPending(null);
        setView('upload');
      }
    }, [push, backendOnline]);

    // ---- save / update ----
    const handleConfirm = useCallback(async (data) => {
      try {
        let saved;
        const wasEdit = pending?.isEdit && pending.editId;
        if (wasEdit) {
          saved = await window.App.backend.updatePO(pending.editId, {
            ...data,
            filename: pending.filename || data.filename || '',
          });
          push({ type: 'success', message: `${saved.po_number} updated` });
        } else if (pending?.duplicate) {
          saved = await window.App.backend.updatePO(pending.duplicate.id, {
            ...data,
            filename: pending.filename || '',
          });
          push({ type: 'success', message: `${saved.po_number} replaced existing PO` });
        } else {
          saved = await window.App.backend.createPO({
            ...data,
            filename: pending?.filename || '',
          });
          push({ type: 'success', message: `${saved.po_number} added to ledger` });
        }

        // Upload the source file (only available on the create/replace path,
        // not when editing an already-saved PO without a fresh upload).
        if (pending?.file && saved?.id) {
          try {
            await window.App.backend.uploadSource(saved.id, pending.file);
          } catch (err) {
            console.warn('Source file upload failed:', err);
            push({ type: 'info', message: 'PO saved, but source file upload failed.' });
          }
        }

        await refreshRepository();
        setPending(null);
        setView('repository');
      } catch (err) {
        push({ type: 'error', message: `Save failed: ${err.message}` });
      }
    }, [pending, refreshRepository, push]);

    const handleSaveAsNew = useCallback(async (data) => {
      // Forces creation as a new record even when a duplicate was detected.
      try {
        const saved = await window.App.backend.createPO({
          ...data,
          filename: pending?.filename || '',
        });
        if (pending?.file && saved?.id) {
          try { await window.App.backend.uploadSource(saved.id, pending.file); }
          catch (err) { console.warn('Source upload failed:', err); }
        }
        push({ type: 'success', message: `${saved.po_number} added (kept existing copy too)` });
        await refreshRepository();
        setPending(null);
        setView('repository');
      } catch (err) {
        push({ type: 'error', message: `Save failed: ${err.message}` });
      }
    }, [pending, refreshRepository, push]);

    const handleDiscard = useCallback(() => {
      setPending(null);
      setView('upload');
      push({ type: 'info', message: 'Discarded.' });
    }, [push]);

    // ---- repository actions ----
    const handleEdit = useCallback((id) => {
      const record = repository.find((r) => r.id === id);
      if (!record) return;
      const sourceUrl = record.has_source ? window.App.backend.getSourceUrl(id) : null;
      setPending({
        filename: record.filename || record.po_number,
        status: 'review',
        data: record,
        isEdit: true,
        editId: record.id,
        sourceUrl,
      });
      setView('review');
    }, [repository]);

    const handleDelete = useCallback(async (id) => {
      try {
        await window.App.backend.deletePO(id);
        await refreshRepository();
        push({ type: 'info', message: 'PO removed from ledger.' });
      } catch (err) {
        push({ type: 'error', message: `Delete failed: ${err.message}` });
      }
    }, [refreshRepository, push]);

    const handleDownload = useCallback(async () => {
      try {
        await window.App.backend.downloadLedgerXlsx();
        push({ type: 'success', message: `Exported ${repository.length} POs to Excel` });
      } catch (err) {
        push({ type: 'error', message: `Excel export failed: ${err.message}` });
      }
    }, [repository.length, push]);

    const handleClearLedger = useCallback(async () => {
      try {
        await window.App.backend.clearAll();
        await refreshRepository();
        push({ type: 'info', message: 'Ledger cleared.' });
      } catch (err) {
        push({ type: 'error', message: `Clear failed: ${err.message}` });
      }
    }, [refreshRepository, push]);

    const handleNavigate = useCallback((next) => {
      if (pending && pending.status === 'review' && next !== 'review') {
        if (!window.confirm('Discard the current changes?')) return;
        setPending(null);
      }
      setView(next);
    }, [pending]);

    const titleFor = view === 'upload' ? 'Upload'
      : view === 'review' ? (pending?.isEdit ? 'Edit PO' : 'Review extraction')
      : view === 'repository' ? 'Ledger'
      : 'Settings';
    const subtitleFor = {
      upload: 'Drop POs to extract data with AI',
      review: pending?.filename || '',
      repository: `${repository.length} ${repository.length === 1 ? 'record' : 'records'} in database`,
      settings: 'Workspace preferences',
    }[view];

    const topbarActions = view === 'repository' && repository.length > 0 ? (
      <>
        <Button variant="ghost" iconLeft="upload" onClick={() => handleNavigate('upload')}>
          Upload PO
        </Button>
        <Button variant="primary" iconLeft="download" onClick={handleDownload}>
          Export Excel
        </Button>
      </>
    ) : view === 'upload' && repository.length > 0 ? (
      <Button variant="secondary" iconLeft="rows" onClick={() => handleNavigate('repository')}>
        View ledger ({repository.length})
      </Button>
    ) : null;

    return (
      <div className="app">
        <Sidebar
          activeView={view}
          onNavigate={handleNavigate}
          repositoryCount={repository.length}
          pendingCount={pending ? 1 : 0}
        />
        <main className="main">
          <TopBar title={titleFor} subtitle={subtitleFor} actions={topbarActions} />

          {!backendOnline && <BackendOfflineBanner onRetry={async () => {
            const ok = await window.App.backend.checkHealth();
            setBackendOnline(ok);
            if (ok) { try { await refreshRepository(); } catch {} }
          }} />}

          <div className="content">
            {loading ? <LoadingState /> : (
              <>
                {view === 'upload' && (
                  <UploadView
                    records={repository}
                    onFiles={handleFiles}
                    onView={() => handleNavigate('repository')}
                  />
                )}
                {view === 'review' && (
                  <ReviewView
                    pending={pending}
                    onConfirm={handleConfirm}
                    onSaveAsNew={handleSaveAsNew}
                    onDiscard={handleDiscard}
                  />
                )}
                {view === 'repository' && (
                  <RepositoryView
                    records={repository}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    onDownload={handleDownload}
                  />
                )}
                {view === 'settings' && (
                  <SettingsView
                    recordCount={repository.length}
                    onClearLedger={handleClearLedger}
                    pushToast={push}
                    backendOnline={backendOnline}
                  />
                )}
              </>
            )}
          </div>
        </main>
        <ToastContainer toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  function BackendOfflineBanner({ onRetry }) {
    return (
      <div style={{
        background: 'var(--danger-light)',
        borderBottom: '1px solid var(--danger)',
        color: 'var(--danger)',
        padding: '10px 28px',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <Icon name="alert-triangle" size={15} />
        <strong>Backend offline.</strong>
        <span>The SQLite API at <code style={{ fontFamily: 'JetBrains Mono', fontSize: 11.5 }}>{(window.App?.backend?.BASE || '127.0.0.1:8503').replace(/^https?:\/\//, '')}</code> isn't responding. Restart with <code>start_streamlit.bat</code> or <code>uvicorn backend:app --port 8503</code>.</span>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="danger" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  function LoadingState() {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 20px',
        gap: 12,
        color: 'var(--text-muted)',
        fontSize: 13,
      }}>
        <span className="spinner" style={{ color: 'var(--accent)' }} />
        Loading ledger...
      </div>
    );
  }

  window.App = window.App || {};
  window.App.App = App;
})();
