/* ==========================================================================
   RepositoryView.jsx — All confirmed POs, with search, filter, and Excel export.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useMemo } = React;
  const { formatCurrency } = window.App.utils;
  const {
    Stat, StatGrid, RepositoryTable, SearchInput,
    Icon, Button, Segmented, Badge,
  } = window.App;

  function RepositoryView({ records, onDelete, onEdit, onView, onDownload }) {
    const [query, setQuery] = useState('');
    const [period, setPeriod] = useState('all');

    const filtered = useMemo(() => {
      let arr = [...records];

      if (period !== 'all') {
        const now = Date.now();
        const cutoffs = { '7d': 7, '30d': 30, '90d': 90 };
        const days = cutoffs[period];
        if (days) {
          const cutoff = now - days * 86400000;
          arr = arr.filter((r) => new Date(r.addedAt).getTime() >= cutoff);
        }
      }

      if (query.trim()) {
        const q = query.trim().toLowerCase();
        arr = arr.filter((r) =>
          (r.po_number || '').toLowerCase().includes(q) ||
          (r.customer || '').toLowerCase().includes(q) ||
          (r.supplier || '').toLowerCase().includes(q) ||
          (r.line_items || []).some((it) =>
            (it.description || '').toLowerCase().includes(q) ||
            (it.vendor_part || '').toLowerCase().includes(q) ||
            (it.customer_part || '').toLowerCase().includes(q)
          )
        );
      }

      return arr;
    }, [records, query, period]);

    const stats = useMemo(() => {
      const totalValue = filtered.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
      const lineCount = filtered.reduce((sum, r) => sum + (r.line_items || []).length, 0);
      const uniqueSuppliers = new Set(filtered.map((r) => r.supplier).filter(Boolean)).size;
      return { count: filtered.length, totalValue, lineCount, uniqueSuppliers };
    }, [filtered]);

    return (
      <div className="view">
        <StatGrid>
          <Stat label="POs in view" value={stats.count} icon="rows" />
          <Stat label="Total value" value={formatCurrency(stats.totalValue)} icon="dollar" />
          <Stat label="Line items" value={stats.lineCount} icon="package" />
          <Stat label="Unique suppliers" value={stats.uniqueSuppliers} icon="briefcase" />
        </StatGrid>

        <div className="filter-bar">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search PO #, customer, supplier, or part..."
          />
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'all', label: 'All' },
              { value: '7d', label: '7d' },
              { value: '30d', label: '30d' },
              { value: '90d', label: '90d' },
            ]}
          />
          <div className="flex-1" />
          {records.length > 0 && (
            <Button variant="primary" iconLeft="download" onClick={onDownload}>
              Export Excel
            </Button>
          )}
        </div>

        <RepositoryTable
          records={filtered}
          onDelete={onDelete}
          onEdit={onEdit}
          onView={onView}
        />
      </div>
    );
  }

  window.App = window.App || {};
  window.App.RepositoryView = RepositoryView;
})();
