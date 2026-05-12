/* ==========================================================================
   TeamView.jsx — Admin-only page listing registered users + pending
   invitations. Lets admins deactivate accounts (revoke access without
   removing the data).
   ========================================================================== */
(() => {
  'use strict';
  const { useEffect, useState } = React;
  const { formatDate, relativeTime, truncate } = window.App.utils;
  const { Card, CardHeader, Icon, Badge, Button, EmptyState } = window.App;

  function TeamView({ pushToast, currentUser }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);

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
        <div className="settings-grid">
          <Card noPadding>
            <CardHeader
              title={`Team members (${data.users.length})`}
              subtitle={`${activeCount} active · ${data.users.length - activeCount} deactivated`}
              icon={<Icon name="users" size={12} />}
              actions={<Button variant="ghost" size="sm" iconOnly="rotate-cw" onClick={refresh} title="Refresh" />}
            />
            <div className="settings-section" style={{ padding: 0 }}>
              {data.users.length === 0 ? (
                <EmptyState icon="users" title="No accounts yet" text="Invite users via users.yaml, then they self-register." />
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          <Card noPadding>
            <CardHeader
              title={`Pending invitations (${data.pending_invitations.length})`}
              subtitle="Listed in users.yaml but haven't registered yet."
              icon={<Icon name="inbox" size={12} />}
            />
            <div className="settings-section">
              {data.pending_invitations.length === 0 ? (
                <EmptyState icon="check-circle" title="All invited users have registered" text="Add more emails to users.yaml to grow your team." />
              ) : (
                <ul className="pending-invite-list">
                  {data.pending_invitations.map((i) => (
                    <li key={i.email}>
                      <span className="team-email" style={{ fontWeight: 500, color: 'var(--text)' }}>{i.email}</span>
                      <Badge tone={i.role === 'admin' ? 'accent' : 'default'}>{i.role}</Badge>
                      {i.name && <span className="text-sm text-muted">{i.name}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="settings-help" style={{ marginTop: 12, padding: 10, background: 'var(--bg-subtle)', borderRadius: 6 }}>
                <Icon name="info" size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                To invite new teammates, edit <code>users.yaml</code> and add an entry under <code>invited:</code>. The change takes effect immediately — no restart needed.
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.TeamView = TeamView;
})();
