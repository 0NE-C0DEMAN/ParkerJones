/* ==========================================================================
   UploadView.jsx — Stats + Dropzone + Queue + Recent uploads.
   ========================================================================== */
(() => {
  'use strict';
  const { useMemo } = React;
  const { formatCurrency } = window.App.utils;

  function UploadView({ records, onFiles, onView, queue = [], queueCurrent = -1, onClearQueue, onRemoveFromQueue }) {
    const { Stat, StatGrid, Dropzone, RecentUploadsList, UploadQueue, ChartsGrid, Icon, Badge } = window.App;
    const stats = useMemo(() => {
      const today = new Date();
      const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const week0 = today0 - 6 * 86400000;

      let todayCount = 0, weekCount = 0, totalValue = 0, openCount = 0, weekValue = 0;
      const suppliers = new Set();
      records.forEach((r) => {
        const t = r.added_at ? new Date(r.added_at).getTime() : 0;
        if (t >= today0) todayCount += 1;
        if (t >= week0) {
          weekCount += 1;
          weekValue += Number(r.total) || 0;
        }
        totalValue += Number(r.total) || 0;
        if (r.status && !['invoiced', 'closed'].includes(r.status)) openCount += 1;
        if (r.supplier) suppliers.add(r.supplier);
      });

      return {
        todayCount, weekCount, weekValue, totalValue,
        count: records.length, openCount, supplierCount: suppliers.size,
      };
    }, [records]);

    return (
      <div className="view">
        <StatGrid>
          <Stat label="Captured today" value={stats.todayCount} meta={`${stats.weekCount} this week`} icon="upload-cloud" />
          <Stat label="Total in ledger" value={stats.count} meta={`${formatCurrency(stats.totalValue)} total value`} icon="rows" />
          <Stat label="Open POs" value={stats.openCount} meta="Not yet invoiced or closed" icon="package" />
          <Stat label="Suppliers" value={stats.supplierCount} meta={`${formatCurrency(stats.weekValue)} value this week`} icon="briefcase" />
        </StatGrid>

        <div className="ai-banner">
          <div className="ai-banner-icon"><Icon name="sparkles" size={12} strokeWidth={2} /></div>
          <div className="ai-banner-text">
            <strong>Drop one or many POs</strong> — extracted in sequence with progress shown below.
          </div>
          <Badge tone="accent">Beta</Badge>
        </div>

        {records.length > 0 && (
          <div className="mb-4">
            <ChartsGrid records={records} />
          </div>
        )}

        <Dropzone onFiles={onFiles} />

        {queue.length > 0 && (
          <div className="mt-3">
            <UploadQueue
              queue={queue}
              currentIndex={queueCurrent}
              total={queue.length}
              onClear={onClearQueue}
              onRemove={onRemoveFromQueue}
            />
          </div>
        )}

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
