/* ==========================================================================
   ErrorBoundary.jsx — Catches render errors so a single broken view
   doesn't blank the entire app. Shows a friendly fallback with the error
   message and a reload button.
   ========================================================================== */
(() => {
  'use strict';

  class ErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
      return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
      this.setState({ errorInfo });
      console.error('Foundry render error:', error, errorInfo);
    }

    reset = () => {
      this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render() {
      if (!this.state.hasError) return this.props.children;

      const { Icon, Button } = window.App || {};
      const msg = this.state.error?.message || String(this.state.error || 'Unknown error');
      const stack = this.state.errorInfo?.componentStack || '';

      return (
        <div style={{
          padding: 24,
          margin: 16,
          background: 'var(--danger-light)',
          border: '1px solid var(--danger)',
          borderRadius: 12,
          fontFamily: 'Inter, sans-serif',
          fontSize: 13,
          color: 'var(--text)',
          maxWidth: 720,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: 'var(--danger)' }}>
            {Icon ? <Icon name="alert-triangle" size={18} /> : null}
            <strong style={{ fontSize: 15 }}>Something broke while rendering this view.</strong>
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>Error:</strong> <code style={{ background: 'white', padding: '2px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono', fontSize: 12 }}>{msg}</code>
          </div>
          {stack && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}>Component stack</summary>
              <pre style={{
                background: 'white',
                padding: 12,
                borderRadius: 6,
                fontSize: 11,
                fontFamily: 'JetBrains Mono, monospace',
                whiteSpace: 'pre-wrap',
                margin: 0,
                maxHeight: 300,
                overflow: 'auto',
              }}>{stack.trim()}</pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {Button ? (
              <Button variant="primary" iconLeft="rotate-cw" onClick={this.reset}>
                Try again
              </Button>
            ) : (
              <button onClick={this.reset} style={{ padding: '8px 14px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Try again</button>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '8px 14px', background: 'white', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
  }

  window.App = window.App || {};
  window.App.ErrorBoundary = ErrorBoundary;
})();
