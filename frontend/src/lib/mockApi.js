/* ==========================================================================
   extractor (window.App.api) — PO extraction pipeline.

   ONE path for every PO — digital, scanned, or handwritten:
     1. Get page count (cheap, client-side via pdf.js).
     2. Render the first MAX_EXTRACT_PAGES pages to PNG via pdf.js at scale 2.0.
     3. Send the images to the vision model (Gemma 4 by default). The model
        reads the rendered page directly — clean character values AND spatial
        layout (Ariba two-column headers, handwritten blocks, etc.) in one go.

   No server-side pdfplumber step: a text layer is absent on scans and useless
   on handwriting, and the vision model reads a rendered page at least as well
   as a parsed text layer. Gemma's chain-of-thought is stripped at the client
   (gemini.js filters `thought` parts) so the output is always clean JSON.

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

  /** Friendly model name for status messages (falls back to the raw id). */
  function _modelLabel(modelId) {
    const list = (window.App.config && window.App.config.AVAILABLE_MODELS) || [];
    const m = list.find((x) => x.id === modelId);
    return m ? m.label : modelId;
  }

  /**
   * Run the extraction pipeline on a file — VISION ONLY, PAGE-PARALLEL.
   *
   * Every PO (digital, scanned, or handwritten) is rendered to page images
   * client-side and read directly by the vision model. There is no
   * server-side pdfplumber step: a text layer is absent on scans and useless
   * on handwriting, and the model reads a rendered page at least as well as a
   * parsed text layer while also seeing the spatial layout.
   *
   * For multi-page POs each page is read in its OWN concurrent request and the
   * per-page results are merged (see _mergePageResults). Wall-clock is the
   * single slowest page rather than the sum of all pages, and each page gets
   * the model's full attention. The prompt is page-aware: it pulls header
   * fields from whichever page shows them and returns line_items:[] for
   * T&C / boilerplate pages, so the merge just concatenates line items and
   * takes the first non-empty header value.
   *
   * @param {File} file
   * @param {{ onStage?: (stage: string, label?: string) => void }} opts
   */
  async function extractPO(file, { onStage } = {}) {
    onStage?.('parsing', 'Reading document');
    const pageCountFull = await window.App.pdfParser.getPdfPageCount(file);

    const model = window.App.config.getModel();
    const provider = window.App.config.providerForModel(model);
    const apiKeys = window.App.config.keysForProvider(provider);
    const client = provider === 'google' ? window.App.gemini : window.App.openrouter;
    if (!client) throw new Error(`Provider "${provider}" client not loaded.`);
    if (typeof client.extractWithVision !== 'function') {
      throw new Error(`Model "${model}" doesn't support vision extraction. Pick a vision-capable model in Settings.`);
    }

    const warnings = [];

    // --- 1. Render the first N pages to images (pdf.js, client-side) ---
    let rendered;
    try {
      rendered = await window.App.pdfParser.renderPagesToImages(file, {
        maxPages: MAX_EXTRACT_PAGES,
        scale: 2.0,        // ~144 DPI — sharp enough for fine print + handwriting
      });
    } catch (err) {
      throw new Error(`Couldn't render PDF pages for extraction: ${err.message}`);
    }
    const images = rendered.images || [];
    if (images.length === 0) throw new Error('Could not render any pages from this PDF.');
    const parsedPageCount = images.length;

    // --- 2. Vision extraction — one concurrent call PER PAGE, then merge ---
    let raw;
    if (images.length === 1) {
      onStage?.('extracting', `Reading 1 page with ${_modelLabel(model)} (vision)`);
      raw = await _callWithRetry(
        () => client.extractWithVision(images, { apiKeys, model }),
        { label: 'vision extraction' }
      );
    } else {
      onStage?.('extracting',
        `Reading ${parsedPageCount} pages in parallel with ${_modelLabel(model)} (vision)`);
      const settled = await Promise.allSettled(
        images.map((img, i) => _callWithRetry(
          () => client.extractWithVision([img], { apiKeys, model }),
          { label: `vision page ${i + 1}` }
        ))
      );
      const pageResults = settled.map((s) => (s.status === 'fulfilled' ? s.value : null));
      if (pageResults.every((r) => r === null)) {
        const firstErr = settled.find((s) => s.status === 'rejected');
        throw new Error(firstErr?.reason?.message || 'Vision extraction failed on every page.');
      }
      const failedPages = settled
        .map((s, i) => (s.status === 'rejected' ? i + 1 : null))
        .filter((x) => x !== null);
      if (failedPages.length) {
        warnings.push(
          `Page${failedPages.length === 1 ? '' : 's'} ${failedPages.join(', ')} couldn't be read ` +
          `(the rest were). Double-check for any missing line items.`
        );
      }
      raw = _mergePageResults(pageResults);
    }

    onStage?.('validating', 'Validating');
    const normalized = normalize(raw);
    normalized.extraction_method = 'vision';

    // If we trimmed pages, note that the rep should glance past the last
    // parsed page in their copy of the PDF in case a line item lives there.
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

  // Header fields that belong to the PO as a whole (not per line). On a merge
  // we take the FIRST non-empty value in page order — the header normally sits
  // on page 1, and a continuation page legitimately leaves these blank.
  const _MERGE_SCALARS = [
    'po_number', 'po_date', 'revision', 'customer', 'customer_address', 'supplier',
    'supplier_code', 'supplier_address', 'bill_to', 'ship_to', 'payment_terms',
    'freight_terms', 'ship_via', 'fob_terms', 'buyer', 'buyer_email', 'buyer_phone',
    'receiving_contact', 'receiving_contact_phone', 'quote_number', 'contract_number',
    'currency',
  ];

  /**
   * Merge per-page extraction results (in page order) into one PO object.
   *   - scalar header fields → first non-empty value across pages
   *   - line_items           → concatenated in page order (re-sequenced later)
   *   - total                → max(largest reported total, sum of line amounts);
   *                            handles both an explicit grand total and the case
   *                            where line items span pages with only subtotals
   *   - notes                → unique non-empty values, joined
   */
  function _mergePageResults(pageResults) {
    const pages = pageResults.filter(Boolean);
    if (pages.length === 1) return pages[0];

    const merged = {};
    for (const f of _MERGE_SCALARS) {
      let val = '';
      for (const p of pages) {
        const v = p && p[f] != null ? String(p[f]).trim() : '';
        if (v) { val = p[f]; break; }
      }
      merged[f] = val;
    }

    const lines = [];
    for (const p of pages) {
      if (Array.isArray(p.line_items)) lines.push(...p.line_items);
    }
    merged.line_items = lines;

    let maxReported = 0;
    for (const p of pages) {
      const t = Number(p.total) || 0;
      if (t > maxReported) maxReported = t;
    }
    const lineSum = lines.reduce((s, it) => s + (Number(it && it.amount) || 0), 0);
    merged.total = Math.max(maxReported, +lineSum.toFixed(2));

    const notes = [];
    for (const p of pages) {
      const n = p.notes != null ? String(p.notes).trim() : '';
      if (n && !notes.includes(n)) notes.push(n);
    }
    merged.notes = notes.join('\n');

    return merged;
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

  // Common UOMs that can come back truncated to a single character when the
  // unit sits in a cramped column the vision model reads tightly. When the
  // LLM returns the truncated form, expand it back. Order matters — we only
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

  // ----- value normalization is the LLM's job, not ours -----
  //
  // The prompt makes Gemma emit ready-to-store canonical values directly:
  // dates as YYYY-MM-DD, numbers as plain decimals, qty x unit_price = amount,
  // the grand total, uppercase UOM, phone/email/address shapes. We do NOT
  // re-format those values here — the prompt is the single source of truth.
  // What normalize() does below is only the things that are NOT formatting:
  //   - type-coercion: Number()/String() so the UI + DB get the right types
  //   - recovery fallback: if the model still left a qty/price/amount at 0,
  //     derive it from the other two (and sum lines if total is missing) so a
  //     stray miss doesn't get saved as a zero
  //   - normDate / normUom: pass-through for canonical values; they only ACT
  //     on a non-canonical leftover (a rare model miss, or an edit-form date
  //     typed as MM/DD/YYYY) so the date input / UOM cell never breaks

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

    // Trim-only on string fields — formatting rules now live in the prompt.
    const s = (v) => String(v ?? '').trim();
    return {
      po_number: s(data?.po_number),
      po_date: normDate(data?.po_date),
      revision: s(data?.revision),
      customer: s(data?.customer),
      customer_address: s(data?.customer_address),
      supplier: s(data?.supplier),
      supplier_code: s(data?.supplier_code),
      supplier_address: s(data?.supplier_address),
      bill_to: s(data?.bill_to),
      ship_to: s(data?.ship_to),
      payment_terms: s(data?.payment_terms),
      freight_terms: s(data?.freight_terms),
      ship_via: s(data?.ship_via),
      fob_terms: s(data?.fob_terms),
      buyer: s(data?.buyer),
      buyer_email: s(data?.buyer_email),
      buyer_phone: s(data?.buyer_phone),
      receiving_contact: s(data?.receiving_contact),
      receiving_contact_phone: s(data?.receiving_contact_phone),
      quote_number: s(data?.quote_number),
      contract_number: s(data?.contract_number),
      currency: s(data?.currency) || 'USD',
      line_items: normalized_items,
      total,
      notes: s(data?.notes),
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
