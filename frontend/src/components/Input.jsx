/* ==========================================================================
   Input.jsx — Labeled input/textarea. Includes search variant with icon.

   NOTE: Avoids `...rest` destructure (see Button.jsx for the babel-standalone
   `_excluded` collision story). Forwards specific input/textarea attrs
   explicitly so non-DOM props don't leak.
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

  function Input(props) {
    const type = props.type ?? 'text';
    const value = props.value;
    const onChange = props.onChange;
    const placeholder = props.placeholder;
    const className = props.className ?? '';
    return (
      <input
        type={type}
        className={cn('input', className)}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value, e)}
        placeholder={placeholder}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
        onKeyDown={props.onKeyDown}
        onKeyUp={props.onKeyUp}
        onClick={props.onClick}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        required={props.required}
        disabled={props.disabled}
        readOnly={props.readOnly}
        name={props.name}
        id={props.id}
        style={props.style}
        min={props.min}
        max={props.max}
        step={props.step}
        maxLength={props.maxLength}
        minLength={props.minLength}
        pattern={props.pattern}
        inputMode={props.inputMode}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
      />
    );
  }

  function Textarea(props) {
    const value = props.value;
    const onChange = props.onChange;
    const rows = props.rows ?? 3;
    const placeholder = props.placeholder;
    const className = props.className ?? '';
    return (
      <textarea
        className={cn('textarea', className)}
        rows={rows}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value, e)}
        placeholder={placeholder}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
        onKeyDown={props.onKeyDown}
        disabled={props.disabled}
        readOnly={props.readOnly}
        required={props.required}
        name={props.name}
        id={props.id}
        style={props.style}
        maxLength={props.maxLength}
        aria-label={props['aria-label']}
      />
    );
  }

  function SearchInput(props) {
    const value = props.value;
    const onChange = props.onChange;
    const placeholder = props.placeholder ?? 'Search...';
    const className = props.className ?? '';
    return (
      <div className={cn('input-with-icon', className)}>
        <span className="input-icon"><Icon name="search" size={14} /></span>
        <input
          type="search"
          className="input"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value, e)}
          placeholder={placeholder}
          onBlur={props.onBlur}
          onFocus={props.onFocus}
          onKeyDown={props.onKeyDown}
          autoFocus={props.autoFocus}
          aria-label={props['aria-label']}
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
