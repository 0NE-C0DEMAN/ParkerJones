/* ==========================================================================
   Sidebar.jsx — Brand mark + nav items + user card footer.
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;
  const { Icon, BrandMark } = window.App;

  function Sidebar({ activeView, onNavigate, repositoryCount, pendingCount }) {
    return (
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-mark">
            <BrandMark size={16} />
          </div>
          <div className="brand-text">
            <div className="brand-name">Foundry</div>
            <div className="brand-tag">PO Capture</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-title">Workspace</div>
          <NavItem
            icon="upload-cloud"
            label="Upload"
            active={activeView === 'upload' || activeView === 'review'}
            onClick={() => onNavigate('upload')}
            badge={pendingCount > 0 ? pendingCount : undefined}
          />
          <NavItem
            icon="rows"
            label="Repository"
            active={activeView === 'repository'}
            onClick={() => onNavigate('repository')}
            count={repositoryCount}
          />

          <div className="nav-section-title">Setup</div>
          <NavItem
            icon="sliders"
            label="Settings"
            active={activeView === 'settings'}
            onClick={() => onNavigate('settings')}
          />
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">PJ</div>
            <div className="user-info">
              <div className="user-name">Parker Jones</div>
              <div className="user-meta">Inside Sales</div>
            </div>
            <Icon name="chevron-right" size={14} className="text-subtle" />
          </div>
        </div>
      </aside>
    );
  }

  function NavItem({ icon, label, active, onClick, count, badge }) {
    return (
      <div className={cn('nav-item', active && 'active')} onClick={onClick}>
        <Icon name={icon} size={16} />
        <span>{label}</span>
        {badge !== undefined && (
          <span className="nav-count" style={{ background: 'var(--accent)', color: 'white' }}>{badge}</span>
        )}
        {count !== undefined && badge === undefined && (
          <span className="nav-count">{count}</span>
        )}
      </div>
    );
  }

  window.App = window.App || {};
  window.App.Sidebar = Sidebar;
})();
