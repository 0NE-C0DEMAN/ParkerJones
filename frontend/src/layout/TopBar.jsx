/* ==========================================================================
   TopBar.jsx — Page title + sub + right-side actions.
   ========================================================================== */
(() => {
  'use strict';

  function TopBar({ title, subtitle, actions }) {
    const { SyncStatus } = window.App;
    return (
      <header className="topbar">
        <div>
          <div className="topbar-title">{title}</div>
          {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
        </div>
        <div className="topbar-actions">
          {SyncStatus && <SyncStatus />}
          {actions}
        </div>
      </header>
    );
  }

  window.App = window.App || {};
  window.App.TopBar = TopBar;
})();
