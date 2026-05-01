/* ==========================================================================
   Stat.jsx — KPI stat tile (label + big value + meta line).
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;
  const { Icon } = window.App;

  function Stat({ label, value, meta, trend, icon, className = '' }) {
    return (
      <div className={cn('stat', className)}>
        <div className="flex items-center justify-between">
          <div className="stat-label">{label}</div>
          {icon && <div style={{ color: 'var(--text-subtle)' }}><Icon name={icon} size={14} /></div>}
        </div>
        <div className="stat-value">{value}</div>
        {meta && <div className={cn('stat-meta', trend && `stat-meta-${trend}`)}>{meta}</div>}
      </div>
    );
  }

  function StatGrid({ children }) {
    return <div className="stat-grid">{children}</div>;
  }

  window.App = window.App || {};
  window.App.Stat = Stat;
  window.App.StatGrid = StatGrid;
})();
