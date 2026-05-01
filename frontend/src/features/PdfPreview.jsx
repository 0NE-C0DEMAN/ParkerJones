/* ==========================================================================
   PdfPreview.jsx — Source PDF viewer used in the review pane.

   Two display modes (chosen automatically):
     1. PDFs: pdf.js renders each page to a <canvas>.
        Required because Streamlit's srcdoc iframe runs in a sandbox where
        Chrome's PDF viewer refuses embedded PDFs.
     2. Non-PDF backend-served URL: native image/browser rendering.
   ========================================================================== */
(() => {
  'use strict';
  const { useEffect, useMemo, useRef, useState } = React;
  const ReactDOM = window.ReactDOM;
  const { Icon, Button, EmptyState } = window.App;

  function PdfPreview({ file, sourceUrl, filename, method }) {
    const isPdf = !filename || /\.pdf$/i.test(filename);
    const shouldUseCanvas = isPdf && (!!file || !!sourceUrl);

    if (!file && !sourceUrl) {
      return (
        <div className="pdf-preview-card">
          <PreviewHeader filename={filename} method={method} />
          <EmptyState
            icon="file-text"
            title="No source attached"
            text="The original file isn't stored for this PO. Re-upload to attach a source."
          />
        </div>
      );
    }

    return shouldUseCanvas
      ? <CanvasPreview file={file} sourceUrl={sourceUrl} filename={filename} method={method} />
      : <IframePreview sourceUrl={sourceUrl} filename={filename} method={method} />;
  }

  function PreviewHeader({ filename, method, downloadHandler, openHandler, refreshHandler, fullscreenHandler }) {
    return (
      <div className="pdf-preview-header">
        <div className="flex items-center gap-2 flex-1" style={{ minWidth: 0 }}>
          <Icon name="file-text" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{
            fontWeight: 600, fontSize: 12.5,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }} title={filename}>
            {filename || 'source'}
          </span>
          {method === 'vision' && (
            <span className="badge badge-accent" style={{ flexShrink: 0 }}>
              <Icon name="sparkles" size={10} />
              Vision
            </span>
          )}
        </div>
        {refreshHandler && (
          <Button variant="ghost" size="sm" iconOnly="rotate-cw" onClick={refreshHandler} title="Reload preview" />
        )}
        {fullscreenHandler && (
          <Button variant="ghost" size="sm" iconOnly="maximize" onClick={fullscreenHandler} title="Open large preview" />
        )}
        {downloadHandler && (
          <Button variant="ghost" size="sm" iconOnly="download" title="Download original" onClick={downloadHandler} />
        )}
        {openHandler && (
          <Button variant="ghost" size="sm" iconOnly="arrow-right" title="Open in new tab" onClick={openHandler} />
        )}
      </div>
    );
  }

  // Non-PDF backend-served URLs — use native image/browser rendering.
  function IframePreview({ sourceUrl, filename, method }) {
    const [iframeKey, setIframeKey] = useState(0);
    const isPdf = !filename || /\.pdf$/i.test(filename);

    return (
      <div className="pdf-preview-card">
        <PreviewHeader
          filename={filename}
          method={method}
          refreshHandler={() => setIframeKey((k) => k + 1)}
          downloadHandler={() => {
            const a = document.createElement('a');
            a.href = sourceUrl; a.download = filename || 'document.pdf'; a.click();
          }}
          openHandler={() => window.open(sourceUrl, '_blank', 'noopener')}
        />
        <div className="pdf-preview-body">
          {isPdf ? (
            <iframe key={iframeKey} src={sourceUrl} title="Source document" className="pdf-preview-iframe" />
          ) : (
            <img src={sourceUrl} alt={filename} className="pdf-preview-image" />
          )}
        </div>
      </div>
    );
  }

  // PDFs — render each page to a canvas with pdf.js.
  function CanvasPreview({ file, sourceUrl, filename, method }) {
    const [pages, setPages] = useState([]);     // [{ width, height, canvasUrl }]
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [scale, setScale] = useState(1.4);
    const [fullscreen, setFullscreen] = useState(false);

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      setPages([]);

      (async () => {
        try {
          if (!window.pdfjsLib) throw new Error('pdf.js not loaded');
          const PDFJS_VERSION = '3.11.174';
          const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            `${PDFJS_CDN}/build/pdf.worker.min.js`;

          const buf = file
            ? await file.arrayBuffer()
            : await fetch(sourceUrl).then((res) => {
                if (!res.ok) throw new Error(`Failed to load PDF preview (HTTP ${res.status})`);
                return res.arrayBuffer();
              });
          const pdf = await window.pdfjsLib.getDocument({
            data: buf,
            cMapUrl: `${PDFJS_CDN}/cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${PDFJS_CDN}/standard_fonts/`,
            useSystemFonts: true,
          }).promise;
          const limit = Math.min(pdf.numPages, 25); // hard cap, e.g. Apex T&Cs

          const out = [];
          for (let i = 1; i <= limit; i++) {
            if (cancelled) return;
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            out.push({ url: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height });
            if (!cancelled) setPages([...out]);
          }
          if (!cancelled) setLoading(false);
        } catch (err) {
          if (!cancelled) {
            console.error('PDF preview render failed:', err);
            setError(err.message || 'Failed to render PDF');
            setLoading(false);
          }
        }
      })();

      return () => { cancelled = true; };
    }, [file, sourceUrl, scale]);

    const downloadFile = () => {
      const url = file ? URL.createObjectURL(file) : sourceUrl;
      const a = document.createElement('a');
      a.href = url; a.download = filename || file?.name || 'document.pdf'; a.click();
      if (file) setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    return (
      <div className="pdf-preview-card">
        <PreviewHeader
          filename={filename}
          method={method}
          downloadHandler={downloadFile}
          fullscreenHandler={() => setFullscreen(true)}
        />
        <div className="pdf-preview-body pdf-preview-canvas-scroll">
          {error && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger)', fontSize: 12.5 }}>
              <Icon name="alert-circle" size={20} />
              <div style={{ marginTop: 6 }}>{error}</div>
            </div>
          )}
          {!error && pages.length === 0 && loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
              <span className="spinner" style={{ color: 'var(--accent)' }} />
              <div style={{ marginTop: 8 }}>Rendering preview...</div>
            </div>
          )}
          {pages.map((p, i) => (
            <img
              key={i}
              src={p.url}
              alt={`Page ${i + 1}`}
              className="pdf-preview-page-canvas"
              loading="lazy"
            />
          ))}
          {!loading && pages.length > 0 && (
            <div style={{ textAlign: 'center', padding: '8px 0 12px', fontSize: 11, color: 'var(--text-subtle)' }}>
              {pages.length} {pages.length === 1 ? 'page' : 'pages'}
            </div>
          )}
        </div>
        {fullscreen && ReactDOM.createPortal(
          <PdfPreviewModal
            filename={filename}
            pages={pages}
            loading={loading}
            error={error}
            onClose={() => setFullscreen(false)}
            onDownload={downloadFile}
          />,
          document.body,
        )}
      </div>
    );
  }

  function PdfPreviewModal({ filename, pages, loading, error, onClose, onDownload }) {
    useEffect(() => {
      const onKeyDown = (event) => {
        if (event.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
      <div className="pdf-preview-modal" role="dialog" aria-modal="true" aria-label="Large PDF preview">
        <div className="pdf-preview-modal-backdrop" onClick={onClose} />
        <div className="pdf-preview-modal-panel">
          <div className="pdf-preview-modal-header">
            <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
              <Icon name="file-text" size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="pdf-preview-modal-title" title={filename}>{filename || 'source'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" iconLeft="download" onClick={onDownload}>Download</Button>
              <Button variant="ghost" size="sm" iconOnly="x" onClick={onClose} title="Close preview" />
            </div>
          </div>
          <div className="pdf-preview-modal-body">
            {error && (
              <div className="pdf-preview-modal-state" style={{ color: 'var(--danger)' }}>
                <Icon name="alert-circle" size={22} />
                <div>{error}</div>
              </div>
            )}
            {!error && pages.length === 0 && loading && (
              <div className="pdf-preview-modal-state">
                <span className="spinner" style={{ color: 'var(--accent)' }} />
                <div>Rendering preview...</div>
              </div>
            )}
            {pages.map((p, i) => (
              <img
                key={i}
                src={p.url}
                alt={`Page ${i + 1}`}
                className="pdf-preview-modal-page"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  window.App = window.App || {};
  window.App.PdfPreview = PdfPreview;
})();
