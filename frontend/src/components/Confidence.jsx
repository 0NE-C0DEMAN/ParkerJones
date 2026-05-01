/* ==========================================================================
   Confidence.jsx — Per-field LLM extraction confidence pill (high/med/low).
   ========================================================================== */
(() => {
  'use strict';
  const { cn } = window.App.utils;

  const LABELS = {
    high: 'High',
    med: 'Med',
    low: 'Low',
  };

  function Confidence({ level = 'high', showLabel = false }) {
    return (
      <span className={cn('conf', `conf-${level}`)} title={`Extraction confidence: ${LABELS[level]}`}>
        <span className="dot" />
        {showLabel && LABELS[level]}
      </span>
    );
  }

  window.App = window.App || {};
  window.App.Confidence = Confidence;
})();
