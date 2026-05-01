/* ==========================================================================
   AddressBlock.jsx — Editable parties section (Customer / Supplier / Bill / Ship).
   ========================================================================== */
(() => {
  'use strict';
  const { Field, Input, Textarea, Confidence, Icon } = window.App;
  const { confidenceFor } = window.App.utils;

  function PartyField({ icon, label, value, onChange, addressValue, onAddressChange, addressPlaceholder, confidence }) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="section-heading-icon"><Icon name={icon} size={12} /></div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {label}
          </div>
          {confidence && <Confidence level={confidence} />}
        </div>
        <Input
          value={value}
          onChange={onChange}
          placeholder={`${label} name`}
          className="mb-2"
        />
        <Textarea
          value={addressValue}
          onChange={onAddressChange}
          placeholder={addressPlaceholder}
          rows={3}
        />
      </div>
    );
  }

  function AddressBlock({ data, onChange }) {
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
        />
        <PartyField
          icon="map-pin"
          label="Bill To"
          value={data.bill_to_name || ''}
          onChange={update('bill_to_name')}
          addressValue={data.bill_to}
          onAddressChange={update('bill_to')}
          addressPlaceholder="Billing address"
          confidence={confidenceFor(data, 'bill_to')}
        />
        <PartyField
          icon="truck"
          label="Ship To"
          value={data.ship_to_name || ''}
          onChange={update('ship_to_name')}
          addressValue={data.ship_to}
          onAddressChange={update('ship_to')}
          addressPlaceholder="Shipping address"
          confidence={confidenceFor(data, 'ship_to')}
        />
      </div>
    );
  }

  window.App = window.App || {};
  window.App.AddressBlock = AddressBlock;
})();
