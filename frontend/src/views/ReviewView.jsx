/* ==========================================================================
   ReviewView.jsx — Either shows the processing animation, OR the editable
   form for the extracted PO with confirm/discard actions.

   Modes:
     - extract: pending.status === 'extracting'  → show animation
     - review:  pending.status === 'review'      → editable form, "Add to ledger"
     - edit:    pending.isEdit === true          → editable form, "Save changes"
     - duplicate: pending.duplicate is set       → banner above form,
                                                   "Update existing" / "Save as new"
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect } = React;
  const { formatCurrency, lineItemsTotal, formatDate } = window.App.utils;
  // Component lookups are deferred into each function body so they resolve
  // at render time, regardless of script load order.
  const _A = () => window.App;

  function ReviewView({ pending, onConfirm, onSaveAsNew, onDiscard }) {
    const { ProcessingState } = _A();
    if (!pending) return null;

    if (pending.status === 'extracting') {
      return (
        <div className="view">
          <ProcessingState stage={pending.stage} filename={pending.filename} />
        </div>
      );
    }

    return (
      <ReviewForm
        pending={pending}
        onConfirm={onConfirm}
        onSaveAsNew={onSaveAsNew}
        onDiscard={onDiscard}
      />
    );
  }

  function ReviewForm({ pending, onConfirm, onSaveAsNew, onDiscard }) {
    const { POHeader, AddressBlock, LineItemsTable, PdfPreview, Icon, Button, Field, Input, Textarea, Card, StatusChooser, Autocomplete } = _A();

    // Normalize incoming data so the form NEVER starts with null/undefined
    // numeric fields — those used to render as blank inputs (the bug Parker
    // hit when opening Edit on a PO whose qty had been dropped during
    // extraction). Belt-and-suspenders with CellInput's render-time guard.
    const normalizeForEdit = (raw) => {
      if (!raw) return raw;
      const safeNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const items = Array.isArray(raw.line_items) ? raw.line_items : [];
      return {
        ...raw,
        total: safeNum(raw.total),
        line_items: items.map((it, idx) => ({
          ...it,
          line: safeNum(it.line) || (idx + 1),
          quantity: safeNum(it.quantity),
          unit_price: safeNum(it.unit_price),
          amount: safeNum(it.amount),
          uom: it.uom || 'EA',
          customer_part: it.customer_part ?? '',
          vendor_part: it.vendor_part ?? '',
          description: it.description ?? '',
          required_date: it.required_date ?? '',
          notes: it.notes ?? '',
        })),
      };
    };

    const [data, setData] = useState(() => normalizeForEdit(pending.data));
    const isEdit = !!pending.isEdit;
    const duplicate = pending.duplicate;

    // Reset the form when the rep navigates to a different PO without
    // unmounting the view (e.g. clicking another row's edit button while
    // already inside Review). Keyed off pending.id with a fallback to
    // file/filename so newly extracted POs (no id yet) still trigger.
    const formKey = pending?.id || pending?.file?.name || pending?.filename || '';
    useEffect(() => {
      setData(normalizeForEdit(pending.data));
       // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formKey]);

    // Keep PO total in sync with line item amounts
    useEffect(() => {
      const newTotal = lineItemsTotal(data.line_items);
      if (Math.abs(newTotal - (Number(data.total) || 0)) > 0.001) {
        setData((prev) => ({ ...prev, total: newTotal }));
      }
       // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.line_items]);

    const updateField = (field, value) => setData((prev) => ({ ...prev, [field]: value }));
    const updateLineItems = (line_items) => setData((prev) => ({ ...prev, line_items }));

    const isValid = (data.po_number || '').trim() && (data.customer || '').trim();

    return (
      <div className="view" style={{ paddingBottom: 80 }}>
        <POHeader data={data} filename={pending.filename} />

        {duplicate && !isEdit && <DuplicateBanner duplicate={duplicate} />}
        <ValidationBanner data={data} />

        <div className="review-layout">
          <div className="review-form-col">
        <Card noPadding className="mb-4">
          <div style={{ padding: 16 }}>
            <div className="section-heading">
              <div className="section-heading-icon"><Icon name="file-text" size={11} /></div>
              Header
            </div>
            <div className="form-grid-3">
              <Field label="PO Number" required>
                <Input
                  value={data.po_number}
                  onChange={(v) => updateField('po_number', v)}
                  placeholder="e.g. 13214085"
                  style={{ fontFamily: 'JetBrains Mono' }}
                />
              </Field>
              <Field label="PO Date">
                <Input type="date" value={data.po_date} onChange={(v) => updateField('po_date', v)} />
              </Field>
              <Field label="Revision">
                <Input value={data.revision} onChange={(v) => updateField('revision', v)} placeholder="0" />
              </Field>
              <Field label="Buyer">
                <Autocomplete field="buyer" value={data.buyer} onChange={(v) => updateField('buyer', v)} placeholder="Name" />
              </Field>
              <Field label="Buyer email">
                <Input type="email" value={data.buyer_email} onChange={(v) => updateField('buyer_email', v)} placeholder="email@company.com" />
              </Field>
              <Field label="Buyer phone">
                <Input value={data.buyer_phone || ''} onChange={(v) => updateField('buyer_phone', v)} placeholder="555-123-4567" />
              </Field>
              <Field label="Receiving contact" className="col-span-2">
                <Input value={data.receiving_contact || ''} onChange={(v) => updateField('receiving_contact', v)} placeholder="Person at delivery location" />
              </Field>
              <Field label="Receiving phone">
                <Input value={data.receiving_contact_phone || ''} onChange={(v) => updateField('receiving_contact_phone', v)} placeholder="555-123-4567" />
              </Field>
              <Field label="Currency">
                <Input
                  value={data.currency || 'USD'}
                  onChange={(v) => updateField('currency', (v || '').toUpperCase())}
                  placeholder="USD"
                  style={{ fontFamily: 'JetBrains Mono', textTransform: 'uppercase' }}
                />
              </Field>
              <Field label="Status" className="col-span-2">
                <StatusChooser status={data.status || 'received'} onChange={(s) => updateField('status', s)} />
              </Field>
            </div>
          </div>
        </Card>

        <div className="section-heading mt-4">
          <div className="section-heading-icon"><Icon name="dollar-sign" size={11} /></div>
          Terms &amp; references
        </div>
        <Card noPadding className="mb-4">
          <div style={{ padding: 16 }}>
            <div className="form-grid-3">
              <Field label="Payment terms">
                <Autocomplete field="payment_terms" value={data.payment_terms} onChange={(v) => updateField('payment_terms', v)} placeholder="Net 30" />
              </Field>
              <Field label="Freight terms">
                <Input value={data.freight_terms || ''} onChange={(v) => updateField('freight_terms', v)} placeholder="Prepaid and Allowed" />
              </Field>
              <Field label="Ship via">
                <Input value={data.ship_via || ''} onChange={(v) => updateField('ship_via', v)} placeholder="Best Way / UPS / Carrier" />
              </Field>
              <Field label="F.O.B.">
                <Input value={data.fob_terms || ''} onChange={(v) => updateField('fob_terms', v)} placeholder="Shipping Point / Destination" />
              </Field>
              <Field label="Quote #">
                <Input value={data.quote_number || ''} onChange={(v) => updateField('quote_number', v)} placeholder="QUOTE-XXXX" style={{ fontFamily: 'JetBrains Mono' }} />
              </Field>
              <Field label="Contract #">
                <Input value={data.contract_number || ''} onChange={(v) => updateField('contract_number', v)} placeholder="CONTRACT-XXXX" style={{ fontFamily: 'JetBrains Mono' }} />
              </Field>
            </div>
          </div>
        </Card>

        <div className="section-heading mt-4">
          <div className="section-heading-icon"><Icon name="users" size={11} /></div>
          Parties &amp; addresses
        </div>
        <AddressBlock data={data} onChange={setData} />
          </div>

          <div className="review-pdf-col">
            <PdfPreview
              file={pending.file}
              sourceUrl={pending.sourceUrl}
              filename={pending.filename}
              method={data.extraction_method || pending.data?.extraction_method}
            />
          </div>
        </div>

        {/* Line items + notes span the FULL width of the page (outside the
            form/PDF grid). The line items table needs every pixel it can
            get — 10 editable columns inside half the screen makes the
            value cells too narrow to be readable. The form/PDF split
            above stays for header fields where cross-referencing the
            source PDF actually matters. */}
        <div className="review-fullwidth">
          <div className="section-heading mt-4">
            <div className="section-heading-icon"><Icon name="package" size={11} /></div>
            Line items
          </div>
          <LineItemsTable
            items={data.line_items}
            onChange={updateLineItems}
            currency={data.currency}
          />

          <div className="section-heading mt-4">
            <div className="section-heading-icon"><Icon name="info" size={11} /></div>
            Notes
          </div>
          <Card>
            <Field>
              <Textarea
                value={data.notes || ''}
                onChange={(v) => updateField('notes', v)}
                rows={2}
                placeholder="Internal notes about this PO (optional). Visible in the ledger."
              />
            </Field>
          </Card>
        </div>

        <div className="review-actions">
          <div className="flex items-center gap-3">
            <Button variant="danger" iconLeft="x" onClick={onDiscard}>
              {isEdit ? 'Cancel' : 'Discard'}
            </Button>
            <span className="text-sm text-muted">
              {!isValid && (
                <>
                  <Icon name="alert-circle" size={12} style={{ verticalAlign: 'text-bottom' }} />
                  &nbsp;Add PO number and customer to continue
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">
              Total <strong style={{ color: 'var(--text)', fontFamily: 'JetBrains Mono' }}>{formatCurrency(data.total, data.currency)}</strong>
              &nbsp;·&nbsp;
              {(data.line_items || []).length} {(data.line_items || []).length === 1 ? 'line' : 'lines'}
            </span>

            {duplicate && !isEdit ? (
              <>
                <Button
                  variant="secondary"
                  iconLeft="plus"
                  disabled={!isValid}
                  onClick={() => onSaveAsNew?.(data)}
                  title="Add as a new record (keeps the existing one too)"
                >
                  Save as new
                </Button>
                <Button
                  variant="primary"
                  iconLeft="rotate-cw"
                  disabled={!isValid}
                  onClick={() => onConfirm(data)}
                >
                  Update existing
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                iconLeft={isEdit ? 'check' : 'plus'}
                disabled={!isValid}
                onClick={() => onConfirm(data)}
              >
                {isEdit ? 'Save changes' : 'Add to ledger'}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function ValidationBanner({ data }) {
    const { Icon } = _A();
    const issues = [];
    const computed = (data.line_items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const reported = Number(data.total) || 0;
    if (Math.abs(computed - reported) > 0.5 && reported > 0 && computed > 0) {
      issues.push(
        `Line item sum (${formatCurrency(computed, data.currency)}) doesn't match the PO total (${formatCurrency(reported, data.currency)}) — verify before adding.`
      );
    }
    if (data.po_number && !/[A-Z0-9\-]/i.test(data.po_number)) {
      issues.push(`PO number looks malformed.`);
    }
    if (!data.customer && !data.supplier) {
      issues.push('Both customer and supplier are blank — extraction may have failed.');
    }
    // Per-line sanity — flag lines where critical fields are zero / empty.
    // These usually point to an extraction miss (column drift, layout
    // confusion) rather than a real zero, so it's worth a rep glance.
    (data.line_items || []).forEach((it, idx) => {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unit_price) || 0;
      const amt = Number(it.amount) || 0;
      const lineLabel = `Line ${it.line || idx + 1}`;
      if (qty === 0 && (price > 0 || amt > 0)) {
        issues.push(`${lineLabel}: quantity is 0 but a price or amount is set — extraction likely missed the qty column.`);
      } else if (qty === 0 && price === 0 && amt === 0 && (it.description || '').trim()) {
        issues.push(`${lineLabel}: no quantity, price, or amount captured.`);
      }
      if (!(it.description || '').trim() && qty > 0) {
        issues.push(`${lineLabel}: description is empty — verify before saving.`);
      }
    });
    if (issues.length === 0) return null;
    return (
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 14px',
        marginBottom: 12,
        background: 'var(--warning-light)',
        border: '1px solid rgba(180, 83, 9, 0.25)',
        borderRadius: 'var(--r-md)',
        fontSize: 12.5,
        color: 'var(--warning)',
      }}>
        <Icon name="alert-triangle" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Validation warnings</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0, color: 'var(--text)', fontSize: 12 }}>
            {issues.map((m, i) => <li key={i} style={{ listStyle: 'disc', marginTop: 2 }}>{m}</li>)}
          </ul>
        </div>
      </div>
    );
  }

  function DuplicateBanner({ duplicate }) {
    const { Icon, Badge } = _A();
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        marginBottom: 14,
        background: 'var(--warning-light)',
        border: '1px solid rgba(180, 83, 9, 0.25)',
        borderRadius: 'var(--r-lg)',
        fontSize: 13,
      }}>
        <Icon name="alert-triangle" size={18} style={{ color: 'var(--warning)', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: 'var(--warning)' }}>
            PO #{duplicate.po_number} already exists in your ledger
          </div>
          <div className="text-sm" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
            Added {formatDate(duplicate.added_at)} · {(duplicate.line_items || []).length} line {(duplicate.line_items || []).length === 1 ? 'item' : 'items'} · total {formatCurrency(duplicate.total, duplicate.currency)}
            &nbsp;·&nbsp;Use <strong>Update existing</strong> to overwrite, or <strong>Save as new</strong> to keep both.
          </div>
        </div>
        <Badge tone="warning" dot>Duplicate</Badge>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.ReviewView = ReviewView;
})();
