/* ==========================================================================
   Dropzone.jsx — Big drag-and-drop area + click-to-browse fallback.
   ========================================================================== */
(() => {
  'use strict';
  const { useRef } = React;
  const { cn, isAcceptableFile } = window.App.utils;
  const { Icon } = window.App;
  const { useDragDrop } = window.App.hooks;

  function Dropzone({ onFiles, accept = '.pdf,.docx,.doc,.png,.jpg,.jpeg,.tiff' }) {
    const inputRef = useRef(null);

    const accept_files = (files) => {
      const acceptable = files.filter(isAcceptableFile);
      if (acceptable.length > 0) onFiles(acceptable);
    };

    const { isOver, handlers } = useDragDrop({ onFiles: accept_files });

    return (
      <div
        className={cn('dropzone', isOver && 'drag-over')}
        onClick={() => inputRef.current?.click()}
        {...handlers}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <div className="dropzone-content">
          <div className="dropzone-icon">
            <Icon name="upload-cloud" size={26} strokeWidth={1.5} />
          </div>
          <div className="dropzone-title">
            {isOver ? 'Drop your POs to extract' : 'Drag and drop POs to extract'}
          </div>
          <div className="dropzone-subtitle">
            or <span style={{ color: 'var(--accent)', fontWeight: 600 }}>click to browse</span> · Documents are processed locally with your LLM
          </div>
          <div className="dropzone-formats">
            <span className="dropzone-format">PDF</span>
            <span className="dropzone-format">DOCX</span>
            <span className="dropzone-format">PNG</span>
            <span className="dropzone-format">JPG</span>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) accept_files(files);
            e.target.value = '';
          }}
        />
      </div>
    );
  }

  window.App = window.App || {};
  window.App.Dropzone = Dropzone;
})();
