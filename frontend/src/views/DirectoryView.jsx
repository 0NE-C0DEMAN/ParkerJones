/* ==========================================================================
   DirectoryView.jsx — Auto-built directory of customers + suppliers.

   No separate "parties" table in the DB — everything is aggregated from
   PO history on the fly. Two tabs (Customers / Suppliers), each shows a
   sortable list with per-party stats (PO count, lifetime spend, last
   order date). Tap a row → detail panel: stats header + all of that
   party's POs as a card list.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect, useMemo } = React;
  const { Card, Icon, Badge, Segmented } = window.App;
  const { formatCurrency } = window.App.utils;

  function DirectoryView({ pushToast, onOpenPo }) {
    const [kind, setKind] = useState('customers'); // 'customers' | 'suppliers'
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null); // selected party name
    const [partyPOs, setPartyPOs] = useState([]);
    const [partyLoading, setPartyLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [sortKey, setSortKey] = useState('total_spend'); // total_spend | po_count | name | last_po_date

    // Reload the list every time the tab switches (customers ↔ suppliers).
    useEffect(() => {
      let mounted = true;
      setLoading(true);
      setSelected(null);
      setPartyPOs([]);
      (async () => {
        try {
          const res = await window.App.backend.listDirectory(kind);
          if (!mounted) return;
          setItems(res.items || []);
        } catch (err) {
          pushToast?.({ type: 'error', message: err.message || 'Failed to load directory.' });
        } finally {
          if (mounted) setLoading(false);
        }
      })();
      return () => { mounted = false; };
    }, [kind]);

    // Fetch the selected party's POs.
    useEffect(() => {
      if (!selected) return;
      let mounted = true;
      setPartyLoading(true);
      (async () => {
        try {
          const pos = await window.App.backend.listPartyPOs(kind, selected);
          if (!mounted) return;
          setPartyPOs(Array.isArray(pos) ? pos : []);
        } catch (err) {
          pushToast?.({ type: 'error', message: err.message || 'Failed to load POs.' });
        } finally {
          if (mounted) setPartyLoading(false);
        }
      })();
      return () => { mounted = false; };
    }, [selected, kind]);

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      const base = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items.slice();
      base.sort((a, b) => {
        if (sortKey === 'name')          return a.name.localeCompare(b.name);
        if (sortKey === 'po_count')      return (b.po_count || 0) - (a.po_count || 0);
        if (sortKey === 'last_po_date')  return (b.last_po_date || '').localeCompare(a.last_po_date || '');
        return (b.total_spend || 0) - (a.total_spend || 0); // total_spend default
      });
      return base;
    }, [items, query, sortKey]);

    const totals = useMemo(() => ({
      parties: items.length,
      pos: items.reduce((s, it) => s + (it.po_count || 0), 0),
      spend: items.reduce((s, it) => s + (it.total_spend || 0), 0),
    }), [items]);

    if (selected) {
      const partyMeta = items.find((it) => it.name === selected) || {};
      return (
        <div className="view directory-view">
          <div className="directory-detail-header">
            <button
              type="button"
              className="btn btn-ghost btn-sm directory-back"
              onClick={() => setSelected(null)}
            >
              <Icon name="chevron-left" size={13} /> All {kind}
            </button>
            <div className="directory-detail-title">
              <Icon name={kind === 'customers' ? 'building' : 'briefcase'} size={14} />
              <span>{selected}</span>
            </div>
          </div>

          <div className="directory-stats">
            <Stat label="POs"           value={partyMeta.po_count || 0} />
            <Stat label="Lifetime spend" value={formatCurrency(partyMeta.total_spend || 0)} />
            <Stat label="First PO"      value={partyMeta.first_po_date || '—'} mono />
            <Stat label="Last PO"       value={partyMeta.last_po_date  || '—'} mono />
          </div>

          {partyLoading ? (
            <div className="directory-empty">
              <span className="spinner" style={{ color: 'var(--accent)' }} /> Loading…
            </div>
          ) : partyPOs.length === 0 ? (
            <div className="directory-empty">No POs for this {kind === 'customers' ? 'customer' : 'supplier'} yet.</div>
          ) : (
            <div className="directory-po-list">
              {partyPOs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="directory-po-card"
                  onClick={() => onOpenPo?.(p.id)}
                >
                  <div className="directory-po-top">
                    <span className="directory-po-num">{p.po_number || '—'}</span>
                    <span className="directory-po-total">{formatCurrency(p.total, p.currency)}</span>
                  </div>
                  <div className="directory-po-sub">
                    <span>{p.po_date || 'No date'}</span>
                    <span className="directory-po-sub-divider">·</span>
                    <span>{(p.line_items || []).length} {(p.line_items || []).length === 1 ? 'line' : 'lines'}</span>
                    <span className="directory-po-sub-divider">·</span>
                    <Badge tone={p.status === 'shipped' ? 'success' : p.status === 'in_progress' ? 'accent' : 'default'} dot>
                      {(p.status || 'received').replace('_', ' ')}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="view directory-view">
        <div className="directory-top">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'customers', label: 'Customers' },
              { value: 'suppliers', label: 'Suppliers' },
            ]}
          />
          <div className="directory-search">
            <Icon name="search" size={13} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${kind}…`}
            />
          </div>
        </div>

        <div className="directory-summary">
          <span><strong>{totals.parties}</strong> {kind}</span>
          <span className="directory-summary-divider">·</span>
          <span><strong>{totals.pos}</strong> POs</span>
          <span className="directory-summary-divider">·</span>
          <span><strong>{formatCurrency(totals.spend)}</strong> lifetime spend</span>
        </div>

        <Card noPadding className="directory-list-card">
          <div className="directory-list-header">
            <SortHeader k="name"          label="Name"          sortKey={sortKey} onSort={setSortKey} className="col-name" />
            <SortHeader k="po_count"      label="POs"           sortKey={sortKey} onSort={setSortKey} numeric />
            <SortHeader k="total_spend"   label="Lifetime"      sortKey={sortKey} onSort={setSortKey} numeric />
            <SortHeader k="last_po_date"  label="Last order"    sortKey={sortKey} onSort={setSortKey} />
          </div>

          {loading ? (
            <div className="directory-empty">
              <span className="spinner" style={{ color: 'var(--accent)' }} /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="directory-empty">
              {query ? `No ${kind} match “${query}”.` : `No ${kind} on the ledger yet.`}
            </div>
          ) : (
            filtered.map((it) => (
              <button
                key={it.name}
                type="button"
                className="directory-row"
                onClick={() => setSelected(it.name)}
              >
                <span className="directory-row-name">
                  <Icon name={kind === 'customers' ? 'building' : 'briefcase'} size={12} />
                  <span>{it.name}</span>
                </span>
                <span className="directory-row-num col-num">{it.po_count}</span>
                <span className="directory-row-num col-num"><strong>{formatCurrency(it.total_spend)}</strong></span>
                <span className="directory-row-date">{it.last_po_date || '—'}</span>
                <Icon name="chevron-right" size={12} className="directory-row-chev" />
              </button>
            ))
          )}
        </Card>
      </div>
    );
  }

  function Stat({ label, value, mono }) {
    return (
      <div className="directory-stat">
        <div className="directory-stat-label">{label}</div>
        <div className={'directory-stat-value' + (mono ? ' mono' : '')}>{value}</div>
      </div>
    );
  }

  function SortHeader({ k, label, sortKey, onSort, numeric, className }) {
    const active = sortKey === k;
    return (
      <button
        type="button"
        className={'directory-list-th' + (numeric ? ' col-num' : '') + (className ? ' ' + className : '')}
        onClick={() => onSort(k)}
      >
        <span>{label}</span>
        {active && <Icon name="chevron-down" size={10} />}
      </button>
    );
  }

  window.App = window.App || {};
  window.App.DirectoryView = DirectoryView;
})();
