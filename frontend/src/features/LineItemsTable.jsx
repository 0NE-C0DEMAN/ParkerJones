/* ==========================================================================
   LineItemsTable.jsx — Editable line-items table with add/delete + auto totals.
   Each row's `amount` is auto-recomputed from quantity × unit_price.
   ========================================================================== */
(() => {
  'use strict';
  const { useMemo } = React;
  const { formatCurrency, lineItemsTotal } = window.App.utils;
  const { Icon, Button } = window.App;

  function LineItemsTable({ items, onChange, currency = 'USD' }) {
    const total = useMemo(() => lineItemsTotal(items), [items]);

    const updateRow = (idx, patch) => {
      const next = items.map((row, i) => {
        if (i !== idx) return row;
        const merged = { ...row, ...patch };
        // Auto-calculate amount when quantity or unit_price changes
        if ('quantity' in patch || 'unit_price' in patch) {
          const q = Number(merged.quantity) || 0;
          const p = Number(merged.unit_price) || 0;
          merged.amount = +(q * p).toFixed(2);
        }
        return merged;
      });
      onChange(next);
    };

    const addRow = () => {
      const nextLine = items.length > 0 ? Math.max(...items.map((it) => it.line || 0)) + 1 : 1;
      onChange([
        ...items,
        { line: nextLine, customer_part: '', vendor_part: '', description: '', quantity: 1, uom: 'EA', unit_price: 0, amount: 0, required_date: '', notes: '' },
      ]);
    };

    const deleteRow = (idx) => {
      onChange(items.filter((_, i) => i !== idx));
    };

    return (
      <div className="card line-items-card">
        <div style={{ overflowX: 'auto' }}>
          <table className="line-items-table">
            <thead>
              <tr>
                {/* Description is the SINGLE field for every part identifier
                    on the line — no Customer Part / Vendor Part split.
                    Backing schema still has those fields for older data
                    (folded into description here on first edit). */}
                <th style={{ minWidth: 40 }}>#</th>
                <th style={{ minWidth: 320 }}>Description</th>
                <th style={{ minWidth: 80 }} className="col-num">Qty</th>
                <th style={{ minWidth: 56 }}>UOM</th>
                <th style={{ minWidth: 100 }} className="col-num">Unit Price</th>
                <th style={{ minWidth: 110 }} className="col-num">Amount</th>
                <th style={{ minWidth: 130 }}>Required</th>
                <th style={{ minWidth: 160 }}>Notes</th>
                <th style={{ minWidth: 36 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => (
                <tr key={idx}>
                  <td className="col-num"><CellInput value={row.line} onChange={(v) => updateRow(idx, { line: v })} /></td>
                  {/* Textarea, not single-line input, so a long PO line
                      stays readable (e.g. "39004430 CRTKAA08E120510KTHVAU0037
                      / SEC LGT HEAD ONLY 29W LED / CRTK2-C016-..." etc.). */}
                  <td>
                    <CellTextarea
                      value={fullDescription(row)}
                      onChange={(v) => updateRow(idx, { description: v, customer_part: '', vendor_part: '' })}
                      placeholder="Part numbers, product description, everything on the line"
                    />
                  </td>
                  <td className="col-num"><CellInput type="number" value={row.quantity} onChange={(v) => updateRow(idx, { quantity: Number(v) || 0 })} /></td>
                  <td><CellInput value={row.uom} onChange={(v) => updateRow(idx, { uom: v })} placeholder="EA" /></td>
                  <td className="col-num"><CellInput type="number" value={row.unit_price} onChange={(v) => updateRow(idx, { unit_price: Number(v) || 0 })} /></td>
                  <td className="col-num" style={{ fontFamily: 'JetBrains Mono', fontWeight: 600, color: 'var(--text)' }}>
                    {formatCurrency(row.amount, currency)}
                  </td>
                  <td><CellInput type="date" value={row.required_date} onChange={(v) => updateRow(idx, { required_date: v })} /></td>
                  <td><CellInput value={row.notes} onChange={(v) => updateRow(idx, { notes: v })} placeholder="—" /></td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => deleteRow(idx)}
                      title="Delete row"
                      style={{ color: 'var(--text-subtle)' }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="line-items-add-row">
          <Button variant="ghost" size="sm" iconLeft="plus" onClick={addRow}>
            Add line
          </Button>
          <span className="text-sm text-muted">{items.length} {items.length === 1 ? 'line' : 'lines'}</span>
        </div>

        <div className="line-items-totals">
          <div>
            <div className="label">Subtotal</div>
            <div className="value grand">{formatCurrency(total, currency)}</div>
          </div>
        </div>
      </div>
    );
  }

  // Fold any LLM-split part numbers back into the description so the rep
  // edits ONE field. The first edit re-saves with customer_part /
  // vendor_part empty — the description becomes the single source of
  // truth going forward.
  function fullDescription(row) {
    const desc = String(row?.description || '').trim();
    const cp = String(row?.customer_part || '').trim();
    const vp = String(row?.vendor_part || '').trim();
    const parts = [];
    if (cp && !desc.includes(cp)) parts.push(cp);
    if (vp && vp !== cp && !desc.includes(vp)) parts.push(vp);
    if (desc) parts.push(desc);
    return parts.join(' ').trim();
  }

  function CellTextarea({ value, onChange, placeholder }) {
    return (
      <textarea
        className="li-desc-textarea"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        rows={1}
      />
    );
  }

  function CellInput({ value, onChange, type = 'text', placeholder }) {
    // Always derive a renderable value so number inputs never appear blank
    // when the LLM dropped a field (the previous bug: missing qty → input
    // value={undefined}/{null}/{''} → empty input that looked unfilled).
    let renderValue;
    if (type === 'number') {
      const n = Number(value);
      renderValue = Number.isFinite(n) ? n : 0;
    } else if (type === 'date') {
      // HTML date inputs require strict YYYY-MM-DD; otherwise they render blank
      renderValue = (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
        ? value.slice(0, 10)
        : '';
    } else {
      renderValue = value ?? '';
    }
    return (
      <input
        type={type}
        value={renderValue}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  window.App = window.App || {};
  window.App.LineItemsTable = LineItemsTable;
})();
