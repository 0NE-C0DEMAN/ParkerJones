/* ==========================================================================
   ProfileView.jsx — Hero (avatar + identity) + Edit profile + Change password.
   ========================================================================== */
(() => {
  'use strict';
  const { useState } = React;
  const { Card, CardHeader, Field, Input, Button, Icon, Badge } = window.App;

  function ProfileView({ user, onUserUpdated, pushToast }) {
    return (
      <div className="view profile-view">
        <ProfileHero user={user} />
        <div className="profile-grid">
          <ProfileCard user={user} onUserUpdated={onUserUpdated} pushToast={pushToast} />
          <PasswordCard pushToast={pushToast} />
        </div>
      </div>
    );
  }

  function ProfileHero({ user }) {
    const initials = (user?.full_name || user?.email || '?')
      .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();

    const roleLabel = user?.role === 'admin' ? 'Administrator' : 'Sales Rep';
    const userIdShort = (user?.id || '').slice(0, 8);

    return (
      <div className="profile-hero">
        <div className="profile-hero-avatar">{initials || 'U'}</div>
        <div className="profile-hero-info">
          <div className="profile-hero-name">{user?.full_name || user?.email || 'Signed-in user'}</div>
          <div className="profile-hero-meta">
            <Badge tone={user?.role === 'admin' ? 'accent' : 'default'} dot>{roleLabel}</Badge>
            <span className="profile-hero-divider">·</span>
            <span><Icon name="link" size={11} style={{ verticalAlign: 'text-bottom' }} />&nbsp;{user?.email || '—'}</span>
            {userIdShort && (
              <>
                <span className="profile-hero-divider">·</span>
                <span title={user?.id}><Icon name="hash" size={11} style={{ verticalAlign: 'text-bottom' }} />&nbsp;<span style={{ fontFamily: 'JetBrains Mono', fontSize: 11.5 }}>{userIdShort}</span></span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  function ProfileCard({ user, onUserUpdated, pushToast }) {
    const [name, setName] = useState(user?.full_name || '');
    const [busy, setBusy] = useState(false);
    const dirty = name.trim() !== (user?.full_name || '').trim();

    const save = async () => {
      if (!dirty) return;
      setBusy(true);
      try {
        const updated = await window.App.auth.updateProfile({ full_name: name.trim() });
        onUserUpdated?.(updated);
        pushToast?.({ type: 'success', message: 'Profile updated.' });
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Update failed.' });
      } finally {
        setBusy(false);
      }
    };

    return (
      <Card noPadding>
        <CardHeader
          title="Edit profile"
          subtitle="Your display name in the ledger and to teammates."
          icon={<Icon name="user" size={12} />}
        />
        <div className="settings-section">
          <Field label="Full name">
            <Input value={name} onChange={setName} placeholder="Your name" />
          </Field>
          <Field label="Email">
            <Input value={user?.email || ''} disabled style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }} />
            <span className="text-sm text-subtle" style={{ fontSize: 11, marginTop: 4 }}>
              Used as your sign-in identifier — change requires re-invitation.
            </span>
          </Field>
          <Field label="Role">
            <div className="flex items-center gap-2" style={{ height: 34 }}>
              <Badge tone={user?.role === 'admin' ? 'accent' : 'default'} dot>
                {user?.role === 'admin' ? 'Administrator' : 'Sales rep'}
              </Badge>
              <span className="text-sm text-subtle" style={{ fontSize: 11 }}>
                Set by the YAML invitation list.
              </span>
            </div>
          </Field>
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!dirty || busy}
              onClick={save}
              iconLeft="check"
            >
              Save changes
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  function PasswordCard({ pushToast }) {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);

    const valid = current && next.length >= 8 && next === confirm;
    const mismatch = confirm.length > 0 && next !== confirm;
    const tooShort = next.length > 0 && next.length < 8;

    const save = async () => {
      if (!valid) return;
      setBusy(true);
      try {
        await window.App.auth.changePassword({ current_password: current, new_password: next });
        pushToast?.({ type: 'success', message: 'Password changed.' });
        setCurrent(''); setNext(''); setConfirm('');
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Password change failed.' });
      } finally {
        setBusy(false);
      }
    };

    return (
      <Card noPadding>
        <CardHeader
          title="Change password"
          subtitle="At least 8 characters. We'll keep the rest of your session active."
          icon={<Icon name="link" size={12} />}
        />
        <div className="settings-section">
          <Field label="Current password">
            <Input
              type="password"
              value={current}
              onChange={setCurrent}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>
          <Field
            label="New password"
            error={tooShort ? 'Must be at least 8 characters' : null}
          >
            <Input
              type="password"
              value={next}
              onChange={setNext}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <Field
            label="Confirm new password"
            error={mismatch ? "Passwords don't match" : null}
          >
            <Input
              type="password"
              value={confirm}
              onChange={setConfirm}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <div className="flex justify-end mt-3">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!valid || busy}
              onClick={save}
              iconLeft="check"
            >
              Update password
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  window.App = window.App || {};
  window.App.ProfileView = ProfileView;
})();
