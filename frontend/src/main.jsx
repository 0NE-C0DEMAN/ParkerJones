/* ==========================================================================
   main.jsx — Boot the React tree. Loaded last after every component is
   registered on window.App.
   ========================================================================== */
(() => {
  'use strict';
  const { App } = window.App;

  if (!App) {
    document.body.innerHTML = '<div style="padding:40px;font-family:system-ui;color:#b91c1c;">App component failed to load. Check the browser console for errors.</div>';
    return;
  }

  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
})();
