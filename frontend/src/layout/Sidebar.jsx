/* ==========================================================================
   Sidebar.jsx — Brand mark + nav items + user card footer.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect, useRef } = React;
  const { cn } = window.App.utils;
  const { Icon, BrandMark } = window.App;

  function Sidebar({ activeView, onNavigate, repositoryCount, pendingCount, user, onSignOut, collapsed, onToggleCollapsed }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
      if (!menuOpen) return;
      const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
      window.addEventListener('mousedown', close);
      return () => window.removeEventListener('mousedown', close);
    }, [menuOpen]);

    const initials = (user?.full_name || user?.email || '?')
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(s => s[0])
      .join('')
      .toUpperCase();

    return (
      <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
        <button
          type="button"
          className="sidebar-header sidebar-header-button"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar (click Foundry)' : 'Collapse sidebar (click Foundry)'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <div className="brand-mark">
            <BrandMark size={16} />
          </div>
          <div className="brand-text">
            <div className="brand-name">Foundry</div>
            <div className="brand-tag">PO Capture</div>
          </div>
          <Icon
            name="chevron-left"
            size={13}
            className="brand-collapse-glyph"
          />
        </button>

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
            label="Ledger"
            active={activeView === 'repository'}
            onClick={() => onNavigate('repository')}
            count={repositoryCount}
          />
          <NavItem
            icon="grid"
            label="Data"
            active={activeView === 'data'}
            onClick={() => onNavigate('data')}
            count={repositoryCount}
          />
          <NavItem
            icon="building"
            label="Directory"
            active={activeView === 'directory'}
            onClick={() => onNavigate('directory')}
          />
          <NavItem
            icon="dollar"
            label="Reports"
            active={activeView === 'reports'}
            onClick={() => onNavigate('reports')}
          />

          <div className="nav-section-title">Account</div>
          <NavItem
            icon="user"
            label="Profile"
            active={activeView === 'profile'}
            onClick={() => onNavigate('profile')}
          />
          {user?.role === 'admin' && (
            <NavItem
              icon="users"
              label="Team"
              active={activeView === 'team'}
              onClick={() => onNavigate('team')}
            />
          )}
          <NavItem
            icon="sliders"
            label="Settings"
            active={activeView === 'settings'}
            onClick={() => onNavigate('settings')}
          />
        </nav>

        <div className="sidebar-footer" ref={menuRef}>
          {menuOpen && (
            <div className="user-menu">
              <button type="button" className="user-menu-item" onClick={() => { setMenuOpen(false); onNavigate('profile'); }}>
                <Icon name="user" size={13} />
                <span>Profile</span>
              </button>
              <button type="button" className="user-menu-item" onClick={() => { setMenuOpen(false); onNavigate('settings'); }}>
                <Icon name="sliders" size={13} />
                <span>Settings</span>
              </button>
              <div className="user-menu-divider" />
              <button type="button" className="user-menu-item user-menu-item-danger" onClick={() => { setMenuOpen(false); onSignOut?.(); }}>
                <Icon name="log-out" size={13} />
                <span>Sign out</span>
              </button>
            </div>
          )}
          <div className="user-card" onClick={() => setMenuOpen((v) => !v)}>
            <div className="user-avatar">{initials || 'U'}</div>
            <div className="user-info">
              <div className="user-name">{user?.full_name || user?.email || 'Signed-in user'}</div>
              <div className="user-meta">
                {user?.role === 'admin' ? 'Admin' : 'Sales rep'}
                {user?.email && (user.full_name && user.full_name !== user.email) ? ` · ${user.email}` : ''}
              </div>
            </div>
            <Icon name={menuOpen ? 'chevron-down' : 'chevron-right'} size={14} className="text-subtle" />
          </div>
        </div>
      </aside>
    );
  }

  function NavItem({ icon, label, active, onClick, count, badge }) {
    // `title` gives a tooltip when the sidebar is collapsed (icon-only mode)
    // so reps still know what each icon is.
    return (
      <div className={cn('nav-item', active && 'active')} onClick={onClick} title={label}>
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
