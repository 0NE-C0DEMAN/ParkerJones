/* ==========================================================================
   EmptyState.jsx — Empty list / zero-state container.
   ========================================================================== */
(() => {
  'use strict';
  const { Icon } = window.App;

  function EmptyState({ icon = 'inbox', title, text, actions }) {
    return (
      <div className="empty">
        <div className="empty-icon"><Icon name={icon} size={22} strokeWidth={1.5} /></div>
        {title && <div className="empty-title">{title}</div>}
        {text && <div className="empty-text">{text}</div>}
        {actions && <div className="empty-actions">{actions}</div>}
      </div>
    );
  }

  window.App = window.App || {};
  window.App.EmptyState = EmptyState;
})();
