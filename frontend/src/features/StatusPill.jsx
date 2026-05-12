/* ==========================================================================
   StatusPill.jsx — PO lifecycle status display + inline change dropdown.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect, useRef } = React;
  const { cn } = window.App.utils;
  const { Icon } = window.App;

  const STATUSES = [
    { id: 'received',     label: 'Received',     tone: 'default' },
    { id: 'acknowledged', label: 'Acknowledged', tone: 'info'    },
    { id: 'in_progress',  label: 'In progress',  tone: 'warning' },
    { id: 'shipped',      label: 'Shipped',      tone: 'accent'  },
    { id: 'invoiced',     label: 'Invoiced',     tone: 'success' },
    { id: 'closed',       label: 'Closed',       tone: 'default' },
  ];

  function statusInfo(id) {
    return STATUSES.find((s) => s.id === id) || STATUSES[0];
  }

  /** Read-only pill (use in tables when not interactive). */
  function StatusPill({ status, size = 'md' }) {
    const info = statusInfo(status);
    return (
      <span className={cn('badge', `badge-${info.tone}`, size === 'sm' && 'badge-sm')} style={{ minWidth: 80, justifyContent: 'center' }}>
        <span className="dot" />
        {info.label}
      </span>
    );
  }

  /** Interactive pill — click to open dropdown of statuses. */
  function StatusChooser({ status, onChange, size = 'md' }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const info = statusInfo(status);

    useEffect(() => {
      if (!open) return;
      const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
      window.addEventListener('mousedown', close);
      return () => window.removeEventListener('mousedown', close);
    }, [open]);

    const choose = (id) => {
      setOpen(false);
      if (id !== status) onChange?.(id);
    };

    return (
      <div className="status-chooser" ref={ref}>
        <button
          type="button"
          className={cn('badge', `badge-${info.tone}`, 'status-chooser-trigger')}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          title="Click to change status"
          style={{ minWidth: 100 }}
        >
          <span className="dot" />
          {info.label}
          <Icon name="chevron-down" size={11} style={{ marginLeft: 2 }} />
        </button>
        {open && (
          <div className="status-menu" onClick={(e) => e.stopPropagation()}>
            {STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={cn('status-menu-item', s.id === status && 'active')}
                onClick={() => choose(s.id)}
              >
                <span className={cn('badge', `badge-${s.tone}`)} style={{ minWidth: 90, justifyContent: 'flex-start' }}>
                  <span className="dot" />
                  {s.label}
                </span>
                {s.id === status && <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  window.App = window.App || {};
  window.App.StatusPill = StatusPill;
  window.App.StatusChooser = StatusChooser;
  window.App.PO_STATUSES = STATUSES;
  window.App.statusInfo = statusInfo;
})();
