/* ==========================================================================
   Toast.jsx — Stacked toast notifications. Driven by useToasts() hook.
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;
  const { Icon } = window.App;

  const TYPE_ICONS = {
    success: 'check-circle',
    error: 'alert-circle',
    info: 'info',
  };

  function ToastContainer({ toasts, onDismiss }) {
    if (!toasts || toasts.length === 0) return null;
    return (
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </div>
    );
  }

  function Toast({ toast, onDismiss }) {
    const iconName = TYPE_ICONS[toast.type] || 'info';
    return (
      <div
        className={cn('toast', `toast-${toast.type}`)}
        role="status"
        onClick={onDismiss}
      >
        <Icon className="toast-icon" name={iconName} size={16} />
        <span>{toast.message}</span>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.ToastContainer = ToastContainer;
  window.App.Toast = Toast;
})();
