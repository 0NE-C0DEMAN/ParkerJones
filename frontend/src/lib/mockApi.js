/* ==========================================================================
   extractor (window.App.api) — PO extraction pipeline.

   STRATEGY (vision-only, capped):
     For every PDF, render the first MAX_EXTRACT_PAGES pages to images and
     send them to the vision LLM. Pages 4+ on the industrial POs we've
     audited are pure Standard-Terms-&-Conditions boilerplate, so a 3-page
     cap covers the actual PO content (header + line items + any spillover)
     without wasting tokens on legalese.

   Why image-based instead of text-based:
     - No column flattening (pdf.js linearizes side-by-side columns).
     - No overlaid template text (Ariba PDFs draw "DEF Purchasing Company"
       under "APG Purchasing Company"; the rendered image only shows the
       value on top).
     - Same accuracy on numbers when paired with a precise prompt.

   The /api/extract/parse server endpoint and api.js parsePdfOnServer helper
   are intentionally retained — they're not in the hot path today, but
   they're useful for debugging and a possible future text-mode fallback.

   Filename `mockApi.js` is preserved for backward compat with the existing
   <script> tag.
   ========================================================================== */
(() => {
  'use strict';

  // Hard cap on the number of pages we ever ship to the LLM. Pages 4+ on
  // industrial PO templates are T&Cs boilerplate. Bump cautiously if you
  // ever start seeing line-item tables that legitimately spill past page 3.
  const MAX_EXTRACT_PAGES = 3;

  // Per-call retry policy for transient errors (429, 5xx, network blips).
  const RETRY_ATTEMPTS = 2;
  const RETRY_BASE_MS = 1500;

  /**
   * Run the extraction pipeline on a file. Always uses the vision path.
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

    const renderedPages = Math.min(pageCount, MAX_EXTRACT_PAGES);
    const stageMsg = pageCount <= MAX_EXTRACT_PAGES
      ? `${pageCount} page${pageCount === 1 ? '' : 's'} — extracting with vision model`
      : `${pageCount}-page PDF — extracting first ${MAX_EXTRACT_PAGES} pages with vision model (rest is T&Cs)`;
    onStage?.('extracting', stageMsg);

    const { images } = await window.App.pdfParser.renderPagesToImages(file, {
      maxPages: MAX_EXTRACT_PAGES,
    });
    if (!images || images.length === 0) {
      throw new Error('Could not render any pages from this PDF.');
    }

    const raw = await _callWithRetry(
      () => client.extractWithVision(images, { apiKeys, model }),
      { label: 'vision extraction' }
    );

    onStage?.('validating', 'Validating');
    const normalized = normalize(raw);
    normalized.extraction_method = 'vision';
    // If we trimmed pages, surface that so the rep knows to spot-check
    // whether anything important lived past page 3.
    if (renderedPages < pageCount) {
      normalized._warnings = [
        `Pages ${renderedPages + 1}–${pageCount} of ${pageCount} were skipped (assumed T&Cs / boilerplate). ` +
        `If a line item appears to be missing, re-upload just those pages as a separate PO.`,
      ];
    }
    return normalized;
  }

  // ----------------------------------------------------------------------
  // Retry helper — wraps every LLM call so transient blips don't fail
  // the whole extraction.
  // ----------------------------------------------------------------------
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
