/* ==========================================================================
   Button.jsx — Variants: primary | secondary | ghost | danger.
   Sizes: sm | md (default) | lg. Optional iconLeft/iconRight or icon-only.

   NOTE: We deliberately avoid the `...rest` destructure pattern here.
   Babel-Standalone (which transpiles all the script tags at runtime) emits
   `var _excluded = [...]` at the top of EACH compiled script, OUTSIDE the
   source-level IIFE. Because every script tag executes in the global
   scope, those `var _excluded` declarations all collide on `window._excluded`
   and only the last script's array survives — so the rest-spread in every
   earlier component would strip the WRONG set of keys and leak
   non-DOM props like `variant`, `iconLeft`, `loading` onto the DOM
   (and trigger the React "non-boolean attribute" warning).
   Forwarding events/aria/style explicitly avoids the helper entirely.
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;
  const { Icon } = window.App;

  function Button(props) {
    const variant   = props.variant   ?? 'secondary';
    const size      = props.size      ?? 'md';
    const iconLeft  = props.iconLeft;
    const iconRight = props.iconRight;
    const iconOnly  = props.iconOnly;
    const loading   = props.loading   ?? false;
    const disabled  = props.disabled  ?? false;
    const type      = props.type      ?? 'button';
    const className = props.className ?? '';
    const children  = props.children;

    const classes = cn(
      'btn',
      `btn-${variant}`,
      size === 'sm' && 'btn-sm',
      size === 'lg' && 'btn-lg',
      iconOnly && 'btn-icon',
      className,
    );

    const iconSize = size === 'sm' ? 14 : size === 'lg' ? 16 : 15;

    return (
      <button
        type={type}
        className={classes}
        disabled={disabled || loading}
        onClick={props.onClick}
        onMouseDown={props.onMouseDown}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        title={props.title}
        style={props.style}
        name={props.name}
        value={props.value}
        aria-label={props['aria-label']}
        aria-pressed={props['aria-pressed']}
        aria-expanded={props['aria-expanded']}
        aria-haspopup={props['aria-haspopup']}
        autoFocus={props.autoFocus}
      >
        {loading ? (
          <span className="spinner" aria-label="Loading" />
        ) : iconLeft ? (
          <Icon name={iconLeft} size={iconSize} />
        ) : null}
        {!iconOnly && children}
        {!loading && iconRight && <Icon name={iconRight} size={iconSize} />}
        {iconOnly && !iconLeft && !loading && <Icon name={iconOnly} size={iconSize} />}
      </button>
    );
  }

  window.App = window.App || {};
  window.App.Button = Button;
})();
