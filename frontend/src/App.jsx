/* ==========================================================================
   App.jsx — Root. Auth-gated workspace router.

   States:
     - boot:   waiting for /api/auth/me (validates stored token)
     - auth:   no token or token invalid → AuthView (login/register)
     - app:    authenticated → workspace (Upload / Repository / Settings / Profile)
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useCallback, useEffect } = React;
  const { useToasts, useKeyboardShortcut } = window.App.hooks;

  function App() {
    // Resolve at render time so any component can be defined later in script order
    const {
      Sidebar, TopBar, ToastContainer, Button, Icon,
      AuthView, UploadView, ReviewView, RepositoryView, DataView, SettingsView, ProfileView, TeamView,
      CommandPalette, ErrorBoundary,
    } = window.App;

    const [bootState, setBootState] = useState('boot'); // 'boot' | 'auth' | 'app'
    const [user, setUser] = useState(null);

    const [view, setView] = useState('upload');
    const [pending, setPending] = useState(null);
    const [repository, setRepository] = useState([]);
    const [loading, setLoading] = useState(false);
    const [backendOnline, setBackendOnline] = useState(true);
    const [queue, setQueue] = useState([]);            // pending files waiting to be processed
    const [queueIndex, setQueueIndex] = useState(-1);  // currently-processing index in queue
    const [paletteOpen, setPaletteOpen] = useState(false);
    const { toasts, push, dismiss } = useToasts();

    // ---- bootstrap: backend health + session check ----
    useEffect(() => {
      let mounted = true;
      (async () => {
        // Backend health (with retries — auto-spawn can take 1-2s)
        let online = false;
        for (let i = 0; i < 5; i++) {
          online = await window.App.backend.checkHealth();
          if (online || !mounted) break;
          await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        }
        if (!mounted) return;
        setBackendOnline(online);
        if (!online) {
          setBootState('auth'); // show auth screen with offline note
          return;
        }

        // Session check — fetch /me with stored token
        const me = await window.App.auth.fetchMe();
        if (!mounted) return;
        if (me) {
          setUser(me);
          setBootState('app');
        } else {
          setBootState('auth');
        }
      })();
      return () => { mounted = false; };
    }, []);

    // ---- when authenticated, load the ledger ----
    useEffect(() => {
      if (bootState !== 'app') return;
      let mounted = true;
      (async () => {
        setLoading(true);
        try {
          const list = await window.App.backend.listPOs();
          if (mounted) setRepository(list);
        } catch (err) {
          if (err.status === 401) return; // session expired — handled by api.js
          if (mounted) push({ type: 'error', message: `Failed to load ledger: ${err.message}` });
        } finally {
          if (mounted) setLoading(false);
        }
      })();
      return () => { mounted = false; };
    }, [bootState, push]);

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

    // ---- shortcuts ----
    useKeyboardShortcut('Escape', () => {
      if (paletteOpen) return; // palette handles its own ESC
      if (pending && bootState === 'app') {
        setPending(null);
        if (view === 'review') setView('upload');
      }
    }, [pending, view, bootState, paletteOpen]);

    // Cmd+K / Ctrl+K opens the command palette (only when authenticated)
    useEffect(() => {
      if (bootState !== 'app') return;
      const onKey = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setPaletteOpen((v) => !v);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [bootState]);

    // ---- file extraction ----
    const extractOne = useCallback(async (file) => {
      setPending({ filename: file.name, fileSize: file.size, file, status: 'extracting', stage: 'parsing' });
      setView('review');
      try {
        const data = await window.App.api.extractPO(file, {
          onStage: (stage) => setPending((curr) => curr ? { ...curr, stage } : curr),
        });
        // Surface any non-fatal warnings (e.g. "1 of 4 chunks didn't extract")
        // so reps know something is worth a second look. The extraction still
        // succeeded — we just want them to glance at the line items.
        const warnings = Array.isArray(data?._warnings) ? data._warnings : [];
        warnings.forEach((message) => push({ type: 'warning', message }));
        let duplicate = null;
        if (data.po_number && backendOnline) {
          duplicate = await window.App.backend.findByPONumber(data.po_number);
        }
        setPending((curr) => curr ? { ...curr, status: 'review', data, duplicate } : curr);
      } catch (err) {
        console.error('Extraction failed', err);
        push({ type: 'error', message: err.message || 'Extraction failed.' });
        setPending(null);
        setView('upload');
      }
    }, [push, backendOnline]);

    const handleFiles = useCallback(async (files) => {
      if (!files || files.length === 0) return;
      // Drop them all into the queue. The first one processes immediately;
      // subsequent ones are picked up after the current PO is confirmed/discarded.
      setQueue(files);
      setQueueIndex(0);
      if (files.length > 1) {
        push({ type: 'info', message: `Processing ${files.length} files — review each one as it's ready.` });
      }
      await extractOne(files[0]);
    }, [push, extractOne]);

    // After confirm/discard, advance to next file in queue if any.
    const advanceQueue = useCallback(async () => {
      if (queue.length === 0) return;
      const nextIdx = queueIndex + 1;
      if (nextIdx >= queue.length) {
        // Done with this batch
        setQueue([]);
        setQueueIndex(-1);
        return;
      }
      setQueueIndex(nextIdx);
      await extractOne(queue[nextIdx]);
    }, [queue, queueIndex, extractOne]);

    const clearQueue = useCallback(() => {
      setQueue([]);
      setQueueIndex(-1);
      push({ type: 'info', message: 'Queue cleared.' });
    }, [push]);

    const removeFromQueue = useCallback((idx) => {
      setQueue((curr) => curr.filter((_, i) => i !== idx));
    }, []);

    // ---- save / update ----
    //
    // After a successful save we land the rep back on the Upload view,
    // NOT on the Ledger. Reps process POs in batches — bouncing to
    // Repository between every save means an extra click to get back to
    // Upload. If they want to view the saved record, the toast says
    // "added to ledger" and they can click Repository in the sidebar
    // (or the small "View ledger" button that surfaces in the topbar
    // when there are records). Edits are different: after editing a
    // ledger row we DO return to Repository so the rep can see their
    // changes in context.
    const handleConfirm = useCallback(async (data) => {
      try {
        let saved;
        const wasEdit = pending?.isEdit && pending.editId;
        if (wasEdit) {
          saved = await window.App.backend.updatePO(pending.editId, { ...data, filename: pending.filename || data.filename || '' });
          push({ type: 'success', message: `${saved.po_number} updated` });
        } else if (pending?.duplicate) {
          saved = await window.App.backend.updatePO(pending.duplicate.id, { ...data, filename: pending.filename || '' });
          push({ type: 'success', message: `${saved.po_number} replaced existing PO` });
        } else {
          saved = await window.App.backend.createPO({ ...data, filename: pending?.filename || '' });
          push({ type: 'success', message: `${saved.po_number} added to ledger` });
        }
        if (pending?.file && saved?.id) {
          try { await window.App.backend.uploadSource(saved.id, pending.file); }
          catch (err) {
            console.warn('Source file upload failed:', err);
            push({ type: 'info', message: 'PO saved, but source file upload failed.' });
          }
        }
        await refreshRepository();
        setPending(null);
        // If there's another file in the queue, advance to it.
        if (queue.length > 0 && queueIndex < queue.length - 1) {
          setView('upload');
          setTimeout(() => advanceQueue(), 200);
          return;
        }
        if (queue.length > 0) { setQueue([]); setQueueIndex(-1); }
        // Land on Repository only after edits; new uploads stay on
        // Upload so the rep can drop the next PO immediately.
        setView(wasEdit ? 'repository' : 'upload');
      } catch (err) {
        push({ type: 'error', message: `Save failed: ${err.message}` });
      }
    }, [pending, queue, queueIndex, advanceQueue, refreshRepository, push]);

    const handleSaveAsNew = useCallback(async (data) => {
      try {
        const saved = await window.App.backend.createPO({ ...data, filename: pending?.filename || '' });
        if (pending?.file && saved?.id) {
          try { await window.App.backend.uploadSource(saved.id, pending.file); }
          catch (err) { console.warn('Source upload failed:', err); }
        }
        push({ type: 'success', message: `${saved.po_number} added (kept existing too)` });
        await refreshRepository();
        setPending(null);
        if (queue.length > 0 && queueIndex < queue.length - 1) {
          setView('upload');
          setTimeout(() => advanceQueue(), 200);
          return;
        }
        if (queue.length > 0) { setQueue([]); setQueueIndex(-1); }
        setView('upload'); // same rule: keep the upload-batch flow alive
      } catch (err) {
        push({ type: 'error', message: `Save failed: ${err.message}` });
      }
    }, [pending, queue, queueIndex, advanceQueue, refreshRepository, push]);

    const handleDiscard = useCallback(() => {
      setPending(null);
      // If queued, advance to next; else go back to upload
      if (queue.length > 0 && queueIndex < queue.length - 1) {
        setView('upload');
        setTimeout(() => advanceQueue(), 200);
      } else {
        setView('upload');
        if (queue.length > 0) { setQueue([]); setQueueIndex(-1); }
      }
      push({ type: 'info', message: 'Discarded.' });
    }, [queue, queueIndex, advanceQueue, push]);

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

    const handleStatusChange = useCallback(async (id, status) => {
      try {
        await window.App.backend.updateStatus(id, status);
        await refreshRepository();
        const label = window.App.statusInfo(status).label;
        push({ type: 'success', message: `Marked as ${label}.` });
      } catch (err) {
        push({ type: 'error', message: `Status update failed: ${err.message}` });
      }
    }, [refreshRepository, push]);

    const handleBulkDelete = useCallback(async (ids) => {
      try {
        const r = await window.App.backend.bulkDelete(ids);
        await refreshRepository();
        push({ type: 'info', message: `Deleted ${r.deleted} PO${r.deleted === 1 ? '' : 's'}.` });
      } catch (err) {
        push({ type: 'error', message: `Bulk delete failed: ${err.message}` });
      }
    }, [refreshRepository, push]);

    const handleBulkStatus = useCallback(async (ids, status) => {
      try {
        const r = await window.App.backend.bulkStatus(ids, status);
        await refreshRepository();
        const label = window.App.statusInfo(status).label;
        push({ type: 'success', message: `Marked ${r.updated} PO${r.updated === 1 ? '' : 's'} as ${label}.` });
      } catch (err) {
        push({ type: 'error', message: `Bulk update failed: ${err.message}` });
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

    // ---- auth callbacks ----
    const handleAuthenticated = useCallback((u) => {
      setUser(u);
      setBootState('app');
      setView('upload');
      push({ type: 'success', message: `Welcome, ${u.full_name || u.email}` });
    }, [push]);

    const handleSignOut = useCallback(async () => {
      await window.App.auth.logout();
      setUser(null);
      setRepository([]);
      setPending(null);
      setView('upload');
      setBootState('auth');
    }, []);

    const handleUserUpdated = useCallback((u) => setUser(u), []);

    // ---- render: boot ----
    if (bootState === 'boot') {
      return (
        <div className="auth-shell">
          <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="spinner" style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13 }}>Loading Foundry...</span>
          </div>
        </div>
      );
    }

    // ---- render: auth ----
    if (bootState === 'auth') {
      return (
        <>
          <AuthView onAuthenticated={handleAuthenticated} />
          <ToastContainer toasts={toasts} onDismiss={dismiss} />
        </>
      );
    }

    // ---- render: app ----
    const titleFor = view === 'upload' ? 'Upload'
      : view === 'review' ? (pending?.isEdit ? 'Edit PO' : 'Review extraction')
      : view === 'repository' ? 'Ledger'
      : view === 'data' ? 'Data'
      : view === 'profile' ? 'Profile'
      : view === 'team' ? 'Team'
      : 'Settings';
    const subtitleFor = {
      upload: 'Drop POs to extract data with AI',
      review: pending?.filename || '',
      repository: `${repository.length} ${repository.length === 1 ? 'record' : 'records'} in database`,
      data: `Flat tabular view — ${repository.length} ${repository.length === 1 ? 'PO' : 'POs'}, copy-into-Excel friendly`,
      profile: 'Your account & preferences',
      team: 'Manage members and invitations',
      settings: 'Workspace preferences',
    }[view];

    const topbarActions = view === 'repository' && repository.length > 0 ? (
      <>
        <Button variant="ghost" iconLeft="upload" onClick={() => handleNavigate('upload')}>Upload PO</Button>
        <Button variant="primary" iconLeft="download" onClick={handleDownload}>Export Excel</Button>
      </>
    ) : view === 'data' && repository.length > 0 ? (
      <>
        <Button variant="ghost" iconLeft="upload" onClick={() => handleNavigate('upload')}>Upload PO</Button>
        <Button variant="primary" iconLeft="download" onClick={handleDownload}>Export Excel</Button>
      </>
    ) : view === 'upload' && repository.length > 0 ? (
      <>
        <Button variant="ghost" iconLeft="rows" onClick={() => handleNavigate('repository')}>
          Ledger ({repository.length})
        </Button>
        <Button variant="secondary" iconLeft="grid" onClick={() => handleNavigate('data')}>
          Data view
        </Button>
      </>
    ) : null;

    return (
      <div className="app">
        <Sidebar
          activeView={view}
          onNavigate={handleNavigate}
          repositoryCount={repository.length}
          pendingCount={pending ? 1 : 0}
          user={user}
          onSignOut={handleSignOut}
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
              <ErrorBoundary key={view}>
                {view === 'upload' && (
                  <UploadView
                    records={repository}
                    onFiles={handleFiles}
                    onView={() => handleNavigate('repository')}
                    queue={queue}
                    queueCurrent={queueIndex}
                    onClearQueue={clearQueue}
                    onRemoveFromQueue={removeFromQueue}
                  />
                )}
                {view === 'review' && (
                  <ReviewView pending={pending} onConfirm={handleConfirm} onSaveAsNew={handleSaveAsNew} onDiscard={handleDiscard} />
                )}
                {view === 'repository' && (
                  <RepositoryView
                    records={repository}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    onDownload={handleDownload}
                    onStatusChange={handleStatusChange}
                    onBulkDelete={handleBulkDelete}
                    onBulkStatus={handleBulkStatus}
                    currentUser={user}
                  />
                )}
                {view === 'data' && (
                  <DataView
                    records={repository}
                    onEdit={handleEdit}
                    onDownload={handleDownload}
                    currentUser={user}
                  />
                )}
                {view === 'profile' && (
                  <ProfileView user={user} onUserUpdated={handleUserUpdated} pushToast={push} />
                )}
                {view === 'team' && user?.role === 'admin' && (
                  <TeamView pushToast={push} currentUser={user} />
                )}
                {view === 'settings' && (
                  <SettingsView
                    recordCount={repository.length}
                    onClearLedger={handleClearLedger}
                    pushToast={push}
                    backendOnline={backendOnline}
                    user={user}
                  />
                )}
              </ErrorBoundary>
            )}
          </div>
        </main>
        <ToastContainer toasts={toasts} onDismiss={dismiss} />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          records={repository}
          navigate={handleNavigate}
          onSignOut={handleSignOut}
          onDownloadXlsx={handleDownload}
          user={user}
        />
      </div>
    );
  }

  function BackendOfflineBanner({ onRetry }) {
    const { Icon, Button } = window.App;
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
        <span>The API at <code style={{ fontFamily: 'JetBrains Mono', fontSize: 11.5 }}>{((window.App?.backend?.BASE ?? '127.0.0.1:8503') || window.location.host).replace(/^https?:\/\//, '')}</code> isn't responding.</span>
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
