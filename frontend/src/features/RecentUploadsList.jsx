/* ==========================================================================
   RecentUploadsList.jsx — Last N entries of the repository on the upload screen.
   ========================================================================== */
(() => {
  'use strict';
  const { formatCurrency, formatDate, relativeTime, fileTypeBadge } = window.App.utils;
  const { Icon, Badge, EmptyState } = window.App;

  function RecentUploadsList({ records, onView, limit = 5 }) {
    const recent = (records || []).slice(0, limit);

    if (recent.length === 0) {
      return (
        <EmptyState
          icon="inbox"
          title="No POs yet"
          text="Drop your first purchase order above to get started. Extracted data is saved to your local ledger."
        />
      );
    }

    return (
      <div className="file-list">
        {recent.map((r) => {
          const fileBadge = fileTypeBadge(r.filename || '');
          return (
            <div key={r.id} className="file-item" onClick={() => onView?.(r)} style={{ cursor: 'pointer' }}>
              <div className={`file-icon ${fileBadge.class}`}>{fileBadge.label}</div>
              <div className="file-info">
                <div className="file-name">
                  <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 600, color: 'var(--text)' }}>{r.po_number}</span>
                  <span className="text-muted" style={{ marginLeft: 8 }}>· {r.customer || '—'}</span>
                </div>
                <div className="file-meta">
                  <span>{formatCurrency(r.total, r.currency)}</span>
                  <span>·</span>
                  <span>{(r.line_items || []).length} {(r.line_items || []).length === 1 ? 'line' : 'lines'}</span>
                  <span>·</span>
                  <span>{relativeTime(r.addedAt)}</span>
                </div>
              </div>
              <Badge tone="success" dot>Added</Badge>
              <Icon name="chevron-right" size={14} className="text-subtle" />
            </div>
          );
        })}
      </div>
    );
  }

  window.App = window.App || {};
  window.App.RecentUploadsList = RecentUploadsList;
})();
