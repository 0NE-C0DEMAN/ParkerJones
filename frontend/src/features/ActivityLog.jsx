/* ==========================================================================
   ActivityLog.jsx — Per-PO audit history derived from the existing
   created_by/updated_by/timestamps. Shown in the expanded row of the
   Repository table (and on the Profile / future activity views).
   ========================================================================== */
(() => {
  'use strict';
  const { formatDateTime, relativeTime } = window.App.utils;
  const { Icon } = window.App;

  function ActivityLog({ record, compact = false }) {
    const events = [];

    if (record.added_at) {
      events.push({
        kind: 'created',
        icon: 'plus',
        label: 'Created',
        actor: record.created_by_email || 'system',
        at: record.added_at,
      });
    }

    if (record.updated_at && record.updated_at !== record.added_at) {
      events.push({
        kind: 'updated',
        icon: 'pencil',
        label: 'Updated',
        actor: record.updated_by_email || record.created_by_email || 'system',
        at: record.updated_at,
      });
    }

    if (record.has_source) {
      events.push({
        kind: 'source',
        icon: 'file-text',
        label: 'Source file attached',
        actor: record.created_by_email || 'system',
        at: record.added_at,
      });
    }

    if (events.length === 0) return null;

    // Sort newest first
    events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));

    return (
      <div className={`activity-log ${compact ? 'activity-log-compact' : ''}`}>
        <div className="activity-log-title">
          <Icon name="info" size={12} />
          <span>Activity</span>
        </div>
        <ul className="activity-log-list">
          {events.map((e, i) => (
            <li key={i} className="activity-log-item">
              <span className={`activity-log-icon activity-${e.kind}`}>
                <Icon name={e.icon} size={11} />
              </span>
              <div className="activity-log-body">
                <div>
                  <strong>{e.label}</strong>
                  <span className="text-muted"> by {e.actor.split('@')[0]}</span>
                </div>
                <span className="activity-log-time" title={formatDateTime(e.at)}>
                  {relativeTime(e.at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.ActivityLog = ActivityLog;
})();
