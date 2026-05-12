/* ==========================================================================
   extractor (window.App.api) — Real PO extraction pipeline.

   Strategy is driven by PDF length, not "is it scanned":

     pageCount <= SHORT_PDF_PAGES  → render every page to PNG, run VISION LLM
                                     (sidesteps column-flattening AND overlaid
                                      template text in one shot — the model
                                      only sees what's actually rendered)

     pageCount >  SHORT_PDF_PAGES  → server-side pdfplumber extract_text(layout=True)
                                     with last-wins char dedup, run TEXT LLM
                                     (cheaper than rendering 30+ images, and
                                      pdfplumber's layout output is already
                                      column-aware)

   For very long text-mode extractions we still chunk per-page so we never
   hit MAX_TOKENS on a single response. Per-chunk failures are logged and
   surfaced via `_warnings` on the result — the extractor never throws on
   partial failure.

   Filename `mockApi.js` is preserved for backward compat with the existing
   <script> tag.
   ========================================================================== */
(() => {
  'use strict';

  // Hard cap on the number of pages we ever look at — vision path renders
  // up to this many, text path parses up to this many (server enforces the
  // cap independently). Empirically, pages 4+ on industrial POs are pure
  // Standard Terms & Conditions boilerplate — never useful for extraction.
  const MAX_EXTRACT_PAGES = 3;

  // PDFs at or below this length go through the vision path; longer ones
  // go through the server-side text path. Same value as the page cap so
  // every PO is treated consistently — short PDFs render every page; long
  // PDFs send the first MAX_EXTRACT_PAGES pages of text.
  const SHORT_PDF_PAGES = MAX_EXTRACT_PAGES;

  // Pages per chunk for the vision API. Gemini happily takes ~30
  // images/request; Anthropic via OpenRouter caps at 20 per message and
  // prefers fewer for stability — so we go conservative there.
  const VISION_CHUNK_BY_PROVIDER = {
    google: 30,
    openrouter: 18,
  };

  // Pages per chunk on the long-text path. Caps response-token risk per call.
  const TEXT_CHUNK_PAGES = 50;

  // Per-call retry policy for transient errors (429, 5xx, network blips).
  const RETRY_ATTEMPTS = 2;
  const RETRY_BASE_MS = 1500;

  /**
   * Run the extraction pipeline on a file. Auto-falls-back to vision mode
   * for scanned PDFs and chunks long ones automatically. Never throws on
   * partial chunk failure — the result will have a `_warnings` array
   * instead.
   * @param {File} file
   * @param {{ onStage?: (stage: string, label?: string) => void }} opts
   */
  async function extractPO(file, { onStage } = {}) {
    onStage?.('parsing', 'Reading document');
    const pageCount = await window.App.pdfParser.getPdfPageCount(file);

    const model = window.App.config.getModel();
    const provider = window.App.config.providerForModel(model);
    const apiKeys = window.App.config.keysForProvider(provider);
    const client = provider === 'google' ? window.App.gemini : window.App.openrouter;
    if (!client) throw new Error(`Provider "${provider}" client not loaded.`);

    const warnings = [];
    let raw;
    let method;

    if (pageCount <= SHORT_PDF_PAGES) {
      // ── VISION PATH ─────────────────────────────────────────────
      // Render every page (up to MAX_EXTRACT_PAGES) to PNG and let the
      // LLM read the rendered page. Sidesteps column flattening AND
      // overlaid template text in one shot — the model only sees what
      // is actually rendered.
      method = 'vision';
      onStage?.('extracting',
        `Short PDF (${pageCount} page${pageCount === 1 ? '' : 's'}) — extracting with vision model`);
      const { images } = await window.App.pdfParser.renderPagesToImages(file, {
        maxPages: MAX_EXTRACT_PAGES,
      });
      raw = await _callWithRetry(
        () => client.extractWithVision(images, { apiKeys, model }),
        { label: 'vision extraction' }
      );
    } else {
      // ── TEXT PATH (server-side pdfplumber) ──────────────────────
      // Server parses the first MAX_EXTRACT_PAGES pages with layout-
      // aware text + last-wins char dedup (handles overlaid placeholders
      // on Ariba-style templates). Pages 4+ on these PDFs are pure T&Cs.
      // We fall back to client-side pdf.js text if the server endpoint
      // is unreachable, and warn the rep that columns may be confused.
      method = 'text';
      onStage?.('extracting',
        `${pageCount}-page PDF — parsing first ${MAX_EXTRACT_PAGES} pages on server`);

      let pages;
      try {
        const parsed = await window.App.backend.parsePdfOnServer(file, MAX_EXTRACT_PAGES);
        pages = Array.isArray(parsed.pages) ? parsed.pages : [parsed.text || ''];
        if (parsed.truncated) {
          onStage?.('extracting',
            `Parsed pages 1–${parsed.page_count} of ${parsed.page_count_full} (rest is T&Cs)`);
        }
      } catch (err) {
        console.warn('Foundry: server parse failed, falling back to pdf.js text', err);
        warnings.push(
          'Server PDF parse was unavailable — used browser-side text extraction. ' +
          'Multi-column blocks may be confused; double-check addresses on this PO.'
        );
        const fallback = await window.App.pdfParser.readFile(file);
        const allPages = Array.isArray(fallback.pages) ? fallback.pages : [fallback.text || ''];
        // Apply the same cap on the fallback path.
        pages = allPages.slice(0, MAX_EXTRACT_PAGES);
      }

      const providerLabel = provider === 'google' ? 'Gemini' : 'Claude/GPT';
      if (pages.length <= TEXT_CHUNK_PAGES) {
        onStage?.('extracting', `Extracting fields with ${providerLabel}`);
        const fullText = pages
          .map((p, i) => `--- Page ${i + 1} ---\n${p}`)
          .join('\n\n');
        raw = await _callWithRetry(
          () => client.extractWithLLM(fullText, { apiKeys, model }),
          { label: 'text extraction' }
        );
      } else {
        const { merged, failed } = await _extractTextChunked(
          pages, client, { apiKeys, model, onStage, providerLabel }
        );
        raw = merged;
        if (failed.length) {
          warnings.push(
            `${failed.length} of ${Math.ceil(pages.length / TEXT_CHUNK_PAGES)} page-range chunks didn't extract: ` +
            failed.map((r) => `pages ${r.start}–${r.end}`).join(', ') +
            '. Line items from those pages may be missing.'
          );
        }
      }
    }

    onStage?.('validating', 'Validating');
    const normalized = normalize(raw);
    normalized.extraction_method = method;
    if (warnings.length) normalized._warnings = warnings;
    return normalized;
  }

  // ----------------------------------------------------------------------
  // Chunked extractors
  // ----------------------------------------------------------------------

  /**
   * Render pages in batches of `chunkSize`, call extractWithVision on each
   * batch, merge results. Returns `{ merged, failed }` — `failed` is an
   * array of `{start, end}` ranges that didn't extract so the caller can
   * warn the user. Throws only if ALL chunks failed.
   */
  async function _extractVisionChunked(file, totalPages, chunkSize, client, { apiKeys, model, onStage }) {
    const ranges = [];
    for (let start = 1; start <= totalPages; start += chunkSize) {
      ranges.push({ start, end: Math.min(start + chunkSize - 1, totalPages) });
    }
    onStage?.('extracting', `Large scanned PDF (${totalPages} pages) — processing in ${ranges.length} chunks of up to ${chunkSize}`);

    const parts = [];
    const failed = [];
    for (let i = 0; i < ranges.length; i++) {
      const { start, end } = ranges[i];
      onStage?.('extracting', `Chunk ${i + 1}/${ranges.length} — pages ${start}-${end} of ${totalPages}`);
      try {
        const { images } = await window.App.pdfParser.renderPagesToImages(file, {
          startPage: start, endPage: end, maxPages: chunkSize,
        });
        const part = await _callWithRetry(
          () => client.extractWithVision(images, { apiKeys, model }),
          { label: `vision chunk ${i + 1}/${ranges.length}` }
        );
        parts.push(part);
      } catch (err) {
        console.warn(`Foundry: vision chunk ${i + 1} (pages ${start}-${end}) failed after retry:`, err);
        failed.push({ start, end });
      }
    }
    if (parts.length === 0) {
      throw new Error('All vision chunks failed — try a different model or re-upload the PDF.');
    }
    return { merged: _mergeChunkedResults(parts), failed };
  }

  /**
   * Slice `pages[]` into batches of ~TEXT_CHUNK_PAGES pages, call
   * extractWithLLM on each batch, merge. Mirrors the vision chunker.
   */
  async function _extractTextChunked(pages, client, { apiKeys, model, onStage, providerLabel }) {
    const total = pages.length;
    const ranges = [];
    for (let start = 0; start < total; start += TEXT_CHUNK_PAGES) {
      ranges.push({ start, end: Math.min(start + TEXT_CHUNK_PAGES, total) });
    }
    onStage?.('extracting', `Large document (${total} pages) — processing in ${ranges.length} chunks with ${providerLabel}`);

    const parts = [];
    const failed = [];
    for (let i = 0; i < ranges.length; i++) {
      const { start, end } = ranges[i];
      // 1-indexed page numbers for the user-facing message; pages[start..end-1] for the slice.
      onStage?.('extracting', `Chunk ${i + 1}/${ranges.length} — pages ${start + 1}-${end} of ${total}`);
      const chunkText = pages
        .slice(start, end)
        .map((p, idx) => `--- Page ${start + idx + 1} ---\n${p}`)
        .join('\n\n');
      try {
        const part = await _callWithRetry(
          () => client.extractWithLLM(chunkText, { apiKeys, model }),
          { label: `text chunk ${i + 1}/${ranges.length}` }
        );
        parts.push(part);
      } catch (err) {
        console.warn(`Foundry: text chunk ${i + 1} (pages ${start + 1}-${end}) failed after retry:`, err);
        // 1-indexed for the user-visible warning
        failed.push({ start: start + 1, end });
      }
    }
    if (parts.length === 0) {
      throw new Error('All text chunks failed — try a different model or re-upload the PDF.');
    }
    return { merged: _mergeChunkedResults(parts), failed };
  }

  // ----------------------------------------------------------------------
  // Retry + merge helpers
  // ----------------------------------------------------------------------

  /**
   * Run an async fn with up to RETRY_ATTEMPTS tries, backing off on
   * transient errors (rate limits, 5xx, network). Permanent errors
   * (auth, validation, bad JSON) abort immediately.
   */
  async function _callWithRetry(fn, { label = 'call', attempts = RETRY_ATTEMPTS } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = (err?.message || '').toLowerCase();
        const transient =
          msg.includes('429') ||
          msg.includes('rate') || msg.includes('quota') ||
          msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') ||
          msg.includes('network') || msg.includes('timeout') ||
          msg.includes('failed to fetch') || msg.includes('connection') ||
          msg.includes('overloaded');
        if (attempt < attempts && transient) {
          const wait = RETRY_BASE_MS * attempt;
          console.warn(`Foundry: ${label} attempt ${attempt} failed (${err.message}); retrying in ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  /** Header fields where we want to take the first non-empty value across chunks. */
  const HEADER_FIELDS = [
    'po_number', 'po_date', 'revision',
    'customer', 'customer_address',
    'supplier', 'supplier_address',
    'bill_to', 'ship_to',
    'payment_terms',
    'buyer', 'buyer_email',
    'currency',
  ];

  function _mergeChunkedResults(parts) {
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];

    const merged = {};
    // Header: prefer the first chunk's value; fill blanks from later chunks.
    for (const key of HEADER_FIELDS) {
      for (const p of parts) {
        if (p && p[key] && String(p[key]).trim() !== '') {
          merged[key] = p[key];
          break;
        }
      }
    }
    // Line items: concatenate in chunk order, renumber sequentially.
    merged.line_items = parts
      .flatMap((p) => (Array.isArray(p?.line_items) ? p.line_items : []))
      .map((li, idx) => ({ ...li, line: idx + 1 }));
    // Total: recompute from merged line items — per-chunk totals are partial.
    merged.total = merged.line_items.reduce((sum, li) => {
      const amt = Number(li.amount);
      if (Number.isFinite(amt) && amt > 0) return sum + amt;
      const qty = Number(li.quantity) || 0;
      const px = Number(li.unit_price) || 0;
      return sum + qty * px;
    }, 0);
    return merged;
  }

  // ----------------------------------------------------------------------
  // Normalize raw LLM output into our PO schema
  // ----------------------------------------------------------------------

  function normalize(data) {
    const items = Array.isArray(data?.line_items) ? data.line_items : [];

    const normalized_items = items.map((it, i) => {
      const quantity = Number(it.quantity) || 0;
      const unit_price = Number(it.unit_price) || 0;
      const amount = Number(it.amount);
      return {
        line: Number(it.line) || i + 1,
        customer_part: String(it.customer_part || '').trim(),
        vendor_part: String(it.vendor_part || '').trim(),
        description: String(it.description || '').trim(),
        quantity,
        uom: String(it.uom || 'EA').trim(),
        unit_price,
        amount: Number.isFinite(amount) && amount > 0 ? amount : +(quantity * unit_price).toFixed(2),
        required_date: normDate(it.required_date),
      };
    });

    const computedTotal = normalized_items.reduce((sum, it) => sum + (it.amount || 0), 0);
    const reportedTotal = Number(data?.total);
    const total = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : +computedTotal.toFixed(2);

    return {
      po_number: String(data?.po_number || '').trim(),
      po_date: normDate(data?.po_date),
      revision: String(data?.revision || '').trim(),
      customer: String(data?.customer || '').trim(),
      customer_address: String(data?.customer_address || '').trim(),
      supplier: String(data?.supplier || '').trim(),
      supplier_address: String(data?.supplier_address || '').trim(),
      bill_to: String(data?.bill_to || '').trim(),
      ship_to: String(data?.ship_to || '').trim(),
      payment_terms: String(data?.payment_terms || '').trim(),
      buyer: String(data?.buyer || '').trim(),
      buyer_email: String(data?.buyer_email || '').trim(),
      currency: String(data?.currency || 'USD').trim(),
      line_items: normalized_items,
      total,
      confidence: { high: [], medium: [], low: [] },
    };
  }

  function normDate(input) {
    if (!input) return '';
    const s = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m1) {
      let [, mm, dd, yy] = m1;
      if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
      return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    }
    return s;
  }

  window.App = window.App || {};
  window.App.api = { extractPO };
})();
