/* ==========================================================================
   TopBar.jsx — Page title + sub + right-side actions.

   Mobile: a hamburger button slots in BEFORE the title to toggle the
   off-canvas sidebar drawer. The button is hidden on desktop via CSS
   (display: none above the 640px breakpoint).
   ========================================================================== */
(() => {
  'use strict';
  const { Icon } = window.App;

  function TopBar({ title, subtitle, actions, onMobileMenu }) {
    return (
      <header className="topbar">
        <button
          type="button"
          className="topbar-menu-btn"
          onClick={onMobileMenu}
          aria-label="Open menu"
          title="Open menu"
        >
          {/* 3-bar hamburger built from the existing 'rows' icon (3
              horizontal lines) so we don't add a new icon definition. */}
          <Icon name="rows" size={18} />
        </button>
        <div className="topbar-titles">
          <div className="topbar-title">{title}</div>
          {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
        </div>
        <div className="topbar-actions">
          {actions}
        </div>
      </header>
    );
  }

  window.App = window.App || {};
  window.App.TopBar = TopBar;
})();
