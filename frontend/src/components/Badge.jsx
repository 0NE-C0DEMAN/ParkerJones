/* ==========================================================================
   Badge.jsx — Pill badge. Tones: default | success | warning | danger | info | accent.
   NOTE: Avoids `...rest` destructure (see Button.jsx for the babel-standalone
   `_excluded` collision story).
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;

  function Badge(props) {
    const tone = props.tone ?? 'default';
    const dot = props.dot ?? false;
    const children = props.children;
    const className = props.className ?? '';
    return (
      <span
        className={cn('badge', `badge-${tone}`, className)}
        style={props.style}
        title={props.title}
        onClick={props.onClick}
      >
        {dot && <span className="dot" />}
        {children}
      </span>
    );
  }

  window.App = window.App || {};
  window.App.Badge = Badge;
})();
