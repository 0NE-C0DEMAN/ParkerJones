/* ==========================================================================
   Button.jsx — Variants: primary | secondary | ghost | danger.
   Sizes: sm | md (default) | lg. Optional iconLeft/iconRight or icon-only.
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;
  const { Icon } = window.App;

  function Button({
    variant = 'secondary',
    size = 'md',
    iconLeft,
    iconRight,
    iconOnly,
    loading = false,
    disabled = false,
    type = 'button',
    className = '',
    children,
    ...rest
  }) {
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
      <button type={type} className={classes} disabled={disabled || loading} {...rest}>
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
