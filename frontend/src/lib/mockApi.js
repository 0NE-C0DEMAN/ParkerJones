/* ==========================================================================
   extractor (window.App.api) — Real PO extraction pipeline.
     1. parse PDF → text via pdf.js
     2a. if text looks complete → text-based LLM extraction (cheap, fast)
     2b. if PDF is scanned (no text) → render pages to PNG → vision LLM
     3. normalize / coerce types and ensure schema shape

   Filename `mockApi.js` is preserved for backward compat with the existing
   index.html script tag.
   ========================================================================== */
(() => {
  'use strict';

  /**
   * Run the extraction pipeline on a file. Auto-falls-back to vision mode
   * for scanned PDFs.
   * @param {File} file
   * @param {{ onStage?: (stage: string, label?: string) => void }} opts
   */
  async function extractPO(file, { onStage } = {}) {
    onStage?.('parsing', 'Reading document');
    const parsed = await window.App.pdfParser.readFile(file);

    // Use the full key list so the client transparently falls back to
    // backup keys on credit/auth/rate failures.
    const apiKeys = window.App.config.getApiKeys();
    const model = window.App.config.getModel();

    let raw;
    let method = 'text';

    if (window.App.pdfParser.isLikelyScanned(parsed)) {
      // Scanned PDF — fall back to vision
      onStage?.('extracting', 'Scanned PDF detected — using vision model');
      const { images } = await window.App.pdfParser.renderPagesToImages(file, { maxPages: 5, scale: 1.6 });
      raw = await window.App.openrouter.extractWithVision(images, { apiKeys, model });
      method = 'vision';
    } else {
      onStage?.('extracting', 'Extracting fields with AI');
      raw = await window.App.openrouter.extractWithLLM(parsed.text, { apiKeys, model });
    }

    onStage?.('validating', 'Validating');
    const normalized = normalize(raw);
    normalized.extraction_method = method;
    return normalized;
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
