/* ==========================================================================
   auth.js — Frontend auth: token management + login/register/me API.
   The token is stored in localStorage and injected into every backend
   fetch by api.js.
   ========================================================================== */
(() => {
  'use strict';

  const TOKEN_KEY = 'foundry.auth.token';
  const USER_KEY = 'foundry.auth.user';

  function getToken() {
    try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  function setToken(token) {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }
  function getCachedUser() {
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function setCachedUser(user) {
    try {
      if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
      else window.localStorage.removeItem(USER_KEY);
    } catch {}
  }
  function clearSession() {
    setToken(null);
    setCachedUser(null);
  }

  async function _request(path, opts = {}) {
    const BASE = window.App?.backend?.BASE || 'http://127.0.0.1:8503';
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        msg = body?.detail || body?.error || JSON.stringify(body);
      } catch { /* ignore */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function register({ email, full_name, password }) {
    const data = await _request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, full_name, password }),
    });
    setToken(data.token);
    setCachedUser(data.user);
    return data;
  }

  async function login({ email, password }) {
    const data = await _request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    setCachedUser(data.user);
    return data;
  }

  async function fetchMe() {
    const token = getToken();
    if (!token) return null;
    try {
      const user = await _request('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCachedUser(user);
      return user;
    } catch (err) {
      if (err.status === 401) clearSession();
      return null;
    }
  }

  async function updateProfile({ full_name }) {
    const token = getToken();
    const user = await _request('/api/auth/me', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ full_name }),
    });
    setCachedUser(user);
    return user;
  }

  async function changePassword({ current_password, new_password }) {
    const token = getToken();
    return _request('/api/auth/password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password, new_password }),
    });
  }

  async function logout() {
    const token = getToken();
    if (token) {
      try {
        await _request('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* ignore */ }
    }
    clearSession();
  }

  /** Auth header for use by api.js. */
  function authHeader() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function isAuthenticated() {
    return !!getToken();
  }

  window.App = window.App || {};
  window.App.auth = {
    register, login, logout, fetchMe, updateProfile, changePassword,
    getToken, getCachedUser, setCachedUser, clearSession,
    authHeader, isAuthenticated,
  };
})();
