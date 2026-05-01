/* ==========================================================================
   POHeader.jsx — Big PO summary bar at top of review view.
   Shows file thumbnail, PO number/date/buyer, and total.
   ========================================================================== */
(() => {
  'use strict';
  const { formatCurrency, formatDate, fileTypeBadge } = window.App.utils;
  const { Icon } = window.App;

  function POHeader({ data, filename, fileSize }) {
    const ext = fileTypeBadge(filename);
    return (
      <div className="po-header">
        <div className="po-header-left">
          <div className={`po-thumb ${ext.class}`}>{ext.label}</div>
          <div className="flex-1">
            <div className="po-number-display">
              {data.po_number || <span className="text-muted">No PO #</span>}
              {data.revision && data.revision !== '0' && (
                <span className="badge badge-default" style={{ fontSize: 10, fontFamily: 'Inter', fontWeight: 500 }}>Rev {data.revision}</span>
              )}
            </div>
            <div className="po-meta-row">
              {data.po_date && (
                <span className="po-meta-item">
                  <Icon name="calendar" size={12} />
                  {formatDate(data.po_date)}
                </span>
              )}
              {data.buyer && (
                <span className="po-meta-item">
                  <Icon name="user" size={12} />
                  {data.buyer}
                </span>
              )}
              {data.payment_terms && (
                <span className="po-meta-item">
                  <Icon name="dollar" size={12} />
                  {data.payment_terms}
                </span>
              )}
              {filename && (
                <span className="po-meta-item">
                  <Icon name="file-text" size={12} />
                  {filename}
                </span>
              )}
            </div>
          </div>
        </div>
        <div>
          <div className="po-total-label">Total</div>
          <div className="po-total-display">{formatCurrency(data.total, data.currency)}</div>
        </div>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.POHeader = POHeader;
})();
