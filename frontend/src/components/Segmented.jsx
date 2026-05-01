/* ==========================================================================
   Segmented.jsx — iOS-style segmented control (radio group, single select).
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;

  function Segmented({ value, onChange, options, className = '' }) {
    return (
      <div className={cn('segmented', className)} role="tablist">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={value === opt.value}
            className={cn(value === opt.value && 'active')}
            onClick={() => onChange?.(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  window.App = window.App || {};
  window.App.Segmented = Segmented;
})();
