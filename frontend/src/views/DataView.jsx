/* ==========================================================================
   DataView.jsx — Flat Excel-style tabular view of the ledger.

   Sibling to RepositoryView. Repository is the card-style "ledger" view
   with stat tiles, saved filters, expandable rows. DataView is the dense
   spreadsheet equivalent for reps who want to scan everything at once,
   sort by any column, or copy cells into Excel.

   Two display modes:
     - "headers"   — one row per PO, ~20 columns of header info
     - "lines"     — one row per LINE ITEM with the PO header joined,
                     mirroring the Excel export's Line Items sheet.

   No expandable rows here; clicking a row opens the PO in Edit/Review.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useMemo, useCallback } = React;
  const { formatCurrency, formatDate, cn, truncate } = window.App.utils;
  const _A = () => window.App;

  // Storage key for the user's column-visibility preference, separate by
  // mode so headers-view and lines-view can hide different columns.
  const HIDDEN_COLS_KEY = (mode) => `foundry.dataview.hiddenCols.${mode}`;

  function loadHiddenCols(mode) {
    try {
      const v = window.localStorage.getItem(HIDDEN_COLS_KEY(mode));
      return v ? new Set(JSON.parse(v)) : new Set();
    } catch { return new Set(); }
  }
  function saveHiddenCols(mode, set) {
    try { window.localStorage.setItem(HIDDEN_COLS_KEY(mode), JSON.stringify([...set])); }
    catch { /* localStorage unavailable */ }
  }

  function DataView({ records, onEdit, onDownload, currentUser }) {
    const { SearchInput, Segmented, Button, Icon, EmptyState, StatusPill } = _A();
    const [query, setQuery] = useState('');
    const [mode, setMode] = useState('headers'); // 'headers' | 'lines'
    const [sortKey, setSortKey] = useState('updated_at');
    const [sortDir, setSortDir] = useState('desc');
    const [hiddenCols, setHiddenCols] = useState(() => loadHiddenCols('headers'));
    const [colMenuOpen, setColMenuOpen] = useState(false);

    // Reload hidden-cols when mode flips
    React.useEffect(() => {
      setHiddenCols(loadHiddenCols(mode));
    }, [mode]);

    const toggleCol = useCallback((key) => {
      setHiddenCols((curr) => {
        const next = new Set(curr);
        if (next.has(key)) next.delete(key); else next.add(key);
        saveHiddenCols(mode, next);
        return next;
      });
    }, [mode]);

    const showAllCols = useCallback(() => {
      const empty = new Set();
      saveHiddenCols(mode, empty);
      setHiddenCols(empty);
    }, [mode]);

    // ---- filter ----
    const filtered = useMemo(() => {
      if (!query.trim()) return records;
      const q = query.trim().toLowerCase();
      return records.filter((r) =>
        ['po_number','customer','supplier','supplier_code','buyer','buyer_email','quote_number','contract_number']
          .some((f) => (r[f] || '').toString().toLowerCase().includes(q)) ||
        (r.line_items || []).some((it) =>
          ['customer_part','vendor_part','description','notes']
            .some((f) => (it[f] || '').toString().toLowerCase().includes(q))
        )
      );
    }, [records, query]);

    // ---- flatten for "lines" mode ----
    const rows = useMemo(() => {
      if (mode === 'headers') return filtered;
      const out = [];
      for (const r of filtered) {
        const items = r.line_items || [];
        if (items.length === 0) {
          out.push({ ...r, _line: null });
        } else {
          for (const it of items) {
            out.push({ ...r, _line: it });
          }
        }
      }
      return out;
    }, [filtered, mode]);

    // ---- sort ----
    const sortedRows = useMemo(() => {
      const arr = [...rows];
      arr.sort((a, b) => {
        const va = pluckSortValue(a, sortKey, mode);
        const vb = pluckSortValue(b, sortKey, mode);
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
      return arr;
    }, [rows, sortKey, sortDir, mode]);

    const handleSort = useCallback((key) => {
      setSortKey((curr) => {
        if (curr === key) {
          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          return curr;
        }
        // Default direction: numbers + dates desc, strings asc
        setSortDir(NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc');
        return key;
      });
    }, []);

    const handleCsvExport = useCallback(() => {
      const csv = toCsv(sortedRows, mode);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mode === 'headers' ? 'foundry_pos.csv' : 'foundry_line_items.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, [sortedRows, mode]);

    if (!records || records.length === 0) {
      return (
        <div className="view">
          <EmptyState
            icon="grid"
            title="No data yet"
            text="Once you confirm extracted POs, they'll show up here in a flat tabular view — easy to copy into Excel or scan side-by-side."
          />
        </div>
      );
    }

    const allColumns = mode === 'headers' ? HEADER_COLUMNS : LINE_COLUMNS;
    const columns = allColumns.filter((c) => !hiddenCols.has(c.key));

    return (
      <div className="view data-view">
        <div className="data-view-toolbar">
          <Segmented
            value={mode}
            onChange={(m) => { setMode(m); setSortKey(m === 'headers' ? 'updated_at' : 'po_date'); setSortDir('desc'); }}
            options={[
              { value: 'headers', label: `POs (${filtered.length})` },
              { value: 'lines',   label: `Line items (${countLines(filtered)})` },
            ]}
          />
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Filter — PO #, customer, supplier, part, description..."
          />
          <div className="flex-1" />
          <div style={{ position: 'relative' }}>
            <Button variant="ghost" iconLeft="sliders" onClick={() => setColMenuOpen((v) => !v)}>
              Columns {hiddenCols.size > 0 ? `(${allColumns.length - hiddenCols.size}/${allColumns.length})` : ''}
            </Button>
            {colMenuOpen && (
              <div
                className="col-visibility-menu"
                onMouseLeave={() => setColMenuOpen(false)}
              >
                <div className="col-visibility-header">
                  <span>Show columns</span>
                  <button type="button" className="col-visibility-reset" onClick={showAllCols}>
                    Show all
                  </button>
                </div>
                {allColumns.map((c) => (
                  <label key={c.key} className="col-visibility-item">
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(c.key)}
                      onChange={() => toggleCol(c.key)}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" iconLeft="download" onClick={handleCsvExport}>
            Export CSV
          </Button>
          {onDownload && (
            <Button variant="primary" iconLeft="download" onClick={onDownload}>
              Export Excel
            </Button>
          )}
        </div>

        <div className="data-table-card">
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={cn('sortable-header', c.numeric && 'col-num')}
                      style={{ minWidth: c.width || 100 }}
                      onClick={() => handleSort(c.key)}
                      title={`Sort by ${c.label}`}
                    >
                      <span className="sortable-header-inner">
                        {c.label}
                        {sortKey === c.key ? (
                          <Icon name="chevron-down" size={10}
                            style={{ transform: sortDir === 'asc' ? 'rotate(180deg)' : 'none', color: 'var(--accent)' }} />
                        ) : (
                          <Icon name="chevron-down" size={10} style={{ color: 'var(--text-subtle)', opacity: 0.35 }} />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => (
                  <DataRow
                    key={(row.id || idx) + '-' + (row._line?.line ?? '')}
                    row={row}
                    mode={mode}
                    columns={columns}
                    onClick={() => onEdit?.(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="data-table-footer">
            <span>{sortedRows.length} {mode === 'headers' ? 'POs' : 'lines'}</span>
            <span>·</span>
            <span>Click any row to open in Review / Edit. Click headers to sort.</span>
          </div>
        </div>
      </div>
    );
  }

  function DataRow({ row, mode, columns, onClick }) {
    const { StatusPill } = _A();
    return (
      <tr onClick={onClick} className="data-row">
        {columns.map((c) => {
          const v = c.getter(row);
          const display = c.format ? c.format(v, row) : v;
          const isNum = c.numeric;
          const cellStyle = {
            minWidth: c.width || 100,
            maxWidth: c.max || 360,
            ...(c.mono ? { fontFamily: 'JetBrains Mono', fontSize: 11.5 } : {}),
          };
          if (c.key === 'status') {
            return (
              <td key={c.key} style={cellStyle}>
                <StatusPill status={v || 'received'} />
              </td>
            );
          }
          return (
            <td
              key={c.key}
              className={cn(isNum && 'col-num')}
              style={cellStyle}
              title={typeof v === 'string' ? v : undefined}
            >
              {display ?? ''}
            </td>
          );
        })}
      </tr>
    );
  }

  // ===========================================================================
  // Column definitions
  // ===========================================================================

  const STRING = (k) => (r) => r[k] || '';
  const LINESTR = (k) => (r) => (r._line || {})[k] ?? '';
  const NUMERIC_SORT_KEYS = new Set(['total','quantity','unit_price','amount','line','po_date','updated_at','required_date']);

  const HEADER_COLUMNS = [
    { key: 'po_number',       label: 'PO #',           width: 130, mono: true,  getter: STRING('po_number') },
    { key: 'po_date',         label: 'Date',           width: 95,  getter: STRING('po_date'),       format: (v) => formatDate(v) },
    { key: 'customer',        label: 'Customer',       width: 180, max: 220, getter: STRING('customer'),     format: (v) => truncate(v, 32) },
    { key: 'supplier',        label: 'Supplier',       width: 180, max: 220, getter: STRING('supplier'),     format: (v) => truncate(v, 32) },
    { key: 'supplier_code',   label: 'Supplier #',     width: 90,  mono: true,  getter: STRING('supplier_code') },
    { key: 'buyer',           label: 'Buyer',          width: 130, max: 160, getter: STRING('buyer'),         format: (v) => truncate(v, 22) },
    { key: 'buyer_email',     label: 'Buyer email',    width: 180, max: 220, getter: STRING('buyer_email'),   format: (v) => truncate(v, 30) },
    { key: 'payment_terms',   label: 'Payment',        width: 100, getter: STRING('payment_terms') },
    { key: 'freight_terms',   label: 'Freight',        width: 130, max: 180, getter: STRING('freight_terms'), format: (v) => truncate(v, 24) },
    { key: 'ship_via',        label: 'Ship via',       width: 100, getter: STRING('ship_via') },
    { key: 'fob_terms',       label: 'F.O.B.',         width: 100, getter: STRING('fob_terms') },
    { key: 'quote_number',    label: 'Quote #',        width: 120, mono: true, getter: STRING('quote_number') },
    { key: 'contract_number', label: 'Contract #',     width: 100, mono: true, getter: STRING('contract_number') },
    { key: 'ship_to',         label: 'Ship to',        width: 200, max: 260, getter: STRING('ship_to'),        format: (v) => truncate((v || '').split('\n')[0], 36) },
    { key: 'bill_to',         label: 'Bill to',        width: 180, max: 240, getter: STRING('bill_to'),        format: (v) => truncate((v || '').split('\n')[0], 32) },
    { key: 'line_count',      label: 'Lines',          width: 60,  numeric: true, getter: (r) => (r.line_items || []).length },
    { key: 'total',           label: 'Total',          width: 110, numeric: true, getter: (r) => Number(r.total) || 0, format: (v, r) => formatCurrency(v, r.currency) },
    { key: 'status',          label: 'Status',         width: 110, getter: STRING('status') },
    { key: 'updated_at',      label: 'Updated',        width: 110, getter: STRING('updated_at'),     format: (v) => formatDate(v) },
  ];

  const LINE_COLUMNS = [
    { key: 'po_number',       label: 'PO #',          width: 130, mono: true, getter: STRING('po_number') },
    { key: 'po_date',         label: 'PO Date',       width: 95,  getter: STRING('po_date'),       format: (v) => formatDate(v) },
    { key: 'customer',        label: 'Customer',      width: 170, max: 200, getter: STRING('customer'),  format: (v) => truncate(v, 30) },
    { key: 'supplier',        label: 'Supplier',      width: 170, max: 200, getter: STRING('supplier'),  format: (v) => truncate(v, 30) },
    { key: 'line',            label: 'Line',          width: 55,  numeric: true, getter: (r) => (r._line || {}).line ?? '' },
    { key: 'customer_part',   label: 'Customer Part', width: 130, mono: true, getter: LINESTR('customer_part') },
    { key: 'vendor_part',     label: 'Vendor Part',   width: 150, mono: true, getter: LINESTR('vendor_part') },
    { key: 'description',     label: 'Description',   width: 280, max: 380, getter: LINESTR('description'), format: (v) => truncate(v, 60) },
    { key: 'quantity',        label: 'Qty',           width: 65,  numeric: true, getter: (r) => Number((r._line || {}).quantity) || 0 },
    { key: 'uom',             label: 'UOM',           width: 55,  getter: LINESTR('uom') },
    { key: 'unit_price',      label: 'Unit price',    width: 100, numeric: true, getter: (r) => Number((r._line || {}).unit_price) || 0, format: (v, r) => formatCurrency(v, r.currency) },
    { key: 'amount',          label: 'Amount',        width: 110, numeric: true, getter: (r) => Number((r._line || {}).amount) || 0, format: (v, r) => formatCurrency(v, r.currency) },
    { key: 'required_date',   label: 'Required',      width: 95,  getter: (r) => (r._line || {}).required_date || '', format: (v) => formatDate(v) },
    { key: 'notes',           label: 'Notes',         width: 200, max: 280, getter: LINESTR('notes'),     format: (v) => truncate((v || '').replace(/\n/g, ' · '), 48) },
    { key: 'buyer',           label: 'Buyer',         width: 130, max: 160, getter: STRING('buyer'),       format: (v) => truncate(v, 22) },
    { key: 'payment_terms',   label: 'Payment',       width: 100, getter: STRING('payment_terms') },
    { key: 'status',          label: 'Status',        width: 110, getter: STRING('status') },
  ];

  // ===========================================================================
  // helpers
  // ===========================================================================

  function pluckSortValue(r, key, mode) {
    if (mode === 'lines') {
      const lineKeys = ['line','customer_part','vendor_part','description','quantity','uom','unit_price','amount','required_date','notes'];
      if (lineKeys.includes(key)) {
        const v = (r._line || {})[key];
        if (typeof v === 'number') return v;
        return String(v ?? '').toLowerCase();
      }
    }
    if (key === 'line_count') return (r.line_items || []).length;
    const v = r[key];
    if (key === 'total') return Number(v) || 0;
    if (typeof v === 'number') return v;
    return String(v ?? '').toLowerCase();
  }

  function countLines(records) {
    return (records || []).reduce((s, r) => s + ((r.line_items || []).length || 1), 0);
  }

  function toCsv(rows, mode) {
    const cols = mode === 'headers' ? HEADER_COLUMNS : LINE_COLUMNS;
    const header = cols.map((c) => csvEscape(c.label)).join(',');
    const lines = rows.map((r) =>
      cols.map((c) => {
        const v = c.getter(r);
        return csvEscape(typeof v === 'number' ? String(v) : (v || ''));
      }).join(',')
    );
    return [header, ...lines].join('\n');
  }

  function csvEscape(s) {
    const t = String(s == null ? '' : s);
    if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
    return t;
  }

  window.App = window.App || {};
  window.App.DataView = DataView;
})();
