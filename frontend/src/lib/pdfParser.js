/* ==========================================================================
   pdfParser.js — Browser-side pdf.js helpers.
     - readFile()             text extraction fallback when the server's
                              pdfplumber endpoint is unreachable
     - renderPagesToImages()  rasterise pages to PNG for the hybrid /
                              vision LLM paths in mockApi.js
     - getPdfPageCount()      cheap page count without rendering

   Plain-text inputs (.txt / .csv / .md) are read directly. The scanned-PDF
   detection used to live here but moved into the deterministic
   "any text from pdfplumber → text path" check in mockApi.js.
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
   * Extract text from a PDF File. Returns an object with:
   *   { text: full concatenated text, pages: array of per-page strings }
   */
  async function extractPdfText(file, { onPage } = {}) {
    ensureWorker();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf, disableFontFace: true }).promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items || [];
      // Reconstruct lines using y-position so text flow is sensible
      const lines = groupItemsIntoLines(items);
      pages.push(lines.join('\n'));
      onPage?.(i, pdf.numPages);
    }

    return {
      text: pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n\n'),
      pages,
      pageCount: pdf.numPages,
    };
  }

  function groupItemsIntoLines(items) {
    if (!items.length) return [];
    // Cluster by transform[5] (y position), reading order
    const buckets = [];
    const TOLERANCE = 2.5;
    for (const it of items) {
      const y = (it.transform && it.transform[5]) || 0;
      const bucket = buckets.find((b) => Math.abs(b.y - y) <= TOLERANCE);
      if (bucket) {
        bucket.items.push(it);
      } else {
        buckets.push({ y, items: [it] });
      }
    }
    buckets.sort((a, b) => b.y - a.y); // top to bottom
    return buckets.map((b) => {
      b.items.sort((a, c) => (a.transform[4] || 0) - (c.transform[4] || 0));
      return b.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
  }

  async function extractPlainText(file) {
    return await file.text();
  }

  async function readFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf' || file.type === 'application/pdf') {
      return await extractPdfText(file);
    }
    if (['txt', 'csv', 'md'].includes(ext)) {
      const text = await extractPlainText(file);
      return { text, pages: [text], pageCount: 1 };
    }
    throw new Error(`Format .${ext} isn't supported. Convert to PDF and re-upload.`);
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
    readFile,
    renderPagesToImages,
    getPdfPageCount,
  };
})();
