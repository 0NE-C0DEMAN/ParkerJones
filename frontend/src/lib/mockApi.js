/* ==========================================================================
   extractor (window.App.api) — PO extraction pipeline.

   STRATEGY: text via server-side pdfplumber.

     1. Get page count of the PDF (cheap, client-side).
     2. POST the PDF to /api/extract/parse — server parses the first
        MAX_EXTRACT_PAGES pages with pdfplumber.extract_text(layout=True)
        plus a last-wins char dedup pass (handles overlaid template text
        on Ariba-style PDFs).
     3. Send the resulting text to the LLM (Gemini text endpoint).
     4. Normalize and return.

   Vision was tried earlier but Gemini 2.5 Flash-Lite was returning empty
   extractions for our industrial POs. The pdfplumber + dedup + improved
   prompt combo is reliable: layout columns are preserved by the parser,
   overlaid placeholder text is stripped, and the text token cost is
   roughly 10× lower than vision.

   Pages 4+ on industrial PO templates are pure Standard Terms & Conditions
   boilerplate — never useful for extraction — so we cap at MAX_EXTRACT_PAGES.

   Filename `mockApi.js` is preserved for backward compat with the existing
   <script> tag.
   ========================================================================== */
(() => {
  'use strict';

  // Hard cap on the number of pages we ever ship to the LLM. Pages 4+ on
  // industrial PO templates are T&Cs boilerplate. The server enforces the
  // same cap independently.
  const MAX_EXTRACT_PAGES = 3;

  // Per-call retry policy for transient errors (429, 5xx, network blips).
  const RETRY_ATTEMPTS = 2;
  const RETRY_BASE_MS = 1500;

  /**
   * Run the extraction pipeline on a file. Server-side pdfplumber → text LLM.
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

    onStage?.('extracting',
      pageCount > MAX_EXTRACT_PAGES
        ? `${pageCount}-page PDF — parsing first ${MAX_EXTRACT_PAGES} pages on server`
        : `${pageCount} page${pageCount === 1 ? '' : 's'} — parsing on server`);

    const warnings = [];

    // Server parses with pdfplumber layout=True + last-wins char dedup.
    // Falls back to client-side pdf.js text if the server is unreachable.
    let pages;
    let pageCountFull = pageCount;
    let parsedPageCount = Math.min(pageCount, MAX_EXTRACT_PAGES);
    try {
      const parsed = await window.App.backend.parsePdfOnServer(file, MAX_EXTRACT_PAGES);
      pages = Array.isArray(parsed.pages) ? parsed.pages : [parsed.text || ''];
      pageCountFull = parsed.page_count_full ?? pageCount;
      parsedPageCount = parsed.page_count ?? pages.length;
      if (parsed.truncated) {
        onStage?.('extracting',
          `Parsed pages 1–${parsedPageCount} of ${pageCountFull} (rest is T&Cs) — extracting fields`);
      } else {
        onStage?.('extracting',
          `Extracting fields with ${provider === 'google' ? 'Gemini' : 'Claude/GPT'}`);
      }
    } catch (err) {
      console.warn('Foundry: server parse failed, falling back to pdf.js text', err);
      warnings.push(
        'Server PDF parse was unavailable — used browser-side text extraction. ' +
        'Multi-column blocks may be confused; double-check addresses on this PO.'
      );
      const fallback = await window.App.pdfParser.readFile(file);
      const allPages = Array.isArray(fallback.pages) ? fallback.pages : [fallback.text || ''];
      pages = allPages.slice(0, MAX_EXTRACT_PAGES);
      parsedPageCount = pages.length;
    }

    const fullText = pages
      .map((p, i) => `--- Page ${i + 1} ---\n${p}`)
      .join('\n\n');

    const raw = await _callWithRetry(
      () => client.extractWithLLM(fullText, { apiKeys, model }),
      { label: 'text extraction' }
    );

    onStage?.('validating', 'Validating');
    const normalized = normalize(raw);
    normalized.extraction_method = 'text';

    // If we trimmed pages, note that the rep should glance past page 3
    // in their copy of the PDF in case a line item lives there.
    if (parsedPageCount < pageCountFull) {
      warnings.push(
        `Pages ${parsedPageCount + 1}–${pageCountFull} of ${pageCountFull} were skipped ` +
        `(assumed T&Cs / boilerplate). If a line item appears to be missing, ` +
        `re-upload just those pages as a separate PO.`
      );
    }
    if (warnings.length) normalized._warnings = warnings;
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
