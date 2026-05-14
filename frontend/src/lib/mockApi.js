/* ==========================================================================
   extractor (window.App.api) — PO extraction pipeline.

   ROUTING — deterministic, binary:
     • pdfplumber returns ANY text  → HYBRID path (text + page images)
     • pdfplumber returns no text   → VISION path (page images only)

   For MACHINE-READABLE PDFs (almost everything Parker handles):
     1. Get page count of the PDF (cheap, client-side).
     2. POST the PDF to /api/extract/parse — server parses the first
        MAX_EXTRACT_PAGES pages with pdfplumber.extract_text(layout=True)
        plus a last-wins char dedup pass (handles overlaid template text
        on Ariba-style PDFs).
     3. Render the same pages as PNG via pdf.js at scale 2.0.
     4. Send BOTH text and images to gemini-2.5-flash in one call. The
        model uses text for clean character values (no OCR errors) and
        the images for spatial layout grounding (which block is in which
        column on Ariba two-column headers, etc.).

   For SCANNED / image-only PDFs:
     1. pdfplumber returns empty strings for every page.
     2. Render the first MAX_EXTRACT_PAGES pages as PNG via pdf.js,
        send to gemini-2.5-flash vision.

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
   * Run the extraction pipeline on a file.
   *
   * Routing: machine-readable PDFs go through the server-side pdfplumber
   * text path; scanned/image-only PDFs (low text density after parsing)
   * automatically fall through to the vision path on gemini-2.5-flash.
   *
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

    // --- 1. Try server-side text extraction (pdfplumber) first ---
    //
    // Falls back to client-side pdf.js text if the server is unreachable.
    let pages;
    let pageCountFull = pageCount;
    let parsedPageCount = Math.min(pageCount, MAX_EXTRACT_PAGES);
    try {
      const parsed = await window.App.backend.parsePdfOnServer(file, MAX_EXTRACT_PAGES);
      pages = Array.isArray(parsed.pages) ? parsed.pages : [parsed.text || ''];
      pageCountFull = parsed.page_count_full ?? pageCount;
      parsedPageCount = parsed.page_count ?? pages.length;
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

    // --- 2. Decide: text path or vision path? ---
    //
    // Binary check: if pdfplumber returns ANY text at all, the PDF has a
    // real text layer and we use the text path. If it returns nothing
    // (all pages empty after trim), it's a scan and we use vision.
    // No threshold, no chars-per-page math.
    const totalTextChars = pages.reduce((sum, p) => sum + (p || '').trim().length, 0);
    const isScanned = totalTextChars === 0;

    let raw;
    let extractionMethod = 'text';

    if (isScanned) {
      // ---- VISION PATH ----
      // Force gemini-2.5-flash for vision — Flash-Lite is too weak at OCR.
      // For OpenRouter the rep's selected model carries through (Claude
      // Sonnet / Haiku / GPT — all vision-capable).
      onStage?.('extracting',
        `Scanned PDF (no text layer) — using vision on first ${MAX_EXTRACT_PAGES} page${MAX_EXTRACT_PAGES === 1 ? '' : 's'}`);

      let rendered;
      try {
        rendered = await window.App.pdfParser.renderPagesToImages(file, {
          maxPages: MAX_EXTRACT_PAGES,
          scale: 2.0,        // ~144 DPI — sharp enough for fine print
        });
      } catch (err) {
        throw new Error(`Couldn't render PDF pages for vision: ${err.message}`);
      }
      if (!rendered.images || rendered.images.length === 0) {
        throw new Error('Could not render any pages from this PDF.');
      }

      raw = await _callWithRetry(
        () => client.extractWithVision(rendered.images, { apiKeys, model }),
        { label: 'vision extraction' }
      );
      extractionMethod = 'vision';
      warnings.push(
        `This PDF appears to be scanned (no extractable text layer). ` +
        `Vision extraction was used on pages 1–${rendered.images.length}; ` +
        `please double-check totals and part numbers.`
      );
    } else {
      // ---- HYBRID PATH (text + images in one call) ----
      // Even though we have a clean text layer, we also render the first
      // few pages as images and ship both views to Gemini in a single
      // call. The model uses text for clean character values and the
      // image for spatial layout (column boundaries, address-block
      // ownership). On Ariba layouts the image disambiguates the
      // supplier-vs-ship-to columns; the text guarantees clean values.
      const fullText = pages
        .map((p, i) => `--- Page ${i + 1} ---\n${p}`)
        .join('\n\n');

      if (parsedPageCount < pageCountFull) {
        onStage?.('extracting',
          `Parsed pages 1–${parsedPageCount} of ${pageCountFull} (rest is T&Cs) — rendering pages for layout grounding`);
      } else {
        onStage?.('extracting',
          `Rendering ${parsedPageCount} page${parsedPageCount === 1 ? '' : 's'} for layout grounding`);
      }

      let pageImages = [];
      try {
        const rendered = await window.App.pdfParser.renderPagesToImages(file, {
          maxPages: MAX_EXTRACT_PAGES,
          scale: 2.0,
        });
        pageImages = rendered.images || [];
      } catch (err) {
        console.warn('Foundry: page rendering failed, falling back to text-only', err);
        warnings.push(
          'Could not render page images for hybrid extraction — used text-only. ' +
          'Column-heavy layouts may need a manual check.'
        );
      }

      onStage?.('extracting',
        `Extracting fields with ${provider === 'google' ? 'Gemini 2.5 Flash' : 'Claude/GPT'} (text + image)`);

      // If we have images, use hybrid; otherwise gracefully degrade to text-only.
      const useHybrid = pageImages.length > 0 && typeof client.extractWithHybrid === 'function';
      raw = await _callWithRetry(
        () => useHybrid
          ? client.extractWithHybrid(fullText, pageImages, { apiKeys, model })
          : client.extractWithLLM(fullText, { apiKeys, model }),
        { label: useHybrid ? 'hybrid extraction' : 'text extraction' }
      );
      extractionMethod = useHybrid ? 'hybrid' : 'text';
    }

    onStage?.('validating', 'Validating');
    const normalized = normalize(raw);
    normalized.extraction_method = extractionMethod;

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

  // Common UOMs that get truncated to a single character by narrow column
  // widths in pdfplumber's layout-preserving text extraction. When the LLM
  // returns the truncated form, expand it back. Order matters — we only
  // expand single-character or two-character codes.
  const UOM_TRUNCATIONS = {
    E: 'EA',    // EACH
    B: 'BX',    // BOX
    C: 'CS',    // CASE
    L: 'LB',    // LB / LT — ambiguous, prefer LB; rep can edit
    K: 'KG',
    F: 'FT',
    R: 'RL',    // ROLL
    P: 'PK',    // PACK
    M: 'M',     // already canonical
  };

  function normUom(raw) {
    const u = String(raw || '').trim().toUpperCase();
    if (!u) return 'EA';
    if (u.length === 1 && UOM_TRUNCATIONS[u]) return UOM_TRUNCATIONS[u];
    return u;
  }

  function normalize(data) {
    const items = Array.isArray(data?.line_items) ? data.line_items : [];

    const normalized_items = items.map((it, i) => {
      let quantity = Number(it.quantity) || 0;
      let unit_price = Number(it.unit_price) || 0;
      let amount = Number(it.amount);
      if (!Number.isFinite(amount) || amount <= 0) amount = 0;

      // Recover any one missing value when we have the other two.
      // The LLM occasionally misses one of (qty, price, amount) when the
      // line layout is unusual — recover from the other two rather than
      // saving a zero.
      if (quantity > 0 && unit_price > 0 && amount === 0) {
        amount = +(quantity * unit_price).toFixed(2);
      } else if (amount > 0 && unit_price > 0 && quantity === 0) {
        quantity = +(amount / unit_price).toFixed(4);
      } else if (amount > 0 && quantity > 0 && unit_price === 0) {
        unit_price = +(amount / quantity).toFixed(4);
      }

      // Description is the SINGLE field for all part identifiers + product
      // text. If the LLM (or older data) leaked anything into customer_part
      // or vendor_part, fold those values back into description and clear
      // the split fields. The UI never shows them as separate columns;
      // one source of truth from extraction onward.
      let description = String(it.description || '').trim();
      const cp = String(it.customer_part || '').trim();
      const vp = String(it.vendor_part || '').trim();
      const prepend = [];
      if (cp && !description.includes(cp)) prepend.push(cp);
      if (vp && vp !== cp && !description.includes(vp)) prepend.push(vp);
      if (prepend.length) {
        description = (prepend.join(' ') + (description ? ' ' + description : '')).trim();
      }

      return {
        line: Number(it.line) || i + 1,
        customer_part: '',
        vendor_part: '',
        description,
        quantity,
        uom: normUom(it.uom),
        unit_price,
        amount,
        required_date: normDate(it.required_date),
        notes: String(it.notes || '').trim(),
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
      supplier_code: String(data?.supplier_code || '').trim(),
      supplier_address: String(data?.supplier_address || '').trim(),
      bill_to: String(data?.bill_to || '').trim(),
      ship_to: String(data?.ship_to || '').trim(),
      payment_terms: String(data?.payment_terms || '').trim(),
      freight_terms: String(data?.freight_terms || '').trim(),
      ship_via: String(data?.ship_via || '').trim(),
      fob_terms: String(data?.fob_terms || '').trim(),
      buyer: String(data?.buyer || '').trim(),
      buyer_email: String(data?.buyer_email || '').trim(),
      buyer_phone: String(data?.buyer_phone || '').trim(),
      receiving_contact: String(data?.receiving_contact || '').trim(),
      receiving_contact_phone: String(data?.receiving_contact_phone || '').trim(),
      quote_number: String(data?.quote_number || '').trim(),
      contract_number: String(data?.contract_number || '').trim(),
      currency: String(data?.currency || 'USD').trim(),
      line_items: normalized_items,
      total,
      notes: String(data?.notes || '').trim(),
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
