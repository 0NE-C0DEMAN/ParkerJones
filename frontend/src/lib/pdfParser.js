/* ==========================================================================
   pdfParser.js — Browser-side pdf.js helpers for the vision pipeline.
     - renderPagesToImages()  rasterise the first N pages to PNG; these are
                              the only input to the vision LLM (mockApi.js)
     - getPdfPageCount()      cheap page count without rendering

   No text extraction lives here anymore — every PO is read from the rendered
   page image by the vision model, so a parsed text layer is never needed.
   ========================================================================== */
(() => {
  'use strict';

  const PDFJS_VERSION = '3.11.174';
  const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

  let workerConfigured = false;

  function ensureWorker() {
    if (workerConfigured) return;
    if (!window.pdfjsLib) {
      throw new Error('pdf.js library not loaded');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    workerConfigured = true;
  }

  /**
   * Render pages of a PDF to PNG data URLs at the given scale. Used as the
   * vision-fallback path when text extraction returns nothing useful
   * (= scanned PDF).
   *
   * scale=2.0 (≈144 DPI) is empirically the sweet spot for industrial
   * POs: sharp enough that Gemini Flash reads small line-item digits
   * reliably, while keeping the base64 payload under ~250KB per page.
   * Lower (1.0–1.6) breaks vision on small fonts; higher (3.0+) blows
   * token budget without measurable accuracy gain.
   *
   * By default renders pages 1..maxPages. For chunked extraction of long
   * documents, pass `startPage` and `endPage` (1-indexed, inclusive) to
   * render a specific range. `maxPages` still acts as a safety cap on the
   * range length so a runaway caller can't blow up the browser.
   */
  async function renderPagesToImages(
    file,
    { maxPages = 30, startPage = 1, endPage = null, scale = 2.0, onPage } = {}
  ) {
    ensureWorker();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf, disableFontFace: true }).promise;

    const from = Math.max(1, startPage);
    const wantedEnd = endPage != null ? Math.min(endPage, pdf.numPages) : pdf.numPages;
    const to = Math.min(wantedEnd, from + maxPages - 1);

    const images = [];
    for (let i = from; i <= to; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL('image/png'));
      onPage?.(i, to);
    }
    return {
      images,
      totalPages: pdf.numPages,
      startPage: from,
      endPage: to,
      sentPages: images.length,
    };
  }

  /** Cheap helper — returns the page count without rendering anything. */
  async function getPdfPageCount(file) {
    ensureWorker();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf, disableFontFace: true }).promise;
    return pdf.numPages;
  }

  window.App = window.App || {};
  window.App.pdfParser = {
    renderPagesToImages,
    getPdfPageCount,
  };
})();
