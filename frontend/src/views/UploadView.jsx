/* ==========================================================================
   UploadView.jsx — Stats + Dropzone + Recent uploads.
   ========================================================================== */
(() => {
  'use strict';
  const { useMemo } = React;
  const { formatCurrency } = window.App.utils;
  const {
    Stat, StatGrid, Dropzone, RecentUploadsList,
    Icon, Badge,
  } = window.App;

  function UploadView({ records, onFiles, onView }) {
    const stats = useMemo(() => {
      const today = new Date();
      const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const week0 = today0 - 6 * 86400000;

      let todayCount = 0, weekCount = 0, totalValue = 0;
      records.forEach((r) => {
        const t = r.addedAt ? new Date(r.addedAt).getTime() : 0;
        if (t >= today0) todayCount += 1;
        if (t >= week0) weekCount += 1;
        totalValue += Number(r.total) || 0;
      });

      const avgValue = records.length ? totalValue / records.length : 0;

      return { todayCount, weekCount, totalValue, avgValue, count: records.length };
    }, [records]);

    return (
      <div className="view">
        <StatGrid>
          <Stat
            label="Captured today"
            value={stats.todayCount}
            meta={`${stats.weekCount} this week`}
            icon="upload-cloud"
          />
          <Stat
            label="Total in ledger"
            value={stats.count}
            meta={`${formatCurrency(stats.totalValue)} total value`}
            icon="rows"
          />
          <Stat
            label="Average PO value"
            value={records.length ? formatCurrency(stats.avgValue) : '—'}
            meta="Across your ledger"
            icon="dollar"
          />
          <Stat
            label="Active reps"
            value="1"
            meta="Just you for now"
            icon="users"
          />
        </StatGrid>

        <div className="ai-banner">
          <div className="ai-banner-icon">
            <Icon name="sparkles" size={12} strokeWidth={2} />
          </div>
          <div className="ai-banner-text">
            <strong>Drop any PO format</strong> — the LLM handles vendor variations, line items, and addresses. Try a sample: <kbd>meridian</kbd>, <kbd>summit</kbd>, or <kbd>apex</kbd>.
          </div>
          <Badge tone="accent">Beta</Badge>
        </div>

        <Dropzone onFiles={onFiles} />

        <div className="mt-6 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="h-2">Recent</h2>
            <Badge tone="default">{Math.min(records.length, 5)}</Badge>
          </div>
          {records.length > 0 && (
            <span className="text-sm text-muted">Last 5 of {records.length}</span>
          )}
        </div>

        <RecentUploadsList records={records} onView={onView} />
      </div>
    );
  }

  window.App = window.App || {};
  window.App.UploadView = UploadView;
})();
