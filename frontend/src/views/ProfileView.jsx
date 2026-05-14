/* ==========================================================================
   ProfileView.jsx — Hero (avatar + identity) + Your activity + Edit
   profile + Change password.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect } = React;
  const { Card, CardHeader, Field, Input, Button, Icon, Badge, EmptyState } = window.App;
  const { relativeTime } = window.App.utils;

  function ProfileView({ user, onUserUpdated, pushToast }) {
    return (
      <div className="view profile-view">
        <ProfileHero user={user} />
        <YourActivityCard user={user} />
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
    const isAdmin = user?.role === 'admin';
    const [name, setName] = useState(user?.full_name || '');
    const [email, setEmail] = useState(user?.email || '');
    // Password is only required when changing the email — gating change
    // on a session token alone would let a stolen token re-bind the
    // account to an attacker's address. Reps never see the email field
    // as editable, so they don't see this either.
    const [emailPassword, setEmailPassword] = useState('');
    const [busy, setBusy] = useState(false);

    // Re-sync local state when the parent hands us a fresh user object
    // (e.g. after a successful save elsewhere in the app).
    useEffect(() => {
      setName(user?.full_name || '');
      setEmail(user?.email || '');
    }, [user?.id, user?.full_name, user?.email]);

    const trimmedEmail = email.trim().toLowerCase();
    const nameDirty = name.trim() !== (user?.full_name || '').trim();
    const emailDirty = isAdmin && trimmedEmail !== (user?.email || '').trim().toLowerCase();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
    const canSave = !busy
      && (nameDirty || (emailDirty && emailValid && emailPassword.length > 0));

    const save = async () => {
      if (!canSave) return;
      setBusy(true);
      try {
        let updated = null;
        // Order matters: change email first (needs the OLD password to
        // confirm). If it fails, bail before touching name. Reps can't
        // reach this branch — emailDirty stays false for them.
        if (emailDirty && emailValid) {
          updated = await window.App.backend.changeMyEmail({
            new_email: trimmedEmail,
            current_password: emailPassword,
          });
        }
        if (nameDirty) {
          updated = await window.App.auth.updateProfile({ full_name: name.trim() });
        }
        if (updated) onUserUpdated?.(updated);
        setEmailPassword('');
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
          subtitle={isAdmin ? "Your display name and sign-in email." : "Your display name in the ledger and to teammates."}
          icon={<Icon name="user" size={12} />}
        />
        <div className="settings-section">
          <Field label="Full name">
            <Input value={name} onChange={setName} placeholder="Your name" />
          </Field>
          <Field
            label="Email"
            error={emailDirty && !emailValid ? 'Enter a valid email address' : null}
          >
            {/* Admins can rebind their own email; reps can't (their email
                is set by an admin from the Team page, and acts as the
                sign-in identifier the admin gave them). */}
            <Input
              type={isAdmin ? 'email' : 'text'}
              value={email}
              onChange={isAdmin ? setEmail : undefined}
              disabled={!isAdmin}
              placeholder="you@company.com"
              autoComplete="email"
              style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}
            />
            <span className="text-sm text-subtle" style={{ fontSize: 11, marginTop: 4 }}>
              {isAdmin
                ? 'Sign-in identifier. Changing it requires your current password.'
                : 'Sign-in identifier — change requires your admin to update it on the Team page.'}
            </span>
          </Field>
          {emailDirty && (
            <Field label="Current password (required to change email)">
              <Input
                type="password"
                value={emailPassword}
                onChange={setEmailPassword}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Field>
          )}
          <Field label="Role">
            <div className="flex items-center gap-2" style={{ height: 34 }}>
              <Badge tone={user?.role === 'admin' ? 'accent' : 'default'} dot>
                {user?.role === 'admin' ? 'Administrator' : 'Sales rep'}
              </Badge>
              <span className="text-sm text-subtle" style={{ fontSize: 11 }}>
                Set by your admin on the Team page.
              </span>
            </div>
          </Field>
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!canSave}
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

  // --------------------------------------------------------------------
  // Your activity — personal slice of the ledger (POs you created)
  // --------------------------------------------------------------------
  function YourActivityCard({ user }) {
    const [loading, setLoading] = useState(true);
    const [pos, setPos] = useState([]);

    useEffect(() => {
      let alive = true;
      window.App.backend.listPOs()
        .then((rows) => {
          if (!alive) return;
          // listPOs returns newest first; filter to this user's POs.
          setPos((rows || []).filter((p) => p.created_by_id === user?.id));
        })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }, [user?.id]);

    const count = pos.length;
    const total = pos.reduce((s, p) => s + (Number(p.total) || 0), 0);
    const thisMonth = (() => {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return pos.filter((p) => (p.added_at || '').startsWith(yyyymm)).length;
    })();
    const latest = pos.slice(0, 3);

    return (
      <Card noPadding style={{ marginBottom: 16 }}>
        <CardHeader
          title="Your activity"
          subtitle="POs you've added to the ledger."
          icon={<Icon name="rows" size={12} />}
        />
        {loading ? (
          <div className="settings-section" style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <span className="spinner" />
          </div>
        ) : count === 0 ? (
          <EmptyState
            icon="upload-cloud"
            title="No POs yet"
            text="Head to Upload to capture your first purchase order."
          />
        ) : (
          <>
            <div className="settings-section">
              <div className="grid-2" style={{ gap: 8 }}>
                <ActivityTile label="POs uploaded" value={count} />
                <ActivityTile label="This month" value={thisMonth} />
                <ActivityTile label="Total value" value={`$${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} wide />
              </div>
            </div>
            {latest.length > 0 && (
              <div className="settings-section" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="settings-label" style={{ marginBottom: 8 }}>Recent</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {latest.map((p) => (
                    <li
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'JetBrains Mono' }}>
                          {p.po_number}
                        </div>
                        <div className="text-sm text-muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.customer || '—'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'JetBrains Mono' }}>
                          ${Number(p.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-sm text-muted" style={{ fontSize: 11 }}>
                          {p.added_at ? relativeTime(p.added_at) : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>
    );
  }

  function ActivityTile({ label, value, wide }) {
    return (
      <div
        style={{
          gridColumn: wide ? '1 / -1' : 'auto',
          padding: '10px 12px',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
        }}
      >
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-subtle)', fontWeight: 500 }}>
          {label}
        </div>
        <div style={{ fontSize: 18, fontFamily: 'JetBrains Mono', fontWeight: 600, marginTop: 2 }}>
          {value}
        </div>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.ProfileView = ProfileView;
})();
