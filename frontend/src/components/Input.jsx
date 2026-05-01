/* ==========================================================================
   Input.jsx — Labeled input/textarea. Includes search variant with icon.
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;
  const { Icon } = window.App;

  function Field({ label, required, hint, error, children, className = '' }) {
    return (
      <div className={cn('field', className)}>
        {label && (
          <label className={cn('label', required && 'label-required')}>
            {label}
          </label>
        )}
        {children}
        {hint && !error && <span className="text-sm text-subtle">{hint}</span>}
        {error && <span className="text-sm" style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>
    );
  }

  function Input({ value, onChange, type = 'text', placeholder, className = '', ...rest }) {
    return (
      <input
        type={type}
        className={cn('input', className)}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value, e)}
        placeholder={placeholder}
        {...rest}
      />
    );
  }

  function Textarea({ value, onChange, rows = 3, placeholder, className = '', ...rest }) {
    return (
      <textarea
        className={cn('textarea', className)}
        rows={rows}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value, e)}
        placeholder={placeholder}
        {...rest}
      />
    );
  }

  function SearchInput({ value, onChange, placeholder = 'Search...', className = '', ...rest }) {
    return (
      <div className={cn('input-with-icon', className)}>
        <span className="input-icon"><Icon name="search" size={14} /></span>
        <input
          type="search"
          className="input"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value, e)}
          placeholder={placeholder}
          {...rest}
        />
      </div>
    );
  }

  window.App = window.App || {};
  window.App.Field = Field;
  window.App.Input = Input;
  window.App.Textarea = Textarea;
  window.App.SearchInput = SearchInput;
})();
