/* ==========================================================================
   Card.jsx — Container with optional header/body/footer.
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;

  function Card({ children, className = '', noPadding = false, ...rest }) {
    return <div className={cn('card', className)} {...rest}>{noPadding ? children : <div className="card-body">{children}</div>}</div>;
  }

  function CardRaw({ children, className = '', ...rest }) {
    return <div className={cn('card', className)} {...rest}>{children}</div>;
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
