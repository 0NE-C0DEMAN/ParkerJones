/* ==========================================================================
   Badge.jsx — Pill badge. Tones: default | success | warning | danger | info | accent.
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;

  function Badge({ tone = 'default', dot = false, children, className = '', ...rest }) {
    return (
      <span className={cn('badge', `badge-${tone}`, className)} {...rest}>
        {dot && <span className="dot" />}
        {children}
      </span>
    );
  }

  window.App = window.App || {};
  window.App.Badge = Badge;
})();
