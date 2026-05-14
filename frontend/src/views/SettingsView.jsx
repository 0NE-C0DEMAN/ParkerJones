/* ==========================================================================
   SettingsView.jsx — API key + model + workflow + ledger management.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect } = React;
  const { Card, CardHeader, Segmented, Button, Icon, Badge, Field, Input } = window.App;
  const { useLocalStorage } = window.App.hooks;

  function SettingsView({ onClearLedger, recordCount, pushToast, backendOnline = true, user }) {
    const isAdmin = user?.role === 'admin';
    const [keyInput, setKeyInput] = useState(window.App.config.getApiKey());
    const [keyDirty, setKeyDirty] = useState(false);
    const [keyVisible, setKeyVisible] = useState(false);
    const [model, setModelState] = useState(window.App.config.getModel());
    const [autoConfirm, setAutoConfirm] = useLocalStorage('foundry.autoConfirm', false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null); // null | 'ok' | 'fail'

    // Save key on blur if changed
    const saveKey = () => {
      if (!keyDirty) return;
      window.App.config.setApiKey(keyInput);
      setKeyDirty(false);
      setTestResult(null);
      pushToast?.({ type: 'success', message: 'API key updated.' });
    };

    const updateModel = (m) => {
      setModelState(m);
      window.App.config.setModel(m);
      setTestResult(null);
    };

    const testConnection = async () => {
      setTesting(true);
      setTestResult(null);
      try {
        const provider = window.App.config.providerForModel(model);
        const client = provider === 'google' ? window.App.gemini : window.App.openrouter;
        await client.pingLLM({ apiKey: keyInput, model });
        setTestResult('ok');
        pushToast?.({ type: 'success', message: `Connection OK · ${model.split('/').pop()}` });
      } catch (err) {
        setTestResult('fail');
        pushToast?.({ type: 'error', message: `Connection failed: ${err.message}` });
      } finally {
        setTesting(false);
      }
    };

    const isUsingDefault = window.App.config.isUsingDefaultKey();
    const maskedKey = keyInput ? keyInput.slice(0, 12) + '•'.repeat(Math.max(0, keyInput.length - 16)) + keyInput.slice(-4) : '';

    return (
      <div className="view">
       <div className="settings-grid">
        {/* Everyone gets the Workflow toggle (browser-local). */}
        <Card noPadding className="mb-0">
          <CardHeader
            title="Workflow"
            subtitle="How extracted POs become ledger rows."
            icon={<Icon name="sliders" size={12} />}
          />
          <div className="settings-section">
            <div className="settings-row">
              <div>
                <div className="settings-label">Review before adding</div>
                <div className="settings-help">Always show the editable form so you can correct fields before they go to the ledger.</div>
              </div>
              <div className="settings-control">
                <Toggle checked={!autoConfirm} onChange={(v) => setAutoConfirm(!v)} />
              </div>
            </div>
          </div>
        </Card>

        {/* Non-admins stop here. Below: admin-only configuration. */}
        {isAdmin && (
          <Card noPadding className="mb-0">
            <CardHeader
              title="Ledger data"
              subtitle="Shared PO history across the team."
              icon={<Icon name="rows" size={12} />}
            />
            <div className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-label">Stored in the cloud database</div>
                  <div className="settings-help">
                    {recordCount} PO{recordCount === 1 ? '' : 's'} visible to your team. Persists across browsers and devices.
                  </div>
                </div>
                <div className="settings-control">
                  {confirmClear ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
                      <Button size="sm" variant="danger" iconLeft="trash" onClick={() => { onClearLedger(); setConfirmClear(false); }}>
                        Clear all data
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="danger" iconLeft="trash" onClick={() => setConfirmClear(true)} disabled={recordCount === 0}>
                      Clear ledger
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {isAdmin && (
          <Card noPadding className="mb-0">
            <CardHeader
              title="LLM provider (admin)"
              subtitle="Your personal override of the team's shared key. Stored locally in this browser."
              icon={<Icon name="sparkles" size={12} />}
              actions={
                <Badge tone={testResult === 'ok' ? 'success' : testResult === 'fail' ? 'danger' : isUsingDefault ? 'warning' : 'success'} dot>
                  {testResult === 'ok' ? 'Verified' : testResult === 'fail' ? 'Failed' : isUsingDefault ? 'Default key' : 'Custom key'}
                </Badge>
              }
            />
            <div className="settings-section">
              <Field label="API key">
                <div className="flex gap-2 items-center">
                  <div className="input-with-icon" style={{ flex: 1 }}>
                    <span className="input-icon"><Icon name="link" size={13} /></span>
                    <Input
                      type={keyVisible ? 'text' : 'password'}
                      value={keyInput}
                      onChange={(v) => { setKeyInput(v); setKeyDirty(true); }}
                      onBlur={saveKey}
                      placeholder="AIza...  or  sk-or-v1-..."
                      style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly={keyVisible ? 'x' : 'eye'}
                    onClick={() => setKeyVisible(!keyVisible)}
                    title={keyVisible ? 'Hide' : 'Show'}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={testing ? undefined : 'check'}
                    loading={testing}
                    onClick={testConnection}
                    disabled={!keyInput || testing}
                  >
                    {testing ? 'Testing...' : 'Test'}
                  </Button>
                </div>
                <span className="text-sm text-muted mt-2">
                  Empty falls back to the team's shared key (see Foundry Admin below). Useful for testing a key before rolling it out to the team. Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>Google AI Studio</a> (Gemini) or <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>openrouter.ai/keys</a>.
                </span>
              </Field>
            </div>

            <div className="settings-section" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Field label="Model">
                <div className="grid-2" style={{ gap: 8 }}>
                  {window.App.config.AVAILABLE_MODELS.map((m) => (
                    <ModelOption
                      key={m.id}
                      model={m}
                      selected={model === m.id}
                      onSelect={() => updateModel(m.id)}
                    />
                  ))}
                </div>
                <span className="text-sm text-muted mt-2" style={{ fontSize: 11.5 }}>
                  Default is Gemini 2.5 Flash Lite — fastest and free. Switch up if you need more accuracy on complex POs. Per-tier rate limits live in your{' '}
                  <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>AI Studio dashboard</a>.
                </span>
              </Field>
            </div>
          </Card>
        )}

        <ApiKeyCard pushToast={pushToast} />

        {isAdmin && <AdminCard pushToast={pushToast} backendOnline={backendOnline} />}

       </div>
        <div className="text-sm text-muted text-center" style={{ marginTop: 12, fontSize: 11 }}>
          Foundry · v0.4 ·{' '}
          <span style={{ color: backendOnline ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
            {backendOnline ? 'Connected' : 'Offline'}
          </span>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------
  // Admin-only card: system status + LLM key rotation
  // --------------------------------------------------------------------
  // --------------------------------------------------------------------
  // API keys — personal access tokens for programmatic API use.
  // --------------------------------------------------------------------
  function ApiKeyCard({ pushToast }) {
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [fresh, setFresh] = useState(null);   // shown ONCE after creation
    const [busyId, setBusyId] = useState(null);

    const refresh = async () => {
      setLoading(true);
      try {
        const res = await window.App.backend.listMyApiKeys();
        setKeys(res.keys || []);
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Failed to load API keys.' });
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => { refresh(); }, []);

    const create = async () => {
      const name = newName.trim();
      if (!name) return;
      setCreating(true);
      try {
        const res = await window.App.backend.createMyApiKey({ name });
        setFresh(res);
        setNewName('');
        await refresh();
        pushToast?.({ type: 'success', message: `API key "${name}" created. Save it now — it won't be shown again.` });
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Failed to create key.' });
      } finally {
        setCreating(false);
      }
    };

    const revoke = async (k) => {
      if (!window.confirm(`Revoke "${k.name}"? Any scripts using it will stop working.`)) return;
      setBusyId(k.id);
      try {
        await window.App.backend.revokeMyApiKey(k.id);
        await refresh();
        pushToast?.({ type: 'success', message: `Key "${k.name}" revoked.` });
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Revoke failed.' });
      } finally {
        setBusyId(null);
      }
    };

    const copy = (text) => {
      navigator.clipboard?.writeText(text);
      pushToast?.({ type: 'success', message: 'Copied to clipboard.' });
    };

    return (
      <Card noPadding className="mb-0">
        <CardHeader
          title="API access"
          subtitle="Personal tokens for scripts and integrations. Auth header: Authorization: Bearer <key>."
          icon={<Icon name="key" size={12} />}
          actions={
            <a
              href="/api/docs"
              target="_blank"
              rel="noopener"
              className="text-sm"
              style={{ color: 'var(--accent)', fontSize: 11.5 }}
            >
              <Icon name="file-text" size={11} />&nbsp;API docs
            </a>
          }
        />

        <div className="settings-section">
          <Field label="Create new key">
            <div className="flex gap-2 items-center">
              <div className="input-with-icon" style={{ flex: 1 }}>
                <span className="input-icon"><Icon name="hash" size={13} /></span>
                <Input
                  value={newName}
                  onChange={setNewName}
                  placeholder="e.g. Zapier integration"
                />
              </div>
              <Button variant="primary" size="sm" iconLeft="plus" onClick={create} loading={creating} disabled={!newName.trim()}>
                Generate
              </Button>
            </div>
          </Field>
          {fresh && (
            <div style={{
              marginTop: 12,
              padding: 12,
              background: 'rgba(79, 70, 229, 0.06)',
              border: '1px solid var(--accent)',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)', marginBottom: 6 }}>
                ⚠ Save this — it won't be shown again
              </div>
              <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
                <code style={{
                  flex: 1, minWidth: 0,
                  fontFamily: 'JetBrains Mono', fontSize: 12,
                  padding: '8px 10px',
                  background: 'white',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  wordBreak: 'break-all',
                }}>{fresh.key}</code>
                <Button variant="secondary" size="sm" iconLeft="check" onClick={() => copy(fresh.key)}>Copy</Button>
                <Button variant="ghost" size="sm" iconOnly="x" onClick={() => setFresh(null)} title="Dismiss" />
              </div>
            </div>
          )}
        </div>

        <div className="settings-section" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="settings-label" style={{ marginBottom: 8 }}>
            Active keys ({keys.length})
          </div>
          {loading ? (
            <div style={{ padding: 16, textAlign: 'center' }}><span className="spinner" /></div>
          ) : keys.length === 0 ? (
            <div className="text-sm text-muted" style={{ fontSize: 12 }}>
              No keys yet. Create one above to call the Foundry API from scripts.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {keys.map((k) => (
                <li key={k.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  background: 'var(--bg-subtle)',
                  borderRadius: 6,
                  fontSize: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{k.name}</div>
                    <div className="text-sm text-muted" style={{ fontSize: 11 }}>
                      <code style={{ fontFamily: 'JetBrains Mono' }}>fdr_{k.prefix}…</code>
                      &nbsp;·&nbsp;Created {fmtRel(k.created_at)}
                      {k.last_used_at && <>&nbsp;·&nbsp;Last used {fmtRel(k.last_used_at)}</>}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revoke(k)}
                    loading={busyId === k.id}
                    style={{ color: 'var(--danger)' }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    );
  }

  function fmtRel(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function AdminCard({ pushToast, backendOnline }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [newKey, setNewKey] = useState('');
    const [busy, setBusy] = useState(false);

    const refresh = async () => {
      setLoading(true);
      try {
        setData(await window.App.backend.getAdminConfig());
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Admin config load failed.' });
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => { refresh(); }, []);

    const save = async () => {
      const v = newKey.trim();
      if (!v) return;
      setBusy(true);
      try {
        const fresh = await window.App.backend.setAdminConfig({ llm_api_key: v });
        setData(fresh);
        setNewKey('');
        pushToast?.({
          type: 'success',
          message: 'LLM key saved. Users get the new key on their next page reload.',
        });
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Save failed.' });
      } finally {
        setBusy(false);
      }
    };

    const clearKey = async () => {
      if (!window.confirm('Clear the DB-stored LLM key and fall back to the Space secret?')) return;
      setBusy(true);
      try {
        const fresh = await window.App.backend.clearAdminLlmKey();
        setData(fresh);
        pushToast?.({ type: 'success', message: 'Reverted to Space-secret fallback.' });
      } catch (err) {
        pushToast?.({ type: 'error', message: err.message || 'Clear failed.' });
      } finally {
        setBusy(false);
      }
    };

    const stats = data?.stats || {};
    const source = data?.llm_api_key_source || 'none';
    const sourceTone = source === 'db' ? 'accent' : source === 'env' ? 'success' : 'warning';
    const sourceLabel =
      source === 'db' ? 'In-app (DB)' :
      source === 'env' ? 'Space secret (env)' :
      'Not configured';

    return (
      <Card noPadding className="mb-0">
        <CardHeader
          title="Foundry Admin"
          subtitle="System status + app-wide settings (admins only)."
          icon={<Icon name="shield" size={12} />}
          actions={<Button variant="ghost" size="sm" iconOnly="rotate-cw" onClick={refresh} title="Refresh" />}
        />

        {loading && !data ? (
          <div className="settings-section" style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <span className="spinner" />
          </div>
        ) : (
          <>
            {/* System status */}
            <div className="settings-section">
              <div className="settings-label" style={{ marginBottom: 8 }}>System status</div>
              <div className="grid-2" style={{ gap: 8 }}>
                <StatTile label="Backend" value={backendOnline ? 'Connected' : 'Offline'}
                          tone={backendOnline ? 'success' : 'danger'} />
                <StatTile label="Host" value={window.location.host} mono />
                <StatTile label="POs" value={stats.po_count ?? '—'} />
                <StatTile label="Line items" value={stats.line_count ?? '—'} />
                <StatTile label="Active users" value={stats.active_user_count ?? '—'} />
                <StatTile label="Suppliers" value={stats.supplier_count ?? '—'} />
              </div>
            </div>

            {/* LLM key rotation */}
            <div className="settings-section" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <div>
                  <div className="settings-label">Shared LLM key</div>
                  <div className="settings-help">
                    Used as the default for everyone in the workspace. Per-user overrides above take precedence in the browser.
                  </div>
                </div>
                <Badge tone={sourceTone} dot>{sourceLabel}</Badge>
              </div>

              <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
                <code style={{
                  flex: 1,
                  fontFamily: 'JetBrains Mono', fontSize: 12,
                  padding: '8px 10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: data?.llm_api_key_masked ? 'var(--text)' : 'var(--text-muted)',
                }}>
                  {data?.llm_api_key_masked || 'No key configured'}
                </code>
                {source === 'db' && (
                  <Button variant="ghost" size="sm" onClick={clearKey} disabled={busy} title="Drop DB override and use the Space secret instead">
                    Use env var
                  </Button>
                )}
              </div>

              <Field label={source === 'db' ? 'Replace key' : 'Set a new key (overrides the Space secret)'} style={{ marginTop: 12 }}>
                <div className="flex gap-2 items-center">
                  <div className="input-with-icon" style={{ flex: 1 }}>
                    <span className="input-icon"><Icon name="key" size={13} /></span>
                    <Input
                      type="password"
                      value={newKey}
                      onChange={setNewKey}
                      placeholder="AIza…  or  sk-or-v1-…"
                      style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}
                    />
                  </div>
                  <Button variant="primary" size="sm" iconLeft="check" onClick={save} loading={busy} disabled={!newKey.trim() || busy}>
                    Save
                  </Button>
                </div>
                <span className="text-sm text-muted mt-2" style={{ fontSize: 11.5 }}>
                  Stored in the cloud database. Takes effect for each user on their next page load.
                </span>
              </Field>
            </div>
          </>
        )}
      </Card>
    );
  }

  function StatTile({ label, value, tone, mono }) {
    return (
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
        }}
      >
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-subtle)', fontWeight: 500 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: mono ? 12 : 16,
            fontFamily: mono ? 'JetBrains Mono' : 'inherit',
            fontWeight: 600,
            marginTop: 2,
            color: tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--text)',
          }}
        >
          {value}
        </div>
      </div>
    );
  }

  function ModelOption({ model, selected, onSelect }) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="card"
        style={{
          padding: 12,
          textAlign: 'left',
          cursor: 'pointer',
          borderColor: selected ? 'var(--accent)' : 'var(--border)',
          background: selected ? 'var(--accent-soft)' : 'var(--bg-elevated)',
          boxShadow: selected ? 'var(--shadow-focus)' : 'var(--shadow-xs)',
          transition: 'all 150ms',
        }}
      >
        <div className="flex items-center justify-between">
          <div style={{ fontSize: 13.5, fontWeight: 600, color: selected ? 'var(--accent)' : 'var(--text)' }}>
            {model.label}
          </div>
          {selected && <Icon name="check-circle" size={14} style={{ color: 'var(--accent)' }} />}
        </div>
        <div className="text-sm text-muted mt-1" style={{ fontSize: 11.5 }}>
          {model.tag} · <span style={{ fontFamily: 'JetBrains Mono' }}>{model.id}</span>
        </div>
      </button>
    );
  }

  function Toggle({ checked, onChange }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        style={{
          width: 38,
          height: 22,
          borderRadius: 22,
          background: checked ? 'var(--accent)' : 'var(--bg-subtle)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
          padding: 0,
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 200ms, border-color 200ms',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1,
            left: checked ? 17 : 1,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'white',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.18)',
            transition: 'left 200ms',
          }}
        />
      </button>
    );
  }

  window.App = window.App || {};
  window.App.SettingsView = SettingsView;
})();
