/* ==========================================================================
   config.js — Provider/model/key configuration.

   Supports multiple LLM providers, auto-detected from the API key prefix:
     - "AIzaSy..." → Google Gemini   (free tier; check AI Studio for current
                                      rate limits — Google publishes them
                                      per-account these days, not as a fixed
                                      public number)
     - "sk-or-..."  → OpenRouter
     - "sk-..."     → OpenAI direct (not implemented)

   Default keys are tried in order; backup is auto-tried only on credit/auth
   failures (see openrouter.js / gemini.js _withFallback).
   ========================================================================== */
(() => {
  'use strict';

  // Default keys are intentionally empty in source — DO NOT COMMIT KEYS HERE.
  // Real keys come from:
  //   1. The in-app Settings panel (saved to browser localStorage), OR
  //   2. .streamlit/secrets.toml under OPENROUTER_API_KEY (injected as
  //      window.STREAMLIT_API_KEY by app.py), OR
  //   3. The first run will prompt for a key in Settings.
  const DEFAULT_API_KEYS = [];
  const DEFAULT_API_KEY = '';

  // Default model — Gemini 2.5 Flash. On a bake-off across all 5 reference
  // POs, Flash beat Flash-Lite 5-to-1 on invoice-critical fields (correctly
  // identified ALLIED COMPONENTS as Meridian's supplier where Lite confused
  // the customer for the supplier; got the Ariba Mfr Part # / Item # split
  // right on Duke; stripped the "R" reference code from TEMA ship_to).
  // Cost at ~1000 POs/day is roughly $30/month vs. $15/month — small price
  // for eliminating wrong-vendor invoice routing. Lite remains selectable
  // in Settings for cost-sensitive use.
  const DEFAULT_MODEL = 'gemini-2.5-flash';

  const API_KEY_STORAGE = 'foundry.openrouter.apiKey';   // legacy name, holds whichever provider's key
  const MODEL_STORAGE = 'foundry.openrouter.model';

  // Models the user can choose from in Settings. Each one declares its
  // provider so the extractor knows which client to call.
  const AVAILABLE_MODELS = [
    { id: 'gemini-2.5-flash',              label: 'Gemini 2.5 Flash',      tag: 'Recommended · best accuracy',  provider: 'google' },
    { id: 'gemini-2.5-flash-lite',         label: 'Gemini 2.5 Flash Lite', tag: 'Cheapest · less accurate',     provider: 'google' },
    { id: 'gemini-2.5-pro',                label: 'Gemini 2.5 Pro',        tag: 'Highest quality (paid)',       provider: 'google' },
    // Gemma 4 — open-weights Google model. Slower (~2.5× vs Flash) but
    // ~3× free-tier rate limit headroom (30 RPM / 14k RPD) and a
    // useful fallback when pdfplumber's overlay-text corruption trips
    // Gemini up (verified on the Apex/Ariba sample).
    { id: 'gemma-4-26b-a4b-it',            label: 'Gemma 4 26B',           tag: 'Open weights · higher rate limits', provider: 'google' },
    { id: 'anthropic/claude-haiku-4.5',    label: 'Claude Haiku 4.5',      tag: 'Cheap (OpenRouter)',           provider: 'openrouter' },
    { id: 'anthropic/claude-sonnet-4.5',   label: 'Claude Sonnet 4.5',     tag: 'Mid-tier (OpenRouter)',        provider: 'openrouter' },
    { id: 'anthropic/claude-opus-4.6',     label: 'Claude Opus 4.6',       tag: 'Expensive (OpenRouter)',       provider: 'openrouter' },
  ];

  // ----- key + model accessors -----

  function getApiKey() { return getApiKeys()[0]; }

  /** Ordered list of keys to try (user override first, then defaults). */
  function getApiKeys() {
    try {
      const stored = window.localStorage.getItem(API_KEY_STORAGE);
      if (stored) return [stored];
    } catch { /* localStorage unavailable */ }
    if (window.STREAMLIT_API_KEY) return [window.STREAMLIT_API_KEY];
    return [...DEFAULT_API_KEYS];
  }

  function setApiKey(key) {
    try {
      if (key && key.trim()) window.localStorage.setItem(API_KEY_STORAGE, key.trim());
      else window.localStorage.removeItem(API_KEY_STORAGE);
    } catch (e) { console.warn('Could not persist API key', e); }
  }

  function isUsingDefaultKey() {
    try {
      const stored = window.localStorage.getItem(API_KEY_STORAGE);
      return !stored || DEFAULT_API_KEYS.includes(stored);
    } catch { return true; }
  }

  function getModel() {
    try { return window.localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL; }
    catch { return DEFAULT_MODEL; }
  }

  function setModel(m) {
    try { window.localStorage.setItem(MODEL_STORAGE, m); }
    catch (e) { console.warn('Could not persist model selection', e); }
  }

  // ----- provider detection -----

  /** Detect provider from a key prefix. */
  function detectProvider(key) {
    if (!key) return 'openrouter';
    const k = String(key).trim();
    if (k.startsWith('AIzaSy')) return 'google';
    if (k.startsWith('sk-or-')) return 'openrouter';
    if (k.startsWith('sk-'))    return 'openai';
    return 'openrouter';
  }

  /** Provider for a given model id (looks at AVAILABLE_MODELS). */
  function providerForModel(modelId) {
    const m = AVAILABLE_MODELS.find((x) => x.id === modelId);
    return m ? m.provider : (modelId && modelId.startsWith('gemini') ? 'google' : 'openrouter');
  }

  /** Filter the key list down to ones matching the chosen provider. Falls
   *  back to all keys if none match (so the user can still get an error
   *  message rather than "no keys"). */
  function keysForProvider(provider) {
    const keys = getApiKeys();
    const matched = keys.filter((k) => detectProvider(k) === provider);
    return matched.length ? matched : keys;
  }

  window.App = window.App || {};
  window.App.config = {
    getApiKey,
    getApiKeys,
    setApiKey,
    isUsingDefaultKey,
    getModel,
    setModel,
    detectProvider,
    providerForModel,
    keysForProvider,
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    DEFAULT_API_KEY_COUNT: DEFAULT_API_KEYS.length,
  };
})();
