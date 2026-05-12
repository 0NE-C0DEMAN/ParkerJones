/* ==========================================================================
   AuthView.jsx — Login screen. Shown when no JWT is present. On successful
   auth, calls onAuthenticated(user) so App.jsx can transition into the
   workspace.

   Self-registration is intentionally not exposed — admins create accounts
   from the Team page (POST /api/team/users). Reps just sign in.
   ========================================================================== */
(() => {
  'use strict';
  const { useState } = React;
  const { Icon, BrandMark, Button, Field, Input } = window.App;

  function AuthView({ onAuthenticated }) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark" style={{ width: 36, height: 36, borderRadius: 10 }}>
              <BrandMark size={20} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.015em' }}>Foundry</div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-subtle)', fontWeight: 500 }}>PO Capture</div>
            </div>
          </div>

          <LoginForm onAuthenticated={onAuthenticated} />
        </div>
        <div className="auth-footnote">
          Foundry · v0.4 · Internal sales workspace
        </div>
      </div>
    );
  }

  function LoginForm({ onAuthenticated }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (e) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        const { user } = await window.App.auth.login({ email, password });
        onAuthenticated(user);
      } catch (err) {
        setError(err.message || 'Login failed.');
      } finally {
        setBusy(false);
      }
    };

    return (
      <form onSubmit={submit} className="auth-form">
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@company.com"
            autoComplete="email"
            required
            autoFocus
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </Field>

        {error && <div className="auth-error"><Icon name="alert-circle" size={13} />{error}</div>}

        <Button
          variant="primary"
          size="lg"
          type="submit"
          loading={busy}
          disabled={busy || !email || !password}
          className="w-full"
          style={{ width: '100%' }}
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </Button>

        <div className="auth-info" style={{ marginTop: 14 }}>
          <Icon name="info" size={13} />
          <span>Accounts are created by your admin. If you don't have one yet, ask them to add you on the Team page.</span>
        </div>
      </form>
    );
  }

  window.App = window.App || {};
  window.App.AuthView = AuthView;
})();
