/* ==========================================================================
   RepositoryTable.jsx — Sortable + selectable + status-changeable ledger.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useMemo } = React;
  // NOTE: do NOT destructure window.App here — components defined in scripts
  // that load AFTER this one would be `undefined` at module-load time and
  // permanently captured. Look them up inside each component instead.
  const { formatCurrency, formatDate, relativeTime, cn, truncate } = window.App.utils;

  function RepositoryTable({
    records, onDelete, onEdit,
    onStatusChange, selectedIds, onToggleSelect, onToggleAll,
    sortKey, sortDir, onSort,
  }) {
    const { EmptyState } = window.App;
    const [expandedId, setExpandedId] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    if (!records || records.length === 0) {
      return (
        <EmptyState
          icon="rows"
          title="Your ledger is empty"
          text="Once you confirm extracted POs, they'll show up here. Each row links back to its source file and can be edited or removed."
        />
      );
    }

    const allSelected = records.length > 0 && records.every((r) => selectedIds?.has(r.id));
    const someSelected = !allSelected && records.some((r) => selectedIds?.has(r.id));

    return (
      <div className="table-card">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32, paddingRight: 0 }}>
                  <input
                    type="checkbox"
                    className="row-checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={(e) => onToggleAll?.(e.target.checked)}
                    title={allSelected ? 'Deselect all' : 'Select all'}
                  />
                </th>
                <th style={{ width: 28 }} />
                <SortableHeader k="po_number" label="PO #" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableHeader k="customer"  label="Customer" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableHeader k="supplier"  label="Supplier" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableHeader k="po_date"   label="PO Date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th>Status</th>
                <SortableHeader k="line_count" label="Lines" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
                <SortableHeader k="total"     label="Total" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
                <th>Created by</th>
                <SortableHeader k="updated_at" label="Updated" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <RowGroup
                  key={r.id}
                  record={r}
                  expanded={expandedId === r.id}
                  onToggle={() => setExpandedId((c) => c === r.id ? null : r.id)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onStatusChange={onStatusChange}
                  selected={selectedIds?.has(r.id)}
                  onToggleSelect={onToggleSelect}
                  confirmDelete={confirmDeleteId === r.id}
                  setConfirmDelete={(v) => setConfirmDeleteId(v ? r.id : null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function SortableHeader({ k, label, sortKey, sortDir, onSort, numeric }) {
    const { Icon } = window.App;
    const active = sortKey === k;
    return (
      <th
        className={cn(numeric && 'col-num', 'sortable-header')}
        onClick={() => onSort?.(k)}
        title={`Sort by ${label}`}
      >
        <span className="sortable-header-inner">
          {label}
          {active ? (
            <Icon
              name="chevron-down"
              size={11}
              style={{ transform: sortDir === 'asc' ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', color: 'var(--accent)' }}
            />
          ) : (
            <Icon name="chevron-down" size={11} style={{ color: 'var(--text-subtle)', opacity: 0.4 }} />
          )}
        </span>
      </th>
    );
  }

  function RowGroup({
    record, expanded, onToggle, onEdit, onDelete, onStatusChange,
    selected, onToggleSelect, confirmDelete, setConfirmDelete,
  }) {
    const { Icon, Badge, Button, StatusChooser, ActivityLog } = window.App;
    const createdBy = record.created_by_email || '';
    const createdInitials = createdBy
      ? createdBy.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
      : '—';

    return (
      <>
        <tr className={cn(expanded && 'expanded', selected && 'selected')} onClick={onToggle}>
          <td onClick={(e) => e.stopPropagation()} style={{ paddingRight: 0 }}>
            <input
              type="checkbox"
              className="row-checkbox"
              checked={!!selected}
              onChange={(e) => onToggleSelect?.(record.id, e.target.checked)}
            />
          </td>
          <td>
            <Icon
              name="chevron-right"
              size={13}
              style={{ color: 'var(--text-subtle)', transition: 'transform 200ms', transform: expanded ? 'rotate(90deg)' : 'none' }}
            />
          </td>
          <td>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 600 }}>{record.po_number}</span>
          </td>
          <td title={record.customer}>{truncate(record.customer || '—', 24)}</td>
          <td title={record.supplier}>{truncate(record.supplier || '—', 24)}</td>
          <td>{formatDate(record.po_date)}</td>
          <td onClick={(e) => e.stopPropagation()}>
            <StatusChooser status={record.status || 'received'} onChange={(s) => onStatusChange?.(record.id, s)} />
          </td>
          <td className="col-num">{(record.line_items || []).length}</td>
          <td className="col-num" style={{ fontWeight: 600 }}>{formatCurrency(record.total, record.currency)}</td>
          <td title={createdBy || 'Unknown'}>
            {createdBy ? (
              <span className="created-by-chip">
                <span className="created-by-avatar">{createdInitials}</span>
                <span className="created-by-email">{truncate(createdBy.split('@')[0], 14)}</span>
              </span>
            ) : <span className="text-subtle">—</span>}
          </td>
          <td className="text-sm text-muted" title={record.updated_at}>{relativeTime(record.updated_at || record.added_at)}</td>
          <td className="col-actions" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-1 justify-end items-center">
              <Button variant="ghost" size="sm" iconOnly="pencil" onClick={() => onEdit?.(record.id)} title="Edit / Review" />
              {confirmDelete ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} style={{ fontSize: 11 }}>Cancel</Button>
                  <Button variant="danger" size="sm" iconLeft="trash" onClick={() => { onDelete?.(record.id); setConfirmDelete(false); }}>Delete</Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" iconOnly="trash" onClick={() => setConfirmDelete(true)} title="Remove from ledger" />
              )}
            </div>
          </td>
        </tr>
        {expanded && (
          <tr className="expanded-row">
            <td colSpan={12}>
              <div className="expanded-content">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-xs">Line items · {record.po_number}</div>
                    <div className="text-sm text-muted mt-1">{record.filename}</div>
                  </div>
                  <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {record.supplier_code && (
                      <Badge tone="default" title={`Supplier code at ${record.customer || 'customer'}`}>
                        <Icon name="hash" size={11} />Supplier #: <span style={{ fontFamily: 'JetBrains Mono' }}>{record.supplier_code}</span>
                      </Badge>
                    )}
                    {record.contract_number && (
                      <Badge tone="default"><Icon name="file-text" size={11} />Contract #: <span style={{ fontFamily: 'JetBrains Mono' }}>{record.contract_number}</span></Badge>
                    )}
                    {record.quote_number && (
                      <Badge tone="default"><Icon name="tag" size={11} />Quote #: <span style={{ fontFamily: 'JetBrains Mono' }}>{record.quote_number}</span></Badge>
                    )}
                    {record.bill_to && (
                      <Badge tone="default"><Icon name="map-pin" size={11} />Bill: {truncate(record.bill_to.split('\n')[0], 24)}</Badge>
                    )}
                    {record.ship_to && (
                      <Badge tone="default"><Icon name="truck" size={11} />Ship: {truncate(record.ship_to.split('\n')[0], 24)}</Badge>
                    )}
                  </div>
                </div>

                {/* Terms & contacts strip — only shows fields that are actually populated */}
                <DetailStrip record={record} />

                <div className="expanded-grid">
                  <table className="expanded-line-table" style={{ minWidth: 0, tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 30 }}>#</th>
                        <th>Customer Part</th>
                        <th>Vendor Part</th>
                        <th>Description</th>
                        <th style={{ width: 50 }} className="col-num">Qty</th>
                        <th style={{ width: 50 }}>UOM</th>
                        <th style={{ width: 90 }} className="col-num">Unit</th>
                        <th style={{ width: 100 }} className="col-num">Amount</th>
                        <th style={{ width: 100 }}>Required</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(record.line_items || []).map((it) => (
                        <tr key={it.line}>
                          <td className="col-num">{it.line}</td>
                          <td style={{ fontFamily: 'JetBrains Mono', fontSize: 11.5 }}>{it.customer_part || '—'}</td>
                          <td style={{ fontFamily: 'JetBrains Mono', fontSize: 11.5 }}>{it.vendor_part || '—'}</td>
                          <td title={it.description}>{truncate(it.description, 60)}</td>
                          <td className="col-num">{it.quantity}</td>
                          <td>{it.uom || '—'}</td>
                          <td className="col-num">{formatCurrency(it.unit_price, record.currency)}</td>
                          <td className="col-num" style={{ fontWeight: 600 }}>{formatCurrency(it.amount, record.currency)}</td>
                          <td>{formatDate(it.required_date)}</td>
                          <td className="text-sm text-muted" title={it.notes}>{truncate(it.notes || '', 40) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {record.notes && (
                    <div className="card mt-3" style={{ padding: 12, background: 'var(--bg-subtle)' }}>
                      <div className="text-xs mb-2" style={{ fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <Icon name="info" size={11} /> &nbsp; PO Notes
                      </div>
                      <div className="text-sm" style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{record.notes}</div>
                    </div>
                  )}

                  {ActivityLog && <ActivityLog record={record} compact />}
                </div>
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  /**
   * Inline strip showing commercial terms + people, gracefully hiding any
   * field that didn't come back from extraction. Designed to be compact
   * so the line items table stays the focal point.
   */
  function DetailStrip({ record }) {
    const { Icon } = window.App;
    const items = [
      { icon: 'credit-card', label: 'Payment',       value: record.payment_terms },
      { icon: 'truck',       label: 'Freight',       value: record.freight_terms },
      { icon: 'navigation',  label: 'Ship via',      value: record.ship_via },
      { icon: 'anchor',      label: 'F.O.B.',        value: record.fob_terms },
      { icon: 'user',        label: 'Buyer',         value: record.buyer },
      { icon: 'mail',        label: 'Buyer email',   value: record.buyer_email },
      { icon: 'phone',       label: 'Buyer phone',   value: record.buyer_phone },
      { icon: 'user-check',  label: 'Receiving',     value: record.receiving_contact },
      { icon: 'phone',       label: 'Receiving ph.', value: record.receiving_contact_phone },
    ].filter((x) => x.value && String(x.value).trim());

    if (!items.length) return null;
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          marginBottom: 12,
        }}
      >
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-2" style={{ fontSize: 11.5, color: 'var(--text)', minWidth: 0 }}>
            <Icon name={it.icon} size={11} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)', fontWeight: 500, flexShrink: 0 }}>{it.label}:</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.value}>
              {it.value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  window.App = window.App || {};
  window.App.RepositoryTable = RepositoryTable;
})();
