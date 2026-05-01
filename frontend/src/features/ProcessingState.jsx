/* ==========================================================================
   ProcessingState.jsx — Animated extraction progress (orb + pipeline steps).
   ========================================================================== */
(() => {
  'use strict';
  const { Icon } = window.App;
  const { cn } = window.App.utils;

  const STAGE_ORDER = ['parsing', 'extracting', 'validating'];

  function ProcessingState({ stage, filename }) {
    const stageIndex = STAGE_ORDER.indexOf(stage);

    return (
      <div className="card processing">
        <div className="processing-orb">
          <div className="processing-orb-inner">
            <Icon name="sparkles" size={20} strokeWidth={2} />
          </div>
        </div>
        <div>
          <div className="processing-title">Extracting purchase order</div>
          <div className="processing-text">{filename}</div>
        </div>
        <div className="processing-steps">
          {STAGE_ORDER.map((s, i) => (
            <span
              key={s}
              className={cn(
                'step',
                i < stageIndex && 'done',
                i === stageIndex && 'active',
              )}
            >
              {i < stageIndex ? <Icon name="check" size={12} /> : <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid currentColor', display: 'inline-block' }} />}
              <span style={{ textTransform: 'capitalize' }}>{labelFor(s)}</span>
              {i < STAGE_ORDER.length - 1 && <span className="sep">·</span>}
            </span>
          ))}
        </div>
      </div>
    );
  }

  function labelFor(stage) {
    return {
      parsing: 'Read document',
      extracting: 'Extract fields',
      validating: 'Validate',
    }[stage] || stage;
  }

  window.App = window.App || {};
  window.App.ProcessingState = ProcessingState;
})();
