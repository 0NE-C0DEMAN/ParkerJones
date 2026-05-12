/* ==========================================================================
   Charts.jsx — Hand-rolled SVG charts (no chart library).
     - StatusDonut : status breakdown
     - SpendBars   : top suppliers by spend
     - SpendTrend  : spend by month sparkline
   ========================================================================== */
(() => {
  'use strict';
  const { useMemo } = React;
  const { formatCurrency, truncate } = window.App.utils;
  const { Icon, statusInfo, PO_STATUSES } = window.App;

  // Status tone → CSS color (must match the badge tones in styles.css)
  const TONE_COLOR = {
    default: '#94a3b8',
    info:    '#0369a1',
    warning: '#b45309',
    accent:  '#4f46e5',
    success: '#047857',
    danger:  '#b91c1c',
  };

  function StatusDonut({ records }) {
    const data = useMemo(() => {
      const counts = {};
      (records || []).forEach((r) => {
        const s = r.status || 'received';
        counts[s] = (counts[s] || 0) + 1;
      });
      return PO_STATUSES.map((s) => ({
        ...s,
        count: counts[s.id] || 0,
        color: TONE_COLOR[s.tone] || '#94a3b8',
      })).filter((s) => s.count > 0);
    }, [records]);

    const total = data.reduce((sum, s) => sum + s.count, 0);
    const size = 108;
    const radius = 42;
    const cx = size / 2, cy = size / 2;

    let acc = 0;
    const arcs = data.map((s) => {
      const startA = (acc / total) * 2 * Math.PI - Math.PI / 2;
      acc += s.count;
      const endA = (acc / total) * 2 * Math.PI - Math.PI / 2;
      const x1 = cx + radius * Math.cos(startA);
      const y1 = cy + radius * Math.sin(startA);
      const x2 = cx + radius * Math.cos(endA);
      const y2 = cy + radius * Math.sin(endA);
      const large = (endA - startA) > Math.PI ? 1 : 0;
      const path = total === 1 || s.count === total
        ? `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x1 - 0.01} ${y1 - 0.01} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
      return { ...s, path };
    });

    return (
      <div className="chart-card">
        <div className="chart-header">
          <Icon name="package" size={12} />
          <span>Status breakdown</span>
        </div>
        <div className="chart-body" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {total === 0 ? (
            <div className="chart-empty">No POs yet — drop one to get started.</div>
          ) : (
            <>
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
                {arcs.map((a) => <path key={a.id} d={a.path} fill={a.color} stroke="white" strokeWidth="1.5" />)}
                <circle cx={cx} cy={cy} r={radius - 18} fill="var(--bg-elevated)" />
                <text x={cx} y={cy - 2} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text)">{total}</text>
                <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="var(--text-muted)" letterSpacing="0.05em">TOTAL</text>
              </svg>
              <div className="chart-legend">
                {arcs.map((a) => (
                  <div key={a.id} className="chart-legend-row">
                    <span className="chart-legend-dot" style={{ background: a.color }} />
                    <span className="chart-legend-label">{a.label}</span>
                    <span className="chart-legend-value">{a.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function SpendBars({ records, limit = 5 }) {
    const data = useMemo(() => {
      const totals = {};
      (records || []).forEach((r) => {
        const supplier = r.supplier || 'Unknown';
        totals[supplier] = (totals[supplier] || 0) + (Number(r.total) || 0);
      });
      return Object.entries(totals)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
    }, [records, limit]);

    const max = Math.max(...data.map((d) => d.value), 1);

    return (
      <div className="chart-card">
        <div className="chart-header">
          <Icon name="briefcase" size={12} />
          <span>Top suppliers by spend</span>
        </div>
        <div className="chart-body">
          {data.length === 0 ? (
            <div className="chart-empty">No spend data yet.</div>
          ) : (
            <div className="chart-bars">
              {data.map((d) => (
                <div key={d.name} className="chart-bar-row">
                  <div className="chart-bar-label" title={d.name}>{truncate(d.name, 22)}</div>
                  <div className="chart-bar-track">
                    <div className="chart-bar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
                  </div>
                  <div className="chart-bar-value">{formatCurrency(d.value)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function SpendTrend({ records, months = 6 }) {
    const data = useMemo(() => {
      // Build buckets for the last N months
      const now = new Date();
      const buckets = [];
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({
          key: d.toISOString().slice(0, 7),
          label: d.toLocaleDateString('en-US', { month: 'short' }),
          total: 0,
          count: 0,
        });
      }
      (records || []).forEach((r) => {
        const t = r.po_date || r.added_at;
        if (!t) return;
        const ym = t.slice(0, 7);
        const b = buckets.find((x) => x.key === ym);
        if (b) {
          b.total += Number(r.total) || 0;
          b.count += 1;
        }
      });
      return buckets;
    }, [records, months]);

    const max = Math.max(...data.map((d) => d.total), 1);
    const grandTotal = data.reduce((s, d) => s + d.total, 0);
    const w = 320, h = 64, pad = 8;
    const stepX = (w - pad * 2) / Math.max(data.length - 1, 1);

    const points = data.map((d, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((d.total / max) * (h - pad * 2));
      return [x, y, d];
    });
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
    const area = `${line} L ${points[points.length - 1][0]} ${h - pad} L ${pad} ${h - pad} Z`;

    return (
      <div className="chart-card">
        <div className="chart-header">
          <Icon name="dollar" size={12} />
          <span>Monthly spend</span>
          <div className="flex-1" />
          <span className="chart-summary">{formatCurrency(grandTotal)} · {months}mo</span>
        </div>
        <div className="chart-body">
          <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#trend-fill)" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {points.map(([x, y, d]) => (
              <g key={d.key}>
                <circle cx={x} cy={y} r="2.5" fill="white" stroke="var(--accent)" strokeWidth="1.5" />
                <title>{`${d.label}: ${formatCurrency(d.total)} (${d.count} POs)`}</title>
              </g>
            ))}
          </svg>
          <div className="chart-trend-labels">
            {data.map((d) => <span key={d.key}>{d.label}</span>)}
          </div>
        </div>
      </div>
    );
  }

  function ChartsGrid({ records }) {
    return (
      <div className="charts-grid">
        <SpendTrend records={records} />
        <StatusDonut records={records} />
        <SpendBars records={records} />
      </div>
    );
  }

  window.App = window.App || {};
  window.App.StatusDonut = StatusDonut;
  window.App.SpendBars = SpendBars;
  window.App.SpendTrend = SpendTrend;
  window.App.ChartsGrid = ChartsGrid;
})();
