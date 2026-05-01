/* ==========================================================================
   TopBar.jsx — Page title + sub + right-side actions.
   ========================================================================== */
(() => {
  'use strict';

  function TopBar({ title, subtitle, actions }) {
    return (
      <header className="topbar">
        <div>
          <div className="topbar-title">{title}</div>
          {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="topbar-actions">{actions}</div>}
      </header>
    );
  }

  window.App = window.App || {};
  window.App.TopBar = TopBar;
})();
