/* ==========================================================================
   TeamView.jsx — Admin-only page. Lists registered users; lets admins
   create new accounts, reset passwords, and deactivate/reactivate.

   Accounts are created directly here (no invitation YAML, no
   self-registration). When the server generates a password it's shown
   exactly once at the top of the card — admin copies and shares it
   out-of-band; the user changes it from Profile after first login.
   ========================================================================== */
(() => {
  'use strict';
  const { useEffect, useState } = React;
  const { relativeTime } = window.App.utils;
  const { Card, CardHeader, Icon, Badge, Button, EmptyState, Field, Input } = window.App;

  function TeamView({ pushToast, currentUser }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    // After create/reset, hold the one-time password to display until dismissed
    const [tempCred, setTempCred] = useState(null);  // { email, password, action }

    const refresh = async () => {
      setLoading(true);
      try {
        const r = await window.App.backend.listTeam();
        setData(r);
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Failed to load team.' });
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => { refresh(); }, []);

    const toggleActive = async (u, active) => {
      setBusyId(u.id);
      try {
        await window.App.backend.setUserActive(u.id, active);
        pushToast?.({ type: 'success', message: `${u.email} ${active ? 'reactivated' : 'deactivated'}.` });
        await refresh();
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Update failed.' });
      } finally {
        setBusyId(null);
      }
    };

    const resetPassword = async (u) => {
      if (!window.confirm(`Reset ${u.email}'s password? Their current password will stop working.`)) return;
      setBusyId(u.id);
      try {
        const res = await window.App.backend.adminResetPassword(u.id);
        setTempCred({ email: u.email, password: res.temporary_password, action: 'reset' });
        pushToast?.({ type: 'success', message: `Password reset for ${u.email}.` });
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Reset failed.' });
      } finally {
        setBusyId(null);
      }
    };

    const handleCreated = (email, password) => {
      setTempCred({ email, password, action: 'create' });
      setShowAddForm(false);
      refresh();
    };

    if (loading && !data) {
      return (
        <div className="view" style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <span className="spinner" style={{ color: 'var(--accent)' }} />
        </div>
      );
    }

    if (!data) return null;

    const activeCount = (data.users || []).filter((u) => u.is_active).length;

    return (
      <div className="view">
        {/* Team is a single full-width card — don't wrap it in .settings-grid
            (a 2-col layout), which would leave the right column empty and
            squash the user table into half the viewport. */}
        <div className="team-wrap">
          <Card noPadding>
            <CardHeader
              title={`Team members (${data.users.length})`}
              subtitle={`${activeCount} active · ${data.users.length - activeCount} deactivated`}
              icon={<Icon name="users" size={12} />}
              actions={
                <>
                  {!showAddForm && (
                    <Button variant="primary" size="sm" iconLeft="plus" onClick={() => setShowAddForm(true)}>
                      Add user
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" iconOnly="rotate-cw" onClick={refresh} title="Refresh" />
                </>
              }
            />

            {tempCred && (
              <TempPasswordBanner
                email={tempCred.email}
                password={tempCred.password}
                action={tempCred.action}
                onDismiss={() => setTempCred(null)}
              />
            )}

            {showAddForm && (
              <AddUserForm
                onCancel={() => setShowAddForm(false)}
                onCreated={handleCreated}
                pushToast={pushToast}
              />
            )}

            <div className="settings-section" style={{ padding: 0 }}>
              {data.users.length === 0 ? (
                <EmptyState
                  icon="users"
                  title="No accounts yet"
                  text="Click 'Add user' above to create the first account."
                />
              ) : (
                <table className="team-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Last login</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => {
                      const initials = (u.full_name || u.email)
                        .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
                      const isMe = u.id === currentUser?.id;
                      return (
                        <tr key={u.id}>
                          <td>
                            <div className="team-user-cell">
                              <div className="team-avatar">{initials}</div>
                              <div>
                                <div className="team-name">
                                  {u.full_name || u.email.split('@')[0]}
                                  {isMe && <Badge tone="accent" style={{ marginLeft: 6, fontSize: 10 }}>You</Badge>}
                                  {!u.is_active && <Badge tone="danger" style={{ marginLeft: 6, fontSize: 10 }}>Deactivated</Badge>}
                                </div>
                                <div className="team-email">{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Badge tone={u.role === 'admin' ? 'accent' : 'default'} dot>
                              {u.role === 'admin' ? 'Admin' : 'Rep'}
                            </Badge>
                          </td>
                          <td className="text-sm text-muted">
                            {u.last_login_at ? relativeTime(u.last_login_at) : 'Never'}
                          </td>
                          <td className="col-actions">
                            <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                              {!isMe && u.is_active && (
                                <Button variant="ghost" size="sm" loading={busyId === u.id} onClick={() => resetPassword(u)}>
                                  Reset password
                                </Button>
                              )}
                              {!isMe && (
                                u.is_active ? (
                                  <Button variant="ghost" size="sm" loading={busyId === u.id} onClick={() => toggleActive(u, false)}>
                                    Deactivate
                                  </Button>
                                ) : (
                                  <Button variant="secondary" size="sm" loading={busyId === u.id} onClick={() => toggleActive(u, true)}>
                                    Reactivate
                                  </Button>
                                )
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Add-user form (inline)
  // ------------------------------------------------------------------
  function AddUserForm({ onCancel, onCreated, pushToast }) {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [role, setRole] = useState('rep');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const res = await window.App.backend.adminCreateUser({
          email: email.trim().toLowerCase(),
          full_name: name.trim(),
          role,
        });
        onCreated(res.user.email, res.temporary_password);
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Failed to create user.' });
      } finally {
        setBusy(false);
      }
    };

    return (
      <form
        onSubmit={submit}
        className="settings-section"
        style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="jane@company.com"
              required
              autoFocus
            />
          </Field>
          <Field label="Full name">
            <Input
              value={name}
              onChange={setName}
              placeholder="Jane Doe"
              required
            />
          </Field>
        </div>
        <Field label="Role" style={{ marginTop: 12 }}>
          <div className="flex gap-2">
            <RoleChip value="rep" current={role} onSelect={setRole} label="Rep" desc="Uploads + edits POs" />
            <RoleChip value="admin" current={role} onSelect={setRole} label="Admin" desc="Plus team + clear-all" />
          </div>
        </Field>
        <div className="flex gap-2" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            iconLeft="check"
            loading={busy}
            disabled={busy || !email || !name}
          >
            Create user
          </Button>
        </div>
        <div className="settings-help" style={{ marginTop: 10 }}>
          <Icon name="info" size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          A one-time password will be generated and shown once — copy it then send to the user privately.
        </div>
      </form>
    );
  }

  function RoleChip({ value, current, onSelect, label, desc }) {
    const selected = value === current;
    return (
      <button
        type="button"
        onClick={() => onSelect(value)}
        style={{
          flex: 1,
          padding: '10px 12px',
          borderRadius: 8,
          textAlign: 'left',
          cursor: 'pointer',
          border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
          background: selected ? 'var(--accent-soft)' : 'var(--bg-elevated)',
          transition: 'all 150ms',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--accent)' : 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
      </button>
    );
  }

  // ------------------------------------------------------------------
  // Temporary password banner — shown exactly once after create / reset
  // ------------------------------------------------------------------
  function TempPasswordBanner({ email, password, action, onDismiss }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(password);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* clipboard blocked — user can select+copy manually */ }
    };

    return (
      <div
        style={{
          margin: '12px 16px',
          padding: 14,
          background: 'rgba(4, 120, 87, 0.08)',
          border: '1px solid rgba(4, 120, 87, 0.25)',
          borderRadius: 8,
        }}
      >
        <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
          <Icon name="check-circle" size={14} style={{ color: 'var(--success)' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>
            {action === 'create' ? 'Account created' : 'Password reset'} — share the password below with {email}
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
          <code
            style={{
              flex: 1,
              fontFamily: 'JetBrains Mono',
              fontSize: 13,
              padding: '8px 10px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              userSelect: 'all',
            }}
          >
            {password}
          </code>
          <Button variant="secondary" size="sm" iconLeft={copied ? 'check' : 'copy'} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
        </div>
        <div className="settings-help" style={{ marginTop: 8 }}>
          This won't be shown again. The user should change it via Profile after their first login.
        </div>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.TeamView = TeamView;
})();
