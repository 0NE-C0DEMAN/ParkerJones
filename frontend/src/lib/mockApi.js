/* ==========================================================================
   extractor (window.App.api) — Real PO extraction pipeline.
     1. parse PDF → text via pdf.js
     2a. if text looks complete → text-based LLM extraction (cheap, fast)
     2b. if PDF is scanned (no text) → render pages to PNG → vision LLM
         For PDFs longer than VISION_CHUNK_SIZE (provider-dependent), render
         in chunks, extract each chunk separately, then merge the results.
     3. normalize / coerce types and ensure schema shape

   Filename `mockApi.js` is preserved for backward compat with the existing
   index.html script tag.
   ========================================================================== */
(() => {
  'use strict';

  // Number of pages per vision-API call. Gemini happily takes 30+
  // images/request; Anthropic via OpenRouter caps at 20 per message and
  // prefers fewer for stability — so we go conservative there.
  const VISION_CHUNK_BY_PROVIDER = {
    google: 30,
    openrouter: 18,
  };

  /**
   * Run the extraction pipeline on a file. Auto-falls-back to vision mode
   * for scanned PDFs and chunks long ones automatically.
   * @param {File} file
   * @param {{ onStage?: (stage: string, label?: string) => void }} opts
   */
  async function extractPO(file, { onStage } = {}) {
    onStage?.('parsing', 'Reading document');
    const parsed = await window.App.pdfParser.readFile(file);

    // Pick the right provider based on the chosen model, then narrow the
    // key list to only keys that match that provider (so a Gemini model
    // doesn't try an OpenRouter key and vice-versa).
    const model = window.App.config.getModel();
    const provider = window.App.config.providerForModel(model);
    const apiKeys = window.App.config.keysForProvider(provider);
    const client = provider === 'google' ? window.App.gemini : window.App.openrouter;
    if (!client) throw new Error(`Provider "${provider}" client not loaded.`);

    let raw;
    let method = 'text';

    if (window.App.pdfParser.isLikelyScanned(parsed)) {
      method = 'vision';
      const totalPages = parsed.pageCount || await window.App.pdfParser.getPdfPageCount(file);
      const chunkSize = VISION_CHUNK_BY_PROVIDER[provider] || 20;

      if (totalPages <= chunkSize) {
        // Single-call vision path (most scanned POs).
        onStage?.('extracting', `Scanned PDF (${totalPages} page${totalPages === 1 ? '' : 's'}) — extracting with vision model`);
        const { images } = await window.App.pdfParser.renderPagesToImages(file, { maxPages: chunkSize });
        raw = await client.extractWithVision(images, { apiKeys, model });
      } else {
        // Chunked vision path for long scanned PDFs.
        raw = await _extractVisionChunked(file, totalPages, chunkSize, client, { apiKeys, model, onStage });
      }
    } else {
      onStage?.('extracting', `Extracting fields with ${provider === 'google' ? 'Gemini' : 'Claude/GPT'}`);
      raw = await client.extractWithLLM(parsed.text, { apiKeys, model });
    }

    onStage?.('validating', 'Validating');
    const normalized = normalize(raw);
    normalized.extraction_method = method;
    return normalized;
  }

  /**
   * Render pages in batches of `chunkSize`, call extractWithVision on each
   * batch, merge results. Header-level fields come from the first chunk
   * that filled them in; line items are concatenated across all chunks
   * (lower-numbered chunks first); totals are recomputed from line items.
   */
  async function _extractVisionChunked(file, totalPages, chunkSize, client, { apiKeys, model, onStage }) {
    const ranges = [];
    for (let start = 1; start <= totalPages; start += chunkSize) {
      ranges.push({ start, end: Math.min(start + chunkSize - 1, totalPages) });
    }
    onStage?.('extracting', `Large scanned PDF (${totalPages} pages) — processing in ${ranges.length} chunks of up to ${chunkSize}`);

    const parts = [];
    for (let i = 0; i < ranges.length; i++) {
      const { start, end } = ranges[i];
      onStage?.(
        'extracting',
        `Chunk ${i + 1}/${ranges.length} — pages ${start}-${end} of ${totalPages}`
      );
      const { images } = await window.App.pdfParser.renderPagesToImages(file, {
        startPage: start,
        endPage: end,
        maxPages: chunkSize,
      });
      try {
        const part = await client.extractWithVision(images, { apiKeys, model });
        parts.push(part);
      } catch (err) {
        // Chunk failure shouldn't abort the whole PO — log + keep going so
        // the user at least gets the line items from the chunks that worked.
        console.warn(`Foundry: chunk ${i + 1} (pages ${start}-${end}) failed:`, err);
      }
    }

    if (parts.length === 0) {
      throw new Error('All vision chunks failed — try a different model or re-upload the PDF.');
    }
    return _mergeChunkedResults(parts);
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
    // Line items: concatenate in chunk order.
    merged.line_items = parts.flatMap((p) => Array.isArray(p?.line_items) ? p.line_items : []);
    // Renumber sequentially so duplicate line: 1 from each chunk doesn't
    // confuse the reviewer.
    merged.line_items = merged.line_items.map((li, idx) => ({ ...li, line: idx + 1 }));
    // Total: recompute from the line items (the per-chunk totals are
    // partial sums; the model has no way to know the whole picture).
    merged.total = merged.line_items.reduce((sum, li) => {
      const amt = Number(li.amount);
      if (Number.isFinite(amt) && amt > 0) return sum + amt;
      const qty = Number(li.quantity) || 0;
      const px = Number(li.unit_price) || 0;
      return sum + qty * px;
    }, 0);
    return merged;
  }

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
