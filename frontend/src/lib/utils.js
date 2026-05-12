/* ==========================================================================
   utils.js — Pure helpers (formatters, classnames, ids, file metadata)
   No dependencies.
   ========================================================================== */
(() => {
  'use strict';

  function formatCurrency(value, currency = 'USD') {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US').format(n);
  }

  function formatDate(input) {
    if (!input) return '—';
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateInput(input) {
    if (!input) return '';
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return '';
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function formatDateTime(input) {
    if (!input) return '—';
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function relativeTime(input) {
    if (!input) return '';
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return '';
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return formatDate(input);
  }

  function cn(...args) {
    return args.filter(Boolean).join(' ');
  }

  function fileExtension(filename) {
    if (!filename) return '';
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
  }

  function fileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function lineItemsTotal(items) {
    return (items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  }

  function fileTypeBadge(filename) {
    const ext = fileExtension(filename);
    if (['pdf'].includes(ext)) return { class: '', label: 'PDF' };
    if (['doc', 'docx'].includes(ext)) return { class: 'docx', label: 'DOCX' };
    if (['xls', 'xlsx', 'csv'].includes(ext)) return { class: 'xlsx', label: 'XLS' };
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'bmp'].includes(ext)) return { class: 'image', label: 'IMG' };
    return { class: '', label: ext.toUpperCase() || 'FILE' };
  }

  function isAcceptableFile(file) {
    const ext = fileExtension(file.name);
    return ['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'tiff', 'bmp', 'webp'].includes(ext);
  }

  function truncate(str, max = 40) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function confidenceFor(record, field) {
    const c = record?.confidence || {};
    if ((c.high || []).includes(field)) return 'high';
    if ((c.medium || []).includes(field)) return 'med';
    if ((c.low || []).includes(field)) return 'low';
    return 'high';
  }

  window.App = window.App || {};
  window.App.utils = {
    formatCurrency,
    formatNumber,
    formatDate,
    formatDateInput,
    formatDateTime,
    relativeTime,
    cn,
    fileExtension,
    fileSize,
    uuid,
    lineItemsTotal,
    fileTypeBadge,
    isAcceptableFile,
    truncate,
    confidenceFor,
  };
})();
