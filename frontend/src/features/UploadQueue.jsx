/* ==========================================================================
   UploadQueue.jsx — Visible queue of files waiting to be processed.
   Shown in the UploadView when more than one file is dropped at once.
   ========================================================================== */
(() => {
  'use strict';
  const { fileSize, fileTypeBadge, truncate } = window.App.utils;
  const { Icon, Button } = window.App;

  function UploadQueue({ queue, currentIndex, total, onRemove, onClear }) {
    if (!queue || queue.length === 0) return null;

    return (
      <div className="upload-queue">
        <div className="upload-queue-header">
          <div className="flex items-center gap-2">
            <Icon name="inbox" size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>
              {total > 1
                ? `Queue · processing ${currentIndex + 1} of ${total}`
                : `Queue · ${queue.length} file${queue.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {onClear && (
            <Button variant="ghost" size="sm" iconLeft="x" onClick={onClear}>
              Clear queue
            </Button>
          )}
        </div>
        <div className="upload-queue-list">
          {queue.map((f, i) => {
            const isCurrent = i === currentIndex;
            const isDone = i < currentIndex;
            const badge = fileTypeBadge(f.name);
            return (
              <div key={i} className={`upload-queue-item ${isCurrent ? 'is-current' : isDone ? 'is-done' : ''}`}>
                <div className={`file-icon ${badge.class}`}>{badge.label}</div>
                <div className="file-info">
                  <div className="file-name" title={f.name}>{truncate(f.name, 60)}</div>
                  <div className="file-meta">
                    {fileSize(f.size)}
                    {isCurrent && <> · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>extracting…</span></>}
                    {isDone && <> · <span style={{ color: 'var(--success)', fontWeight: 600 }}>done</span></>}
                  </div>
                </div>
                <div className="upload-queue-status">
                  {isDone && <Icon name="check-circle" size={16} style={{ color: 'var(--success)' }} />}
                  {isCurrent && <span className="spinner" style={{ color: 'var(--accent)' }} />}
                  {!isCurrent && !isDone && onRemove && (
                    <Button variant="ghost" size="sm" iconOnly="x" onClick={() => onRemove(i)} title="Remove from queue" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.UploadQueue = UploadQueue;
})();
