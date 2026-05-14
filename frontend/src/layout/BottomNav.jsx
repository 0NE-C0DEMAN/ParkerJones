/* ==========================================================================
   BottomNav.jsx — Mobile-only bottom tab bar.

   Replaces the off-canvas sidebar drawer on phones (≤640px). Fixed at the
   bottom of the viewport, thumb-reachable, 5 tabs:

       Upload | Ledger | Data | Profile | More

   "More" opens a bottom sheet with the secondary destinations
   (Team for admins, Settings, Sign out). The desktop Sidebar component
   is hidden via CSS at this breakpoint so the two never collide.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect, useRef } = React;
  const { Icon } = window.App;

  // Tabs the bottom bar shows directly. Order matters — left to right.
  function buildPrimaryTabs() {
    return [
      { key: 'upload',     icon: 'upload-cloud', label: 'Upload' },
      { key: 'repository', icon: 'rows',         label: 'Ledger' },
      { key: 'data',       icon: 'grid',         label: 'Data'   },
      { key: 'profile',    icon: 'user',         label: 'Profile' },
    ];
  }

  function BottomNav({ activeView, onNavigate, user, onSignOut, repositoryCount, pendingCount }) {
    const [moreOpen, setMoreOpen] = useState(false);
    const sheetRef = useRef(null);

    // Close the More sheet on outside tap or Escape
    useEffect(() => {
      if (!moreOpen) return;
      const close = (e) => {
        if (e.type === 'keydown' && e.key !== 'Escape') return;
        if (e.type === 'mousedown' && sheetRef.current?.contains(e.target)) return;
        setMoreOpen(false);
      };
      window.addEventListener('mousedown', close);
      window.addEventListener('touchstart', close);
      window.addEventListener('keydown', close);
      return () => {
        window.removeEventListener('mousedown', close);
        window.removeEventListener('touchstart', close);
        window.removeEventListener('keydown', close);
      };
    }, [moreOpen]);

    const tabs = buildPrimaryTabs();
    // Profile tab maps to 'profile'; "More" highlights when active view is
    // one of the secondary destinations.
    const moreActive = activeView === 'team' || activeView === 'settings';

    const go = (key) => {
      setMoreOpen(false);
      onNavigate?.(key);
    };

    return (
      <>
        <nav className="bottom-nav" aria-label="Primary navigation">
          {tabs.map((t) => {
            const isActive = t.key === activeView
              || (t.key === 'upload' && activeView === 'review')
              || (t.key === 'profile' && activeView === 'profile');
            // Badges: pending review on Upload, ledger count on Ledger / Data
            let badge = null;
            if (t.key === 'upload' && pendingCount > 0) badge = pendingCount;
            else if (t.key === 'repository' && repositoryCount > 0) badge = repositoryCount;
            return (
              <button
                key={t.key}
                type="button"
                className={'bottom-nav-tab' + (isActive ? ' is-active' : '')}
                onClick={() => go(t.key)}
                aria-label={t.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="bottom-nav-icon">
                  <Icon name={t.icon} size={18} />
                  {badge != null && <span className="bottom-nav-badge">{badge > 99 ? '99+' : badge}</span>}
                </span>
                <span className="bottom-nav-label">{t.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={'bottom-nav-tab' + (moreActive || moreOpen ? ' is-active' : '')}
            onClick={() => setMoreOpen((v) => !v)}
            aria-label="More"
            aria-expanded={moreOpen}
          >
            <span className="bottom-nav-icon">
              <Icon name="more-horizontal" size={18} />
            </span>
            <span className="bottom-nav-label">More</span>
          </button>
        </nav>

        {/* Bottom sheet — slides up from above the nav bar on More tap */}
        {moreOpen && (
          <>
            <div
              className="bottom-sheet-backdrop"
              onClick={() => setMoreOpen(false)}
              aria-hidden="true"
            />
            <div className="bottom-sheet" ref={sheetRef} role="dialog" aria-label="More options">
              <div className="bottom-sheet-handle" />
              <div className="bottom-sheet-header">
                <div className="bottom-sheet-avatar">{initialsOf(user)}</div>
                <div className="bottom-sheet-identity">
                  <div className="bottom-sheet-name">{user?.full_name || user?.email || 'Signed-in user'}</div>
                  <div className="bottom-sheet-meta">
                    {user?.role === 'admin' ? 'Administrator' : 'Sales rep'}
                    {user?.email && user.full_name && user.full_name !== user.email ? ` · ${user.email}` : ''}
                  </div>
                </div>
              </div>
              <div className="bottom-sheet-list">
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    className={'bottom-sheet-item' + (activeView === 'team' ? ' is-active' : '')}
                    onClick={() => go('team')}
                  >
                    <Icon name="users" size={16} />
                    <span>Team</span>
                  </button>
                )}
                <button
                  type="button"
                  className={'bottom-sheet-item' + (activeView === 'settings' ? ' is-active' : '')}
                  onClick={() => go('settings')}
                >
                  <Icon name="sliders" size={16} />
                  <span>Settings</span>
                </button>
                <div className="bottom-sheet-divider" />
                <button
                  type="button"
                  className="bottom-sheet-item bottom-sheet-item-danger"
                  onClick={() => { setMoreOpen(false); onSignOut?.(); }}
                >
                  <Icon name="log-out" size={16} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  function initialsOf(user) {
    return (user?.full_name || user?.email || '?')
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase();
  }

  window.App = window.App || {};
  window.App.BottomNav = BottomNav;
})();
