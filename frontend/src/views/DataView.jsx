/* ==========================================================================
   DataView.jsx — Flat tabular view of the PO ledger.

   Compact one-line-per-PO table with the leftmost PO # column frozen.
   Click any row (or its chevron) to expand a full detail panel that
   shows every captured field PLUS the line items mini-table PLUS the
   audit trail. The expand panel is structured into:
     - 3 info cards (Identifiers / Buyer & Receiving / Terms & Routing)
     - 4 address cards (Customer / Supplier / Ship-to / Bill-to)
     - PO Notes (3/4 width) + Audit (1/4 width) side-by-side
     - Line items mini-table (full width)
     - Action row (View PDF / Edit PO)

   Designed and approved via samples/data_view_preview.html before the
   port to React.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useMemo, useCallback } = React;
  const { formatCurrency, truncate } = window.App.utils;
  const _A = () => window.App;

  function DataView({ records, onEdit, onDownload }) {
    const { Icon, Button, EmptyState, StatusPill, SearchInput, Segmented } = _A();
    const [expanded, setExpanded] = useState(() => new Set());
    const [sortKey, setSortKey] = useState('updated_at');
    const [sortDir, setSortDir] = useState('desc');
    const [query, setQuery] = useState('');

    /* ----- filter ----- */
    const filtered = useMemo(() => {
      if (!query.trim()) return records;
      const q = query.trim().toLowerCase();
      return records.filter((r) => {
        const corpus = [
          r.po_number, r.customer, r.supplier, r.supplier_code, r.buyer, r.buyer_email,
          r.quote_number, r.contract_number, r.notes, r.filename, r.payment_terms,
        ].concat(
          (r.line_items || []).flatMap((it) => [it.customer_part, it.vendor_part, it.description, it.notes])
        ).filter(Boolean).join(' ').toLowerCase();
        return corpus.includes(q);
      });
    }, [records, query]);

    /* ----- sort ----- */
    const sorted = useMemo(() => {
      const arr = [...filtered];
      arr.sort((a, b) => {
        const va = sortVal(a, sortKey);
        const vb = sortVal(b, sortKey);
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
      return arr;
    }, [filtered, sortKey, sortDir]);

    const handleSort = useCallback((key) => {
      setSortKey((curr) => {
        if (curr === key) {
          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          return curr;
        }
        setSortDir(NUMERIC_KEYS.has(key) ? 'desc' : 'asc');
        return key;
      });
    }, []);

    const toggleExpand = useCallback((id) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }, []);

    const expandAll = useCallback(() => {
      if (expanded.size === records.length) setExpanded(new Set());
      else setExpanded(new Set(records.map((r) => r.id)));
    }, [expanded, records]);

    const handleCsvExport = useCallback(() => {
      const csv = toCsv(sorted);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'foundry_pos.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, [sorted]);

    if (!records || records.length === 0) {
      return (
        <div className="view">
          <EmptyState
            icon="grid"
            title="No data yet"
            text="Once you confirm extracted POs, they'll show up here in a flat tabular view. Click any row to see every captured field."
          />
        </div>
      );
    }

    const allExpanded = expanded.size === records.length && records.length > 0;

    return (
      <div className="view data-view-v2">
        <div className="dv-toolbar">
          <div className="dv-search-wrap">
            <Icon name="search" size={14} />
            <input
              type="text"
              className="dv-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter — PO #, customer, supplier, part, description, notes…"
            />
          </div>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" iconLeft={allExpanded ? 'chevron-down' : 'chevron-right'} onClick={expandAll}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </Button>
          <Button variant="ghost" iconLeft="download" onClick={handleCsvExport}>
            Export CSV
          </Button>
          {onDownload && (
            <Button variant="primary" iconLeft="download" onClick={onDownload}>
              Export Excel
            </Button>
          )}
        </div>

        <div className="dv-card">
          <div className="dv-scroll">
            <table className="dv-table">
              <colgroup>
                <col className="dv-col-expand" />
                <col className="dv-col-po" />
                <col className="dv-col-cust" />
                <col className="dv-col-sup" />
                <col className="dv-col-podate" />
                <col className="dv-col-buyer" />
                <col className="dv-col-payment" />
                <col className="dv-col-lines" />
                <col className="dv-col-total" />
                <col className="dv-col-status" />
                <col className="dv-col-updated" />
              </colgroup>
              <thead>
                <tr>
                  <th className="dv-frz dv-col-expand-cell" />
                  <SortHead k="po_number"   label="PO #"      sortKey={sortKey} sortDir={sortDir} onSort={handleSort} frozen />
                  <SortHead k="customer"    label="Customer"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHead k="supplier"    label="Supplier"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHead k="po_date"     label="PO Date"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHead k="buyer"       label="Buyer"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th>Payment</th>
                  <SortHead k="line_count"  label="Lines"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} numeric />
                  <SortHead k="total"       label="Total"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} numeric />
                  <th>Status</th>
                  <SortHead k="updated_at"  label="Updated"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <Row
                    key={r.id}
                    record={r}
                    expanded={expanded.has(r.id)}
                    onToggle={() => toggleExpand(r.id)}
                    onEdit={onEdit}
                  />
                ))}
              </tbody>
            </table>
            {sorted.length === 0 && (
              <div className="dv-empty">No POs match your search.</div>
            )}
          </div>
          <div className="dv-footer">
            <strong>{sorted.length} {sorted.length === 1 ? 'PO' : 'POs'}</strong>
            <span>·</span>
            <span>{sorted.reduce((s, r) => s + (r.line_items || []).length, 0)} line items</span>
            <span>·</span>
            <span>{formatCurrency(sorted.reduce((s, r) => s + (Number(r.total) || 0), 0))} total</span>
            <span className="dv-footer-sep">·</span>
            <span>Click a row to expand · headers to sort · type to filter</span>
            <div style={{ flex: 1 }} />
            <span className="dv-footer-hint">PO # frozen ←</span>
          </div>
        </div>
      </div>
    );
  }

  /* =====================================================================
   * Sortable column header
   * ===================================================================== */
  function SortHead({ k, label, sortKey, sortDir, onSort, frozen, numeric }) {
    const { Icon } = _A();
    const active = sortKey === k;
    const cls = [
      'dv-sortable',
      active && 'dv-sort-active',
      frozen && 'dv-frz dv-c-po',
      numeric && 'dv-col-num',
    ].filter(Boolean).join(' ');
    return (
      <th className={cls} onClick={() => onSort(k)} title={`Sort by ${label}`}>
        {label}
        <Icon
          name="chevron-down"
          size={9}
          style={{
            marginLeft: 4,
            verticalAlign: '1px',
            color: active ? 'var(--accent)' : 'var(--text-subtle)',
            opacity: active ? 1 : 0.4,
            transform: active && sortDir === 'asc' ? 'rotate(180deg)' : 'none',
            transition: 'transform 120ms',
          }}
        />
      </th>
    );
  }

  /* =====================================================================
   * One ledger row + (when expanded) one detail-panel row underneath
   * ===================================================================== */
  function Row({ record, expanded, onToggle, onEdit }) {
    const { Icon, StatusPill } = _A();
    return (
      <>
        <tr className={'dv-row' + (expanded ? ' dv-expanded' : '')} onClick={onToggle}>
          <td className="dv-frz dv-col-expand-cell" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            <span className="dv-chev">
              <Icon name="chevron-right" size={13} />
            </span>
          </td>
          <td className="dv-frz dv-c-po dv-mono" title={record.po_number}>
            {record.po_number}
          </td>
          <td title={record.customer}>{record.customer || ''}</td>
          <td title={record.supplier}>{record.supplier || ''}</td>
          <td title={record.po_date}>{fmtDate(record.po_date)}</td>
          <td title={record.buyer}>{record.buyer || ''}</td>
          <td title={record.payment_terms}>{record.payment_terms || ''}</td>
          <td className="dv-col-num">{(record.line_items || []).length}</td>
          <td className="dv-col-num dv-strong">{formatCurrency(record.total, record.currency)}</td>
          <td onClick={(e) => e.stopPropagation()}>
            <StatusPill status={record.status || 'received'} />
          </td>
          <td className="dv-muted" title={record.updated_at}>{relTime(record.updated_at || record.added_at)}</td>
        </tr>
        {expanded && (
          <tr className="dv-expand-row">
            <td colSpan={11}>
              <DetailPanel record={record} onEdit={onEdit} />
            </td>
          </tr>
        )}
      </>
    );
  }

  /* =====================================================================
   * Detail panel — every captured field, structured into compact cards
   * ===================================================================== */
  function DetailPanel({ record, onEdit }) {
    const r = record;
    const lineItems = r.line_items || [];

    const openPdf = (e) => {
      e.stopPropagation();
      if (r.id && r.has_source) {
        const url = window.App.backend.getSourceUrl(r.id);
        if (url) window.open(url, '_blank');
      }
    };
    const handleEdit = (e) => {
      e.stopPropagation();
      if (onEdit) onEdit(r.id);
    };

    return (
      <div className="dv-panel" onClick={(e) => e.stopPropagation()}>

        {/* Row 1: three info cards side-by-side */}
        <div className="dv-panel-row cols-3">
          <Section title="Identifiers">
            <Field lbl="PO #"        val={r.po_number}        mono />
            <Field lbl="Supplier #"  val={r.supplier_code}    mono />
            <Field lbl="Revision"    val={r.revision} />
            <Field lbl="Quote #"     val={r.quote_number}     mono />
            <Field lbl="PO Date"     val={fmtDate(r.po_date)} />
            <Field lbl="Contract #"  val={r.contract_number}  mono />
            <Field lbl="Currency"    val={r.currency} />
          </Section>

          <Section title="Buyer & Receiving">
            <Field lbl="Buyer"        val={r.buyer} />
            <Field lbl="Receiving"    val={r.receiving_contact} />
            <Field lbl="Email"        val={r.buyer_email}              mono />
            <Field lbl="Recv. phone"  val={r.receiving_contact_phone}  mono />
            <Field lbl="Phone"        val={r.buyer_phone}              mono />
          </Section>

          <Section title="Terms & Routing">
            <Field lbl="Payment"   val={r.payment_terms} />
            <Field lbl="Freight"   val={r.freight_terms} />
            <Field lbl="Ship via"  val={r.ship_via} />
            <Field lbl="F.O.B."    val={r.fob_terms} />
          </Section>
        </div>

        {/* Row 2: four address cards side-by-side */}
        <div className="dv-panel-row cols-4">
          <AddressCard title="Customer address" value={r.customer_address}
            emptyText="No separate customer address block on PO." />
          <AddressCard title="Supplier address" value={r.supplier_address} />
          <AddressCard title="Ship to"          value={r.ship_to} />
          <AddressCard title="Bill to"          value={r.bill_to}
            emptyText="No bill-to address." />
        </div>

        {/* Row 3: PO Notes (3/4) + Audit (1/4) side-by-side. If no notes,
            Audit takes the full row by itself. */}
        {r.notes ? (
          <div className="dv-panel-row notes-audit">
            <NotesCard notes={r.notes} />
            <AuditCard record={r} />
          </div>
        ) : (
          <AuditCard record={r} />
        )}

        {/* Line items mini-table */}
        {lineItems.length > 0 && <LineItemsSection items={lineItems} currency={r.currency} />}

        {/* Action row */}
        <div className="dv-panel-actions">
          {r.has_source && (
            <button className="btn btn-ghost btn-sm" onClick={openPdf}>
              View PDF
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleEdit}>
            Edit PO
          </button>
        </div>
      </div>
    );
  }

  /* ----- small structural components ----- */

  function Section({ title, children, className }) {
    return (
      <div className={'dv-section' + (className ? ' ' + className : '')}>
        <h4>{title}</h4>
        {children}
      </div>
    );
  }

  function Field({ lbl, val, mono }) {
    const isEmpty = val == null || String(val).trim() === '';
    const valClass = ['dv-val'];
    if (mono) valClass.push('mono');
    if (isEmpty) valClass.push('dim');
    return (
      <div className="dv-field">
        <span className="dv-lbl">{lbl}</span>
        <span className={valClass.join(' ')}>{isEmpty ? '—' : val}</span>
      </div>
    );
  }

  function AddressCard({ title, value, emptyText }) {
    const text = (value || '').trim();
    return (
      <div className="dv-section dv-section-addr">
        <h4>{title}</h4>
        <div className="dv-field">
          {text ? (
            <span className="dv-val multi">{text}</span>
          ) : (
            <span className="dv-val dim">{emptyText || '—'}</span>
          )}
        </div>
      </div>
    );
  }

  function NotesCard({ notes }) {
    return (
      <div className="dv-section dv-section-notes">
        <h4>PO Notes</h4>
        <div className="dv-field">
          <span className="dv-val multi">{notes}</span>
        </div>
      </div>
    );
  }

  function AuditCard({ record }) {
    const r = record;
    return (
      <div className="dv-section dv-section-audit">
        <h4>Audit</h4>
        <div className="dv-field stacked">
          <span className="dv-lbl">Source</span>
          <span className="dv-val mono">
            {r.filename || '—'} <MethodTag method={r.extraction_method || 'text'} />
          </span>
        </div>
        <div className="dv-field stacked">
          <span className="dv-lbl">Added</span>
          <span className="dv-val">
            {fmtDate(r.added_at)}{r.created_by_email ? ' · ' + r.created_by_email : ''}
          </span>
        </div>
        <div className="dv-field stacked">
          <span className="dv-lbl">Updated</span>
          <span className="dv-val">
            {fmtDate(r.updated_at)}{r.updated_by_email ? ' · ' + r.updated_by_email : ''}
          </span>
        </div>
      </div>
    );
  }

  function MethodTag({ method }) {
    const m = (method || 'text').toLowerCase();
    return (
      <span className={'dv-method-tag dv-method-' + m}>
        ✦ {m.charAt(0).toUpperCase() + m.slice(1)}
      </span>
    );
  }

  function LineItemsSection({ items, currency }) {
    return (
      <div className="dv-section dv-section-lines">
        <h4>Line items ({items.length})</h4>
        <div className="dv-li-wrap">
          <table className="dv-li-table">
            <colgroup>
              <col className="dv-li-num" />
              <col className="dv-li-cpart" />
              <col className="dv-li-vpart" />
              <col className="dv-li-desc" />
              <col className="dv-li-qty" />
              <col className="dv-li-uom" />
              <col className="dv-li-unit" />
              <col className="dv-li-amt" />
              <col className="dv-li-req" />
              <col className="dv-li-notes" />
            </colgroup>
            <thead>
              <tr>
                <th className="dv-col-num">#</th>
                <th>Cust. Part</th>
                <th>Vendor Part</th>
                <th>Description</th>
                <th className="dv-col-num">Qty</th>
                <th>UOM</th>
                <th className="dv-col-num">Unit</th>
                <th className="dv-col-num">Amount</th>
                <th>Required</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.line || idx}>
                  <td className="dv-col-num">{it.line || ''}</td>
                  <td className="dv-mono">{it.customer_part || '—'}</td>
                  <td className="dv-mono">{it.vendor_part || '—'}</td>
                  <td className="dv-li-desc-cell">{it.description || ''}</td>
                  <td className="dv-col-num">{it.quantity || 0}</td>
                  <td>{it.uom || ''}</td>
                  <td className="dv-col-num">{formatCurrency(it.unit_price, currency)}</td>
                  <td className="dv-col-num dv-strong">{formatCurrency(it.amount, currency)}</td>
                  <td>{fmtDate(it.required_date)}</td>
                  <td className="dv-li-notes-cell">{it.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* =====================================================================
   * helpers
   * ===================================================================== */
  const NUMERIC_KEYS = new Set(['total', 'po_date', 'updated_at', 'line_count']);

  function sortVal(r, key) {
    if (key === 'line_count') return (r.line_items || []).length;
    const v = r[key];
    if (typeof v === 'number') return v;
    return String(v == null ? '' : v).toLowerCase();
  }

  function fmtDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  function fmtDateShort(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }
  function relTime(v) {
    if (!v) return '';
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return fmtDateShort(v);
  }

  function toCsv(rows) {
    const cols = [
      ['PO #',          (r) => r.po_number],
      ['PO Date',       (r) => fmtDate(r.po_date)],
      ['Revision',      (r) => r.revision],
      ['Customer',      (r) => r.customer],
      ['Supplier',      (r) => r.supplier],
      ['Supplier #',    (r) => r.supplier_code],
      ['Bill To',       (r) => r.bill_to],
      ['Ship To',       (r) => r.ship_to],
      ['Buyer',         (r) => r.buyer],
      ['Buyer Email',   (r) => r.buyer_email],
      ['Buyer Phone',   (r) => r.buyer_phone],
      ['Receiving',     (r) => r.receiving_contact],
      ['Recv. Phone',   (r) => r.receiving_contact_phone],
      ['Payment',       (r) => r.payment_terms],
      ['Freight',       (r) => r.freight_terms],
      ['Ship Via',      (r) => r.ship_via],
      ['F.O.B.',        (r) => r.fob_terms],
      ['Quote #',       (r) => r.quote_number],
      ['Contract #',    (r) => r.contract_number],
      ['Currency',      (r) => r.currency || 'USD'],
      ['Total',         (r) => Number(r.total) || 0],
      ['Status',        (r) => r.status],
      ['Notes',         (r) => r.notes],
      ['Source File',   (r) => r.filename],
      ['Added',         (r) => r.added_at],
      ['Updated',       (r) => r.updated_at],
    ];
    const header = cols.map(([h]) => csvEscape(h)).join(',');
    const lines = rows.map((r) => cols.map(([, fn]) => csvEscape(fn(r))).join(','));
    return [header, ...lines].join('\n');
  }
  function csvEscape(s) {
    const t = String(s == null ? '' : s);
    if (/[",\n]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
    return t;
  }

  window.App = window.App || {};
  window.App.DataView = DataView;
})();
