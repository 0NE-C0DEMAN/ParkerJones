/* ==========================================================================
   ReportsView.jsx — Operational analytics dashboard.

   Period selector across the top (7d / 30d / 90d / This year / All time),
   then a grid of charts:
     - Volume over time         (POs / month, line)
     - Spend over time          ($ / month, bar)
     - Top 10 customers         (horizontal bars)
     - Top 10 suppliers         (horizontal bars)
     - Status breakdown         (donut, existing component)
     - Cycle-time histogram     (days from received → shipped)
     - Aging table              (open POs by days since received)
     - Created-by leaderboard   (which rep onboarded how many POs)

   All charts pull from the in-memory `records` array — no extra API
   round-trip. The period selector filters that array client-side, which
   is plenty fast for a 5-figure ledger and keeps the view snappy.
   ========================================================================== */
(() => {
  'use strict';
  const { useMemo, useState } = React;
  const { Icon, Card, Segmented, StatusDonut } = window.App;
  const { formatCurrency, formatDate, relativeTime } = window.App.utils;

  const PERIODS = [
    { value: 'all',  label: 'All' },
    { value: '7d',   label: '7d'  },
    { value: '30d',  label: '30d' },
    { value: '90d',  label: '90d' },
    { value: 'ytd',  label: 'YTD' },
  ];

  function ReportsView({ records }) {
    const [period, setPeriod] = useState('all');

    const filtered = useMemo(() => {
      if (period === 'all') return records || [];
      const now = new Date();
      const cutoff = period === 'ytd'
        ? new Date(now.getFullYear(), 0, 1)
        : new Date(now.getTime() - daysFromPeriod(period) * 86400000);
      return (records || []).filter((r) => {
        const d = parseDate(r.added_at) || parseDate(r.po_date);
        return d && d >= cutoff;
      });
    }, [records, period]);

    const totalSpend = useMemo(
      () => filtered.reduce((s, r) => s + (Number(r.total) || 0), 0),
      [filtered]
    );
    const lineCount = useMemo(
      () => filtered.reduce((s, r) => s + ((r.line_items || []).length), 0),
      [filtered]
    );
    const uniqueCustomers = useMemo(
      () => new Set(filtered.map((r) => r.customer).filter(Boolean)).size,
      [filtered]
    );

    return (
      <div className="view reports-view">
        <div className="reports-toolbar">
          <div className="reports-period">
            <span className="reports-period-label">Period</span>
            <Segmented value={period} onChange={setPeriod} options={PERIODS} />
          </div>
          <div className="reports-summary">
            <SummaryStat label="POs"        value={filtered.length} />
            <SummaryStat label="Lines"      value={lineCount} />
            <SummaryStat label="Customers"  value={uniqueCustomers} />
            <SummaryStat label="Total spend" value={formatCurrency(totalSpend)} mono />
          </div>
        </div>

        <div className="reports-grid">
          <VolumeChart records={filtered} />
          <SpendChart  records={filtered} />
          <TopChart    records={filtered} field="customer" title="Top customers by spend"  icon="building"   />
          <TopChart    records={filtered} field="supplier" title="Top suppliers by spend"  icon="briefcase" />
          <StatusDonut records={filtered} />
          <CycleTimeChart records={filtered} />
          <CreatedByLeaderboard records={filtered} />
          <AgingTable records={filtered} />
        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /* Period helpers                                                          */
  /* ────────────────────────────────────────────────────────────────────── */
  function daysFromPeriod(p) {
    return p === '7d' ? 7 : p === '30d' ? 30 : p === '90d' ? 90 : 365;
  }
  function parseDate(v) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function shortMonth(d) {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /* Components                                                              */
  /* ────────────────────────────────────────────────────────────────────── */
  function SummaryStat({ label, value, mono }) {
    return (
      <div className="reports-summary-stat">
        <span className="reports-summary-label">{label}</span>
        <span className={'reports-summary-value' + (mono ? ' mono' : '')}>{value}</span>
      </div>
    );
  }

  /* Monthly volume — POs per month, bar chart */
  function VolumeChart({ records }) {
    const data = useMemo(() => byMonth(records, () => 1), [records]);
    const max = Math.max(1, ...data.map((d) => d.v));
    return (
      <ChartCard title="Volume over time" subtitle="POs added per month" icon="rows" wide>
        {data.length === 0 ? (
          <EmptyChart message="No POs in this period." />
        ) : (
          <div className="reports-bars">
            {data.map((d) => (
              <div key={d.k} className="reports-bar" title={`${d.month}: ${d.v} PO${d.v === 1 ? '' : 's'}`}>
                <div className="reports-bar-fill" style={{ height: `${(d.v / max) * 100}%` }}>
                  <span className="reports-bar-value">{d.v}</span>
                </div>
                <div className="reports-bar-label">{d.month}</div>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    );
  }

  /* Monthly spend — $ per month, bar chart */
  function SpendChart({ records }) {
    const data = useMemo(() => byMonth(records, (r) => Number(r.total) || 0), [records]);
    const max = Math.max(1, ...data.map((d) => d.v));
    return (
      <ChartCard title="Spend over time" subtitle="Dollar value of POs per month" icon="dollar" wide>
        {data.length === 0 ? (
          <EmptyChart message="No spend in this period." />
        ) : (
          <div className="reports-bars">
            {data.map((d) => (
              <div key={d.k} className="reports-bar" title={`${d.month}: ${formatCurrency(d.v)}`}>
                <div className="reports-bar-fill reports-bar-fill-accent" style={{ height: `${(d.v / max) * 100}%` }}>
                  <span className="reports-bar-value">{compactDollar(d.v)}</span>
                </div>
                <div className="reports-bar-label">{d.month}</div>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    );
  }

  /* Top N customers or suppliers — horizontal bars */
  function TopChart({ records, field, title, icon }) {
    const data = useMemo(() => {
      const acc = new Map();
      (records || []).forEach((r) => {
        const k = r[field];
        if (!k) return;
        const prev = acc.get(k) || { name: k, total: 0, count: 0 };
        prev.total += Number(r.total) || 0;
        prev.count += 1;
        acc.set(k, prev);
      });
      return [...acc.values()].sort((a, b) => b.total - a.total).slice(0, 10);
    }, [records, field]);
    const max = Math.max(1, ...data.map((d) => d.total));
    return (
      <ChartCard title={title} subtitle={`${data.length} of total`} icon={icon}>
        {data.length === 0 ? (
          <EmptyChart message="No data in this period." />
        ) : (
          <ul className="reports-hbars">
            {data.map((d) => (
              <li key={d.name} className="reports-hbar">
                <span className="reports-hbar-name" title={d.name}>{d.name}</span>
                <span className="reports-hbar-track">
                  <span className="reports-hbar-fill" style={{ width: `${(d.total / max) * 100}%` }} />
                </span>
                <span className="reports-hbar-value">{formatCurrency(d.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
    );
  }

  /* Cycle time — days from added_at → updated_at (rough proxy for active
     work). A histogram of buckets (<7d / 7-14d / 14-30d / 30+d). */
  function CycleTimeChart({ records }) {
    const data = useMemo(() => {
      const buckets = { '<7 days': 0, '7–14 days': 0, '14–30 days': 0, '30+ days': 0 };
      (records || []).forEach((r) => {
        const added = parseDate(r.added_at);
        const updated = parseDate(r.updated_at);
        if (!added || !updated) return;
        const days = (updated - added) / 86400000;
        if (days < 7) buckets['<7 days']++;
        else if (days < 14) buckets['7–14 days']++;
        else if (days < 30) buckets['14–30 days']++;
        else buckets['30+ days']++;
      });
      return Object.entries(buckets).map(([k, v]) => ({ k, v }));
    }, [records]);
    const max = Math.max(1, ...data.map((d) => d.v));
    return (
      <ChartCard title="Cycle time" subtitle="Time from upload to last update" icon="calendar">
        <div className="reports-bars reports-bars-compact">
          {data.map((d) => (
            <div key={d.k} className="reports-bar" title={`${d.k}: ${d.v}`}>
              <div className="reports-bar-fill" style={{ height: `${(d.v / max) * 100}%` }}>
                <span className="reports-bar-value">{d.v}</span>
              </div>
              <div className="reports-bar-label">{d.k}</div>
            </div>
          ))}
        </div>
      </ChartCard>
    );
  }

  /* Per-rep leaderboard — who's adding the most POs */
  function CreatedByLeaderboard({ records }) {
    const data = useMemo(() => {
      const acc = new Map();
      (records || []).forEach((r) => {
        const k = r.created_by_email || 'Unknown';
        const prev = acc.get(k) || { name: k, count: 0, total: 0 };
        prev.count += 1;
        prev.total += Number(r.total) || 0;
        acc.set(k, prev);
      });
      return [...acc.values()].sort((a, b) => b.count - a.count).slice(0, 8);
    }, [records]);
    return (
      <ChartCard title="Created-by leaderboard" subtitle="Who's adding the most POs" icon="users">
        {data.length === 0 ? (
          <EmptyChart message="No activity in this period." />
        ) : (
          <ul className="reports-leaderboard">
            {data.map((d, i) => (
              <li key={d.name} className="reports-lb-row">
                <span className="reports-lb-rank">#{i + 1}</span>
                <span className="reports-lb-name" title={d.name}>{d.name.split('@')[0]}</span>
                <span className="reports-lb-count">{d.count} {d.count === 1 ? 'PO' : 'POs'}</span>
                <span className="reports-lb-total">{formatCurrency(d.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
    );
  }

  /* Aging — open POs sorted by days since added; >14 days flagged red */
  function AgingTable({ records }) {
    const data = useMemo(() => {
      const now = new Date();
      return (records || [])
        .filter((r) => r.status !== 'shipped' && r.status !== 'closed')
        .map((r) => {
          const added = parseDate(r.added_at);
          const days = added ? Math.floor((now - added) / 86400000) : 0;
          return { ...r, _days: days };
        })
        .sort((a, b) => b._days - a._days)
        .slice(0, 15);
    }, [records]);
    return (
      <ChartCard title="Aging" subtitle="Open POs — oldest first" icon="alert-triangle" wide>
        {data.length === 0 ? (
          <EmptyChart message="No open POs in this period." />
        ) : (
          <ul className="reports-aging">
            {data.map((r) => (
              <li key={r.id} className={'reports-aging-row' + (r._days >= 14 ? ' is-stale' : '')}>
                <span className="reports-aging-po">{r.po_number || '—'}</span>
                <span className="reports-aging-cust">{r.customer || '—'}</span>
                <span className="reports-aging-total">{formatCurrency(r.total, r.currency)}</span>
                <span className="reports-aging-days">{r._days}d</span>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
    );
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /* Atoms                                                                   */
  /* ────────────────────────────────────────────────────────────────────── */
  function ChartCard({ title, subtitle, icon, wide, children }) {
    return (
      <div className={'reports-card' + (wide ? ' reports-card-wide' : '')}>
        <div className="reports-card-header">
          <Icon name={icon || 'rows'} size={13} />
          <div className="reports-card-titles">
            <div className="reports-card-title">{title}</div>
            {subtitle && <div className="reports-card-subtitle">{subtitle}</div>}
          </div>
        </div>
        <div className="reports-card-body">{children}</div>
      </div>
    );
  }
  function EmptyChart({ message }) {
    return <div className="reports-empty">{message}</div>;
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /* Aggregations                                                            */
  /* ────────────────────────────────────────────────────────────────────── */
  function byMonth(records, valueOf) {
    const acc = new Map();
    (records || []).forEach((r) => {
      const d = parseDate(r.added_at) || parseDate(r.po_date);
      if (!d) return;
      const k = monthKey(d);
      const prev = acc.get(k) || { k, d, v: 0, month: shortMonth(d) };
      prev.v += valueOf(r);
      acc.set(k, prev);
    });
    // Sort chronological + cap to last 12 months for readability.
    return [...acc.values()].sort((a, b) => a.k.localeCompare(b.k)).slice(-12);
  }
  function compactDollar(n) {
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${Math.round(n)}`;
  }

  window.App = window.App || {};
  window.App.ReportsView = ReportsView;
})();
