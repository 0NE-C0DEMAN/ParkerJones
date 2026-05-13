/* ==========================================================================
   AddressBlock.jsx — Editable parties section (Customer / Supplier / Bill / Ship).
   ========================================================================== */
(() => {
  'use strict';
  const { confidenceFor } = window.App.utils;

  /**
   * Generic party card. Two flavours:
   *   - WITH name slot   (Customer / Supplier) — schema stores company name
   *     in its own field (customer / supplier), with separate *_address.
   *   - WITHOUT name slot (Bill To / Ship To) — schema stores everything
   *     as ONE multi-line string in bill_to / ship_to. The first line of
   *     the textarea is the company name.
   *
   * Callers that need the name slot pass `onChange` (the name handler).
   * Callers that don't (Bill To / Ship To) omit it — we render only the
   * address textarea. This used to render an orphan name input whose
   * value was silently dropped on save.
   */
  function PartyField({ icon, label, value, onChange, addressValue, onAddressChange, addressPlaceholder, confidence, autocompleteField, codeValue, onCodeChange, codePlaceholder }) {
    const { Field, Input, Textarea, Confidence, Icon, Autocomplete } = window.App;
    const hasNameSlot = typeof onChange === 'function';
    return (
      <div className="card" style={{ padding: 14 }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="section-heading-icon"><Icon name={icon} size={12} /></div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {label}
          </div>
          {confidence && <Confidence level={confidence} />}
        </div>
        {hasNameSlot && (
          autocompleteField ? (
            <Autocomplete
              field={autocompleteField}
              value={value}
              onChange={onChange}
              placeholder={`${label} name`}
              className="mb-2"
            />
          ) : (
            <Input
              value={value}
              onChange={onChange}
              placeholder={`${label} name`}
              className="mb-2"
            />
          )
        )}
        {onCodeChange !== undefined && (
          <Input
            value={codeValue || ''}
            onChange={onCodeChange}
            placeholder={codePlaceholder || 'Account / vendor #'}
            className="mb-2"
            style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}
          />
        )}
        <Textarea
          value={addressValue}
          onChange={onAddressChange}
          placeholder={addressPlaceholder}
          rows={hasNameSlot ? 3 : 4}
        />
      </div>
    );
  }

  function AddressBlock({ data, onChange }) {
    // PartyField handles its own component lookups
    const update = (field) => (v) => onChange({ ...data, [field]: v });

    return (
      <div className="grid-2">
        <PartyField
          icon="building"
          label="Customer"
          value={data.customer}
          onChange={update('customer')}
          addressValue={data.customer_address}
          onAddressChange={update('customer_address')}
          addressPlaceholder="Customer address"
          confidence={confidenceFor(data, 'customer')}
          autocompleteField="customer"
        />
        <PartyField
          icon="briefcase"
          label="Supplier"
          value={data.supplier}
          onChange={update('supplier')}
          addressValue={data.supplier_address}
          onAddressChange={update('supplier_address')}
          addressPlaceholder="Supplier address"
          confidence={confidenceFor(data, 'supplier')}
          autocompleteField="supplier"
          codeValue={data.supplier_code}
          onCodeChange={update('supplier_code')}
          codePlaceholder="Supplier # / vendor code"
        />
        <PartyField
          icon="map-pin"
          label="Bill To"
          addressValue={data.bill_to}
          onAddressChange={update('bill_to')}
          addressPlaceholder="Where invoices should be mailed (multi-line)"
          confidence={confidenceFor(data, 'bill_to')}
        />
        <PartyField
          icon="truck"
          label="Ship To"
          addressValue={data.ship_to}
          onAddressChange={update('ship_to')}
          addressPlaceholder="Where goods are delivered (multi-line)"
          confidence={confidenceFor(data, 'ship_to')}
        />
      </div>
    );
  }

  window.App = window.App || {};
  window.App.AddressBlock = AddressBlock;
})();
