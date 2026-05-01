/* ==========================================================================
   config.js — API key + model config.

   Keys must come from:
     1. User Settings → localStorage (`foundry.openrouter.apiKey`), or
     2. Streamlit deployment → `window.STREAMLIT_API_KEY` from `.streamlit/secrets.toml`
        (never commit real secrets; `secrets.toml` is gitignored).

   Do not put API keys in this file — it is bundled into the browser.
   ========================================================================== */
(() => {
  'use strict';

  const DEFAULT_API_KEYS = [];
  const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

  const API_KEY_STORAGE = 'foundry.openrouter.apiKey';
  const MODEL_STORAGE = 'foundry.openrouter.model';

  const AVAILABLE_MODELS = [
    { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', tag: 'Recommended', tier: 'balanced' },
    { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', tag: 'Newer', tier: 'balanced' },
    { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6', tag: 'Most accurate', tier: 'pro' },
    { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', tag: 'Fastest', tier: 'fast' },
    { id: 'openai/gpt-5.5', label: 'GPT-5.5', tag: 'OpenAI', tier: 'balanced' },
    { id: 'openai/gpt-5.5-pro', label: 'GPT-5.5 Pro', tag: 'OpenAI · accurate', tier: 'pro' },
  ];

  function getApiKey() {
    const keys = getApiKeys();
    return keys[0] || '';
  }

  /**
   * Ordered list of keys to try. The OpenRouter client walks this list and
   * falls back to the next key on credit/auth/rate-limit errors.
   */
  function getApiKeys() {
    try {
      const stored = window.localStorage.getItem(API_KEY_STORAGE);
      if (stored && stored.trim()) return [stored.trim()];
    } catch {
      /* localStorage unavailable */
    }
    if (window.STREAMLIT_API_KEY && String(window.STREAMLIT_API_KEY).trim()) {
      return [String(window.STREAMLIT_API_KEY).trim()];
    }
    return [...DEFAULT_API_KEYS];
  }

  function setApiKey(key) {
    try {
      if (key && key.trim()) {
        window.localStorage.setItem(API_KEY_STORAGE, key.trim());
      } else {
        window.localStorage.removeItem(API_KEY_STORAGE);
      }
    } catch (e) {
      console.warn('Could not persist API key', e);
    }
  }

  /** True when the user has not saved a key in Settings (Streamlit or none). */
  function isUsingDefaultKey() {
    try {
      return !window.localStorage.getItem(API_KEY_STORAGE);
    } catch {
      return true;
    }
  }

  function getModel() {
    try {
      return window.localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL;
    } catch {
      return DEFAULT_MODEL;
    }
  }

  function setModel(m) {
    try {
      window.localStorage.setItem(MODEL_STORAGE, m);
    } catch (e) {
      console.warn('Could not persist model selection', e);
    }
  }

  window.App = window.App || {};
  window.App.config = {
    getApiKey,
    getApiKeys,
    setApiKey,
    isUsingDefaultKey,
    getModel,
    setModel,
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    DEFAULT_API_KEY_COUNT: DEFAULT_API_KEYS.length,
  };
})();
