/* ==========================================================================
   AuthView.jsx — Combined Login + Register screen. Shown when no JWT is
   present. On successful auth, calls onAuthenticated(user) so App.jsx can
   transition into the workspace.
   ========================================================================== */
(() => {
  'use strict';
  const { useState } = React;
  const { Icon, BrandMark, Button, Field, Input } = window.App;

  function AuthView({ onAuthenticated }) {
    const [mode, setMode] = useState('login'); // 'login' | 'register'

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

          <div className="auth-tabs">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => setMode('login')}
            >Sign in</button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => setMode('register')}
            >Create account</button>
          </div>

          {mode === 'login'
            ? <LoginForm onAuthenticated={onAuthenticated} switchToRegister={() => setMode('register')} />
            : <RegisterForm onAuthenticated={onAuthenticated} switchToLogin={() => setMode('login')} />
          }
        </div>
        <div className="auth-footnote">
          Foundry · v0.4 · Internal sales workspace · Backend on <code>{((window.App?.backend?.BASE ?? 'http://127.0.0.1:8503') || window.location.host).replace(/^https?:\/\//, '')}</code>
        </div>
      </div>
    );
  }

  function LoginForm({ onAuthenticated, switchToRegister }) {
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

        <div className="auth-switch">
          New to Foundry? <button type="button" onClick={switchToRegister}>Create an account</button>
        </div>
      </form>
    );
  }

  function RegisterForm({ onAuthenticated, switchToLogin }) {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (e) => {
      e.preventDefault();
      setError(null);
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      setBusy(true);
      try {
        const { user } = await window.App.auth.register({ email, full_name: name, password });
        onAuthenticated(user);
      } catch (err) {
        setError(err.message || 'Registration failed.');
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
        <Field label="Full name">
          <Input
            value={name}
            onChange={setName}
            placeholder="Jane Doe"
            autoComplete="name"
            required
          />
        </Field>
        <Field
          label="Password"
          hint="At least 8 characters"
        >
          <Input
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </Field>

        {error && <div className="auth-error"><Icon name="alert-circle" size={13} />{error}</div>}

        <div className="auth-info">
          <Icon name="info" size={13} />
          <span>Your email must be on the invitation list (in <code>users.yaml</code>) before you can register. Ask your admin if you don't have access.</span>
        </div>

        <Button
          variant="primary"
          size="lg"
          type="submit"
          loading={busy}
          disabled={busy || !email || !name || !password}
          className="w-full"
          style={{ width: '100%' }}
        >
          {busy ? 'Creating account...' : 'Create account'}
        </Button>

        <div className="auth-switch">
          Already have an account? <button type="button" onClick={switchToLogin}>Sign in</button>
        </div>
      </form>
    );
  }

  window.App = window.App || {};
  window.App.AuthView = AuthView;
})();
