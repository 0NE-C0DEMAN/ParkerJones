/* ==========================================================================
   RepositoryView.jsx — Ledger with stats + filters + bulk actions + sort.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useMemo, useCallback, useEffect } = React;
  const { formatCurrency, cn } = window.App.utils;
  // Resolve at render time (some symbols are defined in scripts that load
  // after this one).
  const _A = () => window.App;

  /** Predefined "saved filter" chips (Linear/Asana style). */
  const SAVED_FILTERS = [
    { id: 'open',         label: 'Open',           filter: (r) => !['invoiced', 'closed'].includes(r.status) },
    { id: 'pending-ack',  label: 'Pending ack',    filter: (r) => (r.status || 'received') === 'received' },
    { id: 'in-progress',  label: 'In progress',    filter: (r) => r.status === 'in_progress' },
    { id: 'shipped',      label: 'Shipped',        filter: (r) => r.status === 'shipped' },
    { id: 'this-week',    label: 'This week',      filter: (r) => {
        const t = r.added_at ? new Date(r.added_at).getTime() : 0;
        return t >= Date.now() - 7 * 86400000;
      },
    },
    { id: 'high-value',   label: 'Over $50k',      filter: (r) => Number(r.total || 0) > 50000 },
    { id: 'mine',         label: 'Created by me',  filter: (r, ctx) => r.created_by_email === ctx.userEmail },
  ];

  function RepositoryView({ records, onDelete, onEdit, onView, onDownload, onStatusChange, onBulkDelete, onBulkStatus, currentUser, pushToast }) {
    const { Stat, StatGrid, RepositoryTable, SearchInput, Button, Segmented, Icon, PO_STATUSES } = _A();
    const [query, setQuery] = useState('');
    const [period, setPeriod] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [savedFilter, setSavedFilter] = useState(null);
    const [customFilter, setCustomFilter] = useState(null); // active custom filter id
    const [customFilters, setCustomFilters] = useState([]); // server-stored
    const [editingFilter, setEditingFilter] = useState(null); // null | { id?, name, emoji, scope }
    const [sortKey, setSortKey] = useState('updated_at');
    const [sortDir, setSortDir] = useState('desc');
    const [selectedIds, setSelectedIds] = useState(new Set());

    const isAdmin = currentUser?.role === 'admin';

    // Load saved filters once. Cheap — just hits the backend.
    useEffect(() => {
      (async () => {
        try {
          const res = await window.App.backend.listSavedFilters();
          setCustomFilters(res.filters || []);
        } catch (err) {
          console.warn('Could not load saved filters:', err.message);
        }
      })();
    }, []);

    // Apply a saved custom filter to the local state (so the rep sees
    // their chip + the actual filter inputs reflect what's filtered).
    const applyCustomFilter = useCallback((cf) => {
      if (customFilter === cf.id) {
        setCustomFilter(null);
        setQuery('');
        setStatusFilter('all');
        setPeriod('all');
        setSavedFilter(null);
        return;
      }
      const p = cf.payload || {};
      setCustomFilter(cf.id);
      setQuery(p.query || '');
      setStatusFilter(p.status || 'all');
      setPeriod(p.period || 'all');
      setSavedFilter(p.savedFilter || null);
    }, [customFilter]);

    const hasActiveFilter = !!query.trim() || statusFilter !== 'all' || period !== 'all' || savedFilter;

    const saveCurrentAsFilter = useCallback(() => {
      setEditingFilter({
        name: '',
        emoji: '⭐',
        scope: 'user',
        // capture the live filter state at click time
        payload: {
          query: query.trim(),
          status: statusFilter,
          period,
          savedFilter,
        },
      });
    }, [query, statusFilter, period, savedFilter]);

    const commitFilter = useCallback(async (draft) => {
      try {
        if (draft.id) {
          const updated = await window.App.backend.updateSavedFilter(draft.id, draft);
          setCustomFilters((cf) => cf.map((f) => f.id === updated.id ? updated : f));
          pushToast?.({ type: 'success', message: `Filter “${updated.name}” updated.` });
        } else {
          const created = await window.App.backend.createSavedFilter(draft);
          setCustomFilters((cf) => [...cf, created]);
          setCustomFilter(created.id);
          pushToast?.({ type: 'success', message: `Filter “${created.name}” saved.` });
        }
        setEditingFilter(null);
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Save failed.' });
      }
    }, [pushToast]);

    const deleteFilter = useCallback(async (cf) => {
      if (!window.confirm(`Delete the “${cf.name}” filter?`)) return;
      try {
        await window.App.backend.deleteSavedFilter(cf.id);
        setCustomFilters((all) => all.filter((f) => f.id !== cf.id));
        if (customFilter === cf.id) setCustomFilter(null);
        pushToast?.({ type: 'success', message: `Filter “${cf.name}” deleted.` });
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Delete failed.' });
      }
    }, [customFilter, pushToast]);

    const filtered = useMemo(() => {
      let arr = [...records];

      if (savedFilter) {
        const sf = SAVED_FILTERS.find((f) => f.id === savedFilter);
        if (sf) arr = arr.filter((r) => sf.filter(r, { userEmail: currentUser?.email }));
      }

      if (statusFilter !== 'all') {
        arr = arr.filter((r) => (r.status || 'received') === statusFilter);
      }

      if (period !== 'all') {
        const now = Date.now();
        const cutoffs = { '7d': 7, '30d': 30, '90d': 90 };
        const days = cutoffs[period];
        if (days) {
          const cutoff = now - days * 86400000;
          arr = arr.filter((r) => new Date(r.added_at).getTime() >= cutoff);
        }
      }

      if (query.trim()) {
        const q = query.trim().toLowerCase();
        arr = arr.filter((r) =>
          (r.po_number || '').toLowerCase().includes(q) ||
          (r.customer || '').toLowerCase().includes(q) ||
          (r.supplier || '').toLowerCase().includes(q) ||
          (r.supplier_code || '').toLowerCase().includes(q) ||
          (r.buyer || '').toLowerCase().includes(q) ||
          (r.buyer_email || '').toLowerCase().includes(q) ||
          (r.quote_number || '').toLowerCase().includes(q) ||
          (r.contract_number || '').toLowerCase().includes(q) ||
          (r.line_items || []).some((it) =>
            (it.description || '').toLowerCase().includes(q) ||
            (it.vendor_part || '').toLowerCase().includes(q) ||
            (it.customer_part || '').toLowerCase().includes(q) ||
            (it.notes || '').toLowerCase().includes(q)
          )
        );
      }

      // Sort
      arr.sort((a, b) => {
        let va, vb;
        switch (sortKey) {
          case 'po_number': va = a.po_number || ''; vb = b.po_number || ''; break;
          case 'customer': va = (a.customer || '').toLowerCase(); vb = (b.customer || '').toLowerCase(); break;
          case 'supplier': va = (a.supplier || '').toLowerCase(); vb = (b.supplier || '').toLowerCase(); break;
          case 'buyer':    va = (a.buyer || '').toLowerCase();    vb = (b.buyer || '').toLowerCase();    break;
          case 'po_date': va = a.po_date || ''; vb = b.po_date || ''; break;
          case 'total': va = Number(a.total) || 0; vb = Number(b.total) || 0; break;
          case 'line_count': va = (a.line_items || []).length; vb = (b.line_items || []).length; break;
          case 'updated_at': va = a.updated_at || a.added_at || ''; vb = b.updated_at || b.added_at || ''; break;
          default: return 0;
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });

      return arr;
    }, [records, query, period, statusFilter, sortKey, sortDir, savedFilter, currentUser]);

    const stats = useMemo(() => {
      const totalValue = filtered.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
      const lineCount = filtered.reduce((sum, r) => sum + (r.line_items || []).length, 0);
      const uniqueSuppliers = new Set(filtered.map((r) => r.supplier).filter(Boolean)).size;
      return { count: filtered.length, totalValue, lineCount, uniqueSuppliers };
    }, [filtered]);

    const statusCounts = useMemo(() => {
      const counts = {};
      records.forEach((r) => { const s = r.status || 'received'; counts[s] = (counts[s] || 0) + 1; });
      return counts;
    }, [records]);

    const handleSort = useCallback((key) => {
      setSortKey((curr) => {
        if (curr === key) {
          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          return curr;
        }
        setSortDir(key === 'po_date' || key === 'updated_at' || key === 'total' || key === 'line_count' ? 'desc' : 'asc');
        return key;
      });
    }, []);

    const toggleSelect = useCallback((id, checked) => {
      setSelectedIds((curr) => {
        const next = new Set(curr);
        if (checked) next.add(id); else next.delete(id);
        return next;
      });
    }, []);

    const toggleAll = useCallback((checked) => {
      if (checked) setSelectedIds(new Set(filtered.map((r) => r.id)));
      else setSelectedIds(new Set());
    }, [filtered]);

    const selectedArray = Array.from(selectedIds);
    const clearSelection = () => setSelectedIds(new Set());

    return (
      <div className="view">
        <StatGrid>
          <Stat label="POs in view" value={stats.count} icon="rows" />
          <Stat label="Total value" value={formatCurrency(stats.totalValue)} icon="dollar" />
          <Stat label="Line items" value={stats.lineCount} icon="package" />
          <Stat label="Unique suppliers" value={stats.uniqueSuppliers} icon="briefcase" />
        </StatGrid>

        <div className="saved-filters">
          <button
            type="button"
            className={cn('saved-filter-chip', !savedFilter && !customFilter && 'active')}
            onClick={() => { setSavedFilter(null); setCustomFilter(null); }}
          >
            All <span className="saved-filter-count">{records.length}</span>
          </button>
          {SAVED_FILTERS.map((f) => {
            const count = records.filter((r) => f.filter(r, { userEmail: currentUser?.email })).length;
            return (
              <button
                key={f.id}
                type="button"
                className={cn('saved-filter-chip', savedFilter === f.id && 'active')}
                onClick={() => { setCustomFilter(null); setSavedFilter(savedFilter === f.id ? null : f.id); }}
              >
                {f.label} <span className="saved-filter-count">{count}</span>
              </button>
            );
          })}
          {/* Custom saved filters — user's own + admin-shared team ones. */}
          {customFilters.map((cf) => {
            const isActive = customFilter === cf.id;
            return (
              <span key={cf.id} className={cn('saved-filter-custom', isActive && 'active')}>
                <button
                  type="button"
                  className="saved-filter-chip"
                  onClick={() => applyCustomFilter(cf)}
                  title={cf.scope === 'team' ? 'Team filter' : 'Your filter'}
                >
                  {cf.emoji ? <span style={{ marginRight: 4 }}>{cf.emoji}</span> : null}
                  {cf.name}
                  {cf.scope === 'team' && <span className="saved-filter-team">team</span>}
                </button>
                {(cf.mine || (isAdmin && cf.scope === 'team')) && (
                  <span className="saved-filter-actions">
                    <button
                      type="button"
                      className="saved-filter-action"
                      title="Edit"
                      onClick={(e) => { e.stopPropagation(); setEditingFilter({ ...cf }); }}
                    >
                      <Icon name="pencil" size={11} />
                    </button>
                    <button
                      type="button"
                      className="saved-filter-action saved-filter-action-danger"
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); deleteFilter(cf); }}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  </span>
                )}
              </span>
            );
          })}
          {hasActiveFilter && !customFilter && (
            <button
              type="button"
              className="saved-filter-chip saved-filter-save"
              onClick={saveCurrentAsFilter}
              title="Save the active query, status, and period as a reusable filter"
            >
              <Icon name="plus" size={10} /> Save filter
            </button>
          )}
        </div>

        <div className="filter-bar">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search PO #, supplier #, buyer, quote #, contract #, part, description..."
          />
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
            <option value="all">All statuses ({records.length})</option>
            {PO_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label} ({statusCounts[s.id] || 0})</option>
            ))}
          </select>
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'all', label: 'All' },
              { value: '7d', label: '7d' },
              { value: '30d', label: '30d' },
              { value: '90d', label: '90d' },
            ]}
          />
          <div className="flex-1" />
          {/* Export Excel lives in the global topbar — don't duplicate it
              in the Ledger toolbar. */}
        </div>

        {selectedIds.size > 0 && (
          <BulkActionBar
            count={selectedIds.size}
            onClear={clearSelection}
            onBulkDelete={() => { onBulkDelete?.(selectedArray); clearSelection(); }}
            onBulkStatus={(status) => { onBulkStatus?.(selectedArray, status); clearSelection(); }}
          />
        )}

        <RepositoryTable
          records={filtered}
          onDelete={onDelete}
          onEdit={onEdit}
          onStatusChange={onStatusChange}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleAll={toggleAll}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />

        {editingFilter && (
          <SaveFilterModal
            draft={editingFilter}
            isAdmin={isAdmin}
            onCancel={() => setEditingFilter(null)}
            onCommit={commitFilter}
          />
        )}
      </div>
    );
  }

  function SaveFilterModal({ draft, isAdmin, onCancel, onCommit }) {
    const { Button, Icon } = _A();
    const [name, setName] = useState(draft.name || '');
    const [emoji, setEmoji] = useState(draft.emoji || '');
    const [scope, setScope] = useState(draft.scope || 'user');
    const valid = name.trim().length > 0;
    return (
      <div className="modal-backdrop" onClick={onCancel}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              {draft.id ? 'Edit saved filter' : 'Save current filter'}
            </div>
            <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="modal-body">
            <label className="modal-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My open POs"
                autoFocus
              />
            </label>
            <label className="modal-field">
              <span>Emoji (optional)</span>
              <input
                type="text"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
                placeholder="⭐"
                maxLength={4}
                style={{ width: 80, fontSize: 18, textAlign: 'center' }}
              />
            </label>
            {isAdmin && (
              <label className="modal-field">
                <span>Visibility</span>
                <select value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="user">Just for me</option>
                  <option value="team">Share with the team</option>
                </select>
              </label>
            )}
            <div className="modal-summary">
              <div className="modal-summary-title">Filter captures:</div>
              <div className="modal-summary-payload">
                {Object.entries(draft.payload || {}).filter(([, v]) => v).map(([k, v]) => (
                  <span key={k} className="modal-summary-chip">
                    <strong>{k}:</strong>&nbsp;{String(v)}
                  </span>
                ))}
                {Object.values(draft.payload || {}).every((v) => !v) && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No filters active.</span>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button
              variant="primary"
              iconLeft="check"
              disabled={!valid}
              onClick={() => onCommit({ ...draft, name: name.trim(), emoji, scope })}
            >
              {draft.id ? 'Update' : 'Save filter'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function BulkActionBar({ count, onClear, onBulkDelete, onBulkStatus }) {
    const { Badge, Button, StatusPill, PO_STATUSES } = _A();
    const [statusOpen, setStatusOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    return (
      <div className="bulk-action-bar">
        <div className="flex items-center gap-3 flex-1">
          <Badge tone="accent" dot>{count} selected</Badge>
          <Button variant="ghost" size="sm" iconLeft="x" onClick={onClear}>Clear</Button>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ position: 'relative' }}>
            <Button variant="secondary" size="sm" iconLeft="rotate-cw" onClick={() => setStatusOpen((v) => !v)}>
              Change status
            </Button>
            {statusOpen && (
              <div className="status-menu" style={{ right: 0, left: 'auto', top: 'calc(100% + 4px)' }} onMouseLeave={() => setStatusOpen(false)}>
                {PO_STATUSES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="status-menu-item"
                    onClick={() => { setStatusOpen(false); onBulkStatus(s.id); }}
                  >
                    <StatusPill status={s.id} />
                  </button>
                ))}
              </div>
            )}
          </div>
          {confirmDelete ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" iconLeft="trash" onClick={() => { setConfirmDelete(false); onBulkDelete(); }}>
                Delete {count}
              </Button>
            </>
          ) : (
            <Button variant="danger" size="sm" iconLeft="trash" onClick={() => setConfirmDelete(true)}>
              Delete selected
            </Button>
          )}
        </div>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.RepositoryView = RepositoryView;
})();
