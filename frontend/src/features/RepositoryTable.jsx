/* ==========================================================================
   RepositoryTable.jsx — Full ledger table with row expansion to view line items.
   ========================================================================== */
(() => {
  'use strict';
  const { useState } = React;
  const { formatCurrency, formatDate, relativeTime, cn, truncate } = window.App.utils;
  const { Icon, Badge, Button, EmptyState } = window.App;

  function RepositoryTable({ records, onDelete, onEdit, onView }) {
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

    const toggle = (id) => setExpandedId((curr) => (curr === id ? null : id));

    return (
      <div className="table-card">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>PO Number</th>
                <th>Customer</th>
                <th>Supplier</th>
                <th>PO Date</th>
                <th>Terms</th>
                <th className="col-num">Lines</th>
                <th className="col-num">Total</th>
                <th>Added</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <RowGroup
                  key={r.id}
                  record={r}
                  expanded={expandedId === r.id}
                  onToggle={() => toggle(r.id)}
                  onEdit={onEdit}
                  onDelete={onDelete}
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

  function RowGroup({ record, expanded, onToggle, onEdit, onDelete, confirmDelete, setConfirmDelete }) {
    return (
      <>
        <tr className={cn(expanded && 'expanded')} onClick={onToggle}>
          <td>
            <Icon
              name="chevron-right"
              size={14}
              style={{ color: 'var(--text-subtle)', transition: 'transform 200ms', transform: expanded ? 'rotate(90deg)' : 'none' }}
            />
          </td>
          <td>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 600 }}>{record.po_number}</span>
          </td>
          <td title={record.customer}>{truncate(record.customer || '—', 28)}</td>
          <td title={record.supplier}>{truncate(record.supplier || '—', 28)}</td>
          <td>{formatDate(record.po_date)}</td>
          <td><Badge tone="default">{record.payment_terms || '—'}</Badge></td>
          <td className="col-num">{(record.line_items || []).length}</td>
          <td className="col-num" style={{ fontWeight: 600 }}>{formatCurrency(record.total, record.currency)}</td>
          <td className="text-sm text-muted" title={record.addedAt}>{relativeTime(record.addedAt)}</td>
          <td className="col-actions" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-1 justify-end items-center">
              <Button
                variant="ghost"
                size="sm"
                iconOnly="pencil"
                onClick={() => onEdit?.(record.id)}
                title="Edit / Review"
              />
              {confirmDelete ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                    title="Cancel"
                    style={{ fontSize: 11 }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    iconLeft="trash"
                    onClick={() => { onDelete?.(record.id); setConfirmDelete(false); }}
                    title="Confirm delete"
                  >
                    Delete
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly="trash"
                  onClick={() => setConfirmDelete(true)}
                  title="Remove from ledger"
                />
              )}
            </div>
          </td>
        </tr>
        {expanded && (
          <tr className="expanded-row">
            <td colSpan={10}>
              <div className="expanded-content">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-xs">Line items · {record.po_number}</div>
                    <div className="text-sm text-muted mt-1">{record.filename}</div>
                  </div>
                  <div className="flex gap-2 items-center">
                    {record.bill_to && (
                      <Badge tone="default">
                        <Icon name="map-pin" size={11} />
                        Bill: {truncate(record.bill_to.split('\n')[0], 24)}
                      </Badge>
                    )}
                    {record.ship_to && (
                      <Badge tone="default">
                        <Icon name="truck" size={11} />
                        Ship: {truncate(record.ship_to.split('\n')[0], 24)}
                      </Badge>
                    )}
                  </div>
                </div>
                <table className="expanded-line-table">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }}>#</th>
                      <th>Customer Part</th>
                      <th>Vendor Part</th>
                      <th>Description</th>
                      <th style={{ width: 50 }} className="col-num">Qty</th>
                      <th style={{ width: 90 }} className="col-num">Unit</th>
                      <th style={{ width: 100 }} className="col-num">Amount</th>
                      <th style={{ width: 100 }}>Required</th>
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
                        <td className="col-num">{formatCurrency(it.unit_price, record.currency)}</td>
                        <td className="col-num" style={{ fontWeight: 600 }}>{formatCurrency(it.amount, record.currency)}</td>
                        <td>{formatDate(it.required_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  window.App = window.App || {};
  window.App.RepositoryTable = RepositoryTable;
})();
