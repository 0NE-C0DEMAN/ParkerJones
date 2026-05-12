/* ==========================================================================
   SettingsView.jsx — API key + model + workflow + ledger management.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect } = React;
  const { Card, CardHeader, Segmented, Button, Icon, Badge, Field, Input } = window.App;
  const { useLocalStorage } = window.App.hooks;

  function SettingsView({ onClearLedger, recordCount, pushToast, backendOnline = true }) {
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
        <Card noPadding className="mb-0">
          <CardHeader
            title="OpenRouter API"
            subtitle="Used for the LLM extraction. Stored in your browser only."
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
                    placeholder="sk-or-v1-..."
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
                Keys persist locally via <code style={{ background: 'var(--bg-subtle)', padding: '1px 4px', borderRadius: 3 }}>localStorage</code>. Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>openrouter.ai/keys</a>.
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
                Sonnet 4.5 is the recommended default — accurate enough for dense industrial POs at $3/M input tokens.
              </span>
            </Field>
          </div>
        </Card>

        <Card noPadding className="mb-0">
          <CardHeader
            title="Workflow"
            subtitle="How extracted POs become Excel rows."
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
            <div className="settings-row">
              <div>
                <div className="settings-label">Excel destination</div>
                <div className="settings-help">Where the rolling ledger file is saved (OneDrive sync recommended once Streamlit ships).</div>
              </div>
              <div className="settings-control">
                <Badge tone="default">Browser download</Badge>
              </div>
            </div>
          </div>
        </Card>

        <Card noPadding className="mb-0">
          <CardHeader
            title="Ledger data"
            subtitle="Your local PO history."
            icon={<Icon name="rows" size={12} />}
          />
          <div className="settings-section">
            <div className="settings-row">
              <div>
                <div className="settings-label">Stored locally</div>
                <div className="settings-help">{recordCount} PO{recordCount === 1 ? '' : 's'} in browser storage. Cleared if you reset the browser.</div>
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

       </div>
        <div className="text-sm text-muted text-center" style={{ marginTop: 12, fontSize: 11 }}>
          Foundry · v0.3 · Backend: <span style={{ color: backendOnline ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
            {backendOnline ? 'connected' : 'offline'}
          </span> ({(window.App?.backend?.BASE ?? 'localhost:8503') || window.location.host})
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
