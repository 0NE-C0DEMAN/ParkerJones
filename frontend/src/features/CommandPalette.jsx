/* ==========================================================================
   CommandPalette.jsx — Cmd+K / Ctrl+K global launcher.

   Search POs by number/customer/supplier, jump between views, run quick
   actions (sign out, export, etc.). The pattern Linear/Notion/Vercel use.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect, useRef, useMemo } = React;
  const { cn, formatCurrency, truncate } = window.App.utils;
  const { Icon } = window.App;

  function CommandPalette({ open, onClose, records = [], navigate, onSignOut, onDownloadXlsx, user }) {
    const [query, setQuery] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
      if (open) {
        setQuery('');
        setActiveIdx(0);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }, [open]);

    // Build the unified result list
    const items = useMemo(() => {
      const q = query.trim().toLowerCase();
      const result = [];

      // Quick actions (always shown when no query, or matching query)
      const actions = [
        { kind: 'action', id: 'go-upload',     label: 'Upload PO',           hint: 'Go to upload view',    icon: 'upload-cloud', onSelect: () => navigate('upload') },
        { kind: 'action', id: 'go-repository', label: 'View Repository',     hint: 'Go to ledger',         icon: 'rows',         onSelect: () => navigate('repository') },
        { kind: 'action', id: 'go-profile',    label: 'Edit Profile',        hint: 'Account settings',     icon: 'user',         onSelect: () => navigate('profile') },
        { kind: 'action', id: 'go-settings',   label: 'Open Settings',       hint: 'API key, model, ...',  icon: 'sliders',      onSelect: () => navigate('settings') },
        { kind: 'action', id: 'export',        label: 'Export Excel',        hint: 'Download ledger.xlsx', icon: 'download',     onSelect: () => onDownloadXlsx?.() },
        { kind: 'action', id: 'signout',       label: 'Sign out',            hint: user?.email || '',      icon: 'log-out',      onSelect: () => onSignOut?.() },
      ];
      const matchedActions = q
        ? actions.filter((a) => a.label.toLowerCase().includes(q) || (a.hint || '').toLowerCase().includes(q))
        : actions;
      result.push(...matchedActions);

      // PO matches (only when there's a query)
      if (q) {
        const poMatches = (records || [])
          .filter((r) =>
            (r.po_number || '').toLowerCase().includes(q) ||
            (r.customer || '').toLowerCase().includes(q) ||
            (r.supplier || '').toLowerCase().includes(q)
          )
          .slice(0, 12)
          .map((r) => ({
            kind: 'po',
            id: 'po-' + r.id,
            label: r.po_number,
            hint: `${r.customer || '—'} · ${r.supplier || '—'} · ${formatCurrency(r.total, r.currency)}`,
            icon: 'file-text',
            onSelect: () => { navigate('repository'); /* TODO: scroll/highlight */ },
            record: r,
          }));
        result.push(...poMatches);
      }

      return result;
    }, [query, records, navigate, onSignOut, onDownloadXlsx, user]);

    // Reset active index when items change
    useEffect(() => { setActiveIdx(0); }, [items.length]);

    // Keyboard navigation
    useEffect(() => {
      if (!open) return;
      const onKey = (e) => {
        if (e.key === 'Escape') { onClose(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(items.length - 1, i + 1)); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
        else if (e.key === 'Enter' && items[activeIdx]) {
          e.preventDefault();
          items[activeIdx].onSelect?.();
          onClose();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [open, items, activeIdx, onClose]);

    // Scroll active item into view
    useEffect(() => {
      const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }, [activeIdx]);

    if (!open) return null;

    return (
      <div className="cmdk-backdrop" onMouseDown={onClose}>
        <div className="cmdk-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="cmdk-input-row">
            <Icon name="search" size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              className="cmdk-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search POs, jump to a view, run an action..."
              autoComplete="off"
              spellCheck={false}
            />
            <span className="cmdk-shortcut">esc</span>
          </div>
          <div className="cmdk-list" ref={listRef}>
            {items.length === 0 ? (
              <div className="cmdk-empty">
                <Icon name="search" size={20} style={{ color: 'var(--text-subtle)' }} />
                <span>No matches for "{query}"</span>
              </div>
            ) : (
              items.map((it, i) => (
                <button
                  type="button"
                  key={it.id}
                  data-idx={i}
                  className={cn('cmdk-item', i === activeIdx && 'active')}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => { it.onSelect?.(); onClose(); }}
                >
                  <Icon name={it.icon} size={14} className="cmdk-item-icon" />
                  <span className="cmdk-item-label">{truncate(it.label, 40)}</span>
                  {it.hint && <span className="cmdk-item-hint">{truncate(it.hint, 60)}</span>}
                  <span className="cmdk-item-kind">{it.kind === 'po' ? 'PO' : 'Action'}</span>
                </button>
              ))
            )}
          </div>
          <div className="cmdk-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> select</span>
            <span><kbd>esc</kbd> close</span>
            <div className="flex-1" />
            <span style={{ color: 'var(--text-subtle)' }}>{items.length} result{items.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.CommandPalette = CommandPalette;
})();
