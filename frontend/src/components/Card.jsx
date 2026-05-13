/* ==========================================================================
   Card.jsx — Container with optional header/body/footer.
   NOTE: Avoids `...rest` destructure (see Button.jsx for the babel-standalone
   `_excluded` collision story).
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;

  function Card(props) {
    const children = props.children;
    const className = props.className ?? '';
    const noPadding = props.noPadding ?? false;
    return (
      <div
        className={cn('card', className)}
        style={props.style}
        onClick={props.onClick}
        id={props.id}
      >
        {noPadding ? children : <div className="card-body">{children}</div>}
      </div>
    );
  }

  function CardRaw(props) {
    const children = props.children;
    const className = props.className ?? '';
    return (
      <div
        className={cn('card', className)}
        style={props.style}
        onClick={props.onClick}
        id={props.id}
      >
        {children}
      </div>
    );
  }

  function CardHeader({ icon, title, subtitle, actions, children, className = '' }) {
    return (
      <div className={cn('card-header', className)}>
        {icon && <div className="section-heading-icon">{icon}</div>}
        <div className="flex-1">
          {title && <div className="card-title">{title}</div>}
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
          {children}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    );
  }

  function CardBody({ children, className = '' }) {
    return <div className={cn('card-body', className)}>{children}</div>;
  }

  function CardFooter({ children, className = '' }) {
    return <div className={cn('card-footer', className)}>{children}</div>;
  }

  window.App = window.App || {};
  window.App.Card = Card;
  window.App.CardRaw = CardRaw;
  window.App.CardHeader = CardHeader;
  window.App.CardBody = CardBody;
  window.App.CardFooter = CardFooter;
})();
