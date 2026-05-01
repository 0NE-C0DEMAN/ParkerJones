/* ==========================================================================
   openrouter.js — Real LLM call against OpenRouter. Sends extracted PDF text,
   gets back a JSON object matching our PO schema.
   ========================================================================== */
(() => {
  'use strict';

  const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

  const SYSTEM_PROMPT = `You are a precise data extraction tool for purchase orders (POs).
Extract structured data from the document text below into a single JSON object that strictly matches the schema.

OUTPUT RULES
- Return ONE JSON object only — no markdown fences, no commentary, no extra text.
- Use empty string "" for missing string fields and 0 for missing number fields.
- Dates must be ISO format YYYY-MM-DD (convert from any other format you see).
- Numbers must be plain decimals — no currency symbols, no commas (e.g. 541010.00 not "$541,010.00").
- For multi-line addresses, preserve line breaks as \\n inside the JSON string.

FIELD SEMANTICS
- "customer": the company that ISSUED the PO (the buyer placing the order). This is usually shown at the top with the logo, OR in a "From"/"Bill From"/issuer block.
- "supplier": the company SELLING the goods (the vendor receiving the order). This is usually in a "To"/"Supplier"/"Vendor" block.
- "bill_to": billing address. May equal customer address, leave "" if not separately listed.
- "ship_to": delivery address. Distinct from bill_to.
- "payment_terms": e.g. "Net 30", "Net 45", "2/10 Net 30".
- "buyer": the named contact at the customer who placed the order (e.g. "Debbie Caldwell").
- "po_number": the primary purchase order identifier. Strip any "PO#", "P.O.", or similar prefix.

LINE ITEMS
- Each row in the line-items table becomes one object in line_items[].
- "customer_part": the buyer's internal part number (sometimes "Item #", "Stock Code", "Customer Part #").
- "vendor_part": the supplier/manufacturer's part number (sometimes "Vendor Part #", "Mfr Part #", "Model #").
- If only one part number is given, put it in vendor_part and leave customer_part as "".
- "amount" must equal quantity × unit_price. If the document gives only one of those, compute the missing value.
- "uom": unit of measure (EA, FT, LB, etc.). Default "EA" if not specified.
- "required_date": delivery / required-by date for that line.
- Include freight/tax line items if listed separately.

TOTALS
- "total": grand total of the PO (sum of all line item amounts including freight/tax).

OUTPUT SCHEMA
{
  "po_number": "string",
  "po_date": "YYYY-MM-DD",
  "revision": "string",
  "customer": "string",
  "customer_address": "string",
  "supplier": "string",
  "supplier_address": "string",
  "bill_to": "string (multi-line ok)",
  "ship_to": "string (multi-line ok)",
  "payment_terms": "string",
  "buyer": "string",
  "buyer_email": "string",
  "currency": "USD",
  "line_items": [
    {
      "line": 1,
      "customer_part": "string",
      "vendor_part": "string",
      "description": "string",
      "quantity": 0,
      "uom": "EA",
      "unit_price": 0,
      "amount": 0,
      "required_date": "YYYY-MM-DD"
    }
  ],
  "total": 0
}`;

  async function extractWithLLM(documentText, { apiKey, apiKeys, model, signal, maxTokens = 1500 } = {}) {
    if (!documentText || documentText.length < 20) {
      throw new Error('No text could be read from this document. If it\'s a scanned PDF, OCR support is coming via the Streamlit backend.');
    }
    const keys = (Array.isArray(apiKeys) && apiKeys.length) ? apiKeys : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new Error('No API key configured. Set one in Settings.');
    return _withFallback(keys, (k) => _doTextExtract(documentText, { apiKey: k, model, signal, maxTokens }));
  }

  async function _doTextExtract(documentText, { apiKey, model, signal, maxTokens }) {

    // Cap input to avoid runaway costs on giant boilerplate docs (e.g. 30-page Apex T&Cs)
    const MAX_CHARS = 60000; // ~15k tokens
    const trimmed = documentText.length > MAX_CHARS ? documentText.slice(0, MAX_CHARS) + '\n\n[document truncated for length]' : documentText;

    const body = {
      model: model || 'anthropic/claude-sonnet-4.5',
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Extract the purchase order data from the following document:\n\n${trimmed}` },
      ],
    };

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Foundry PO Capture',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let errMsg = `OpenRouter API ${res.status}`;
      try {
        const errBody = await res.json();
        errMsg = errBody?.error?.message || errMsg;
      } catch {
        try { errMsg = await res.text() || errMsg; } catch { /* ignore */ }
      }
      throw new Error(errMsg);
    }

    const json = await res.json();
    const choice = json?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    const usage = json?.usage;

    if (!content) throw new Error('Empty response from LLM.');

    // Detect truncation (the most common cause of "invalid JSON")
    if (finishReason === 'length') {
      console.warn('LLM response truncated. Raw content:', content);
      throw new Error(
        `Response was cut off at ${usage?.completion_tokens || '?'} tokens — this PO has more line items than fit in the current max_tokens limit. ` +
        `Either switch to Haiku 4.5 in Settings (3× cheaper, fits more output) or top up OpenRouter credits to raise the cap.`
      );
    }

    try {
      return parseJsonContent(content);
    } catch (err) {
      console.error('Failed to parse LLM response as JSON. Raw content:', content);
      throw new Error(
        `LLM returned content but it could not be parsed as JSON. Check the browser console for the raw response. ` +
        `(Model: ${json?.model || model}, finish_reason: ${finishReason})`
      );
    }
  }

  function parseJsonContent(content) {
    // Strip optional ```json fences if the model added them despite instructions.
    const stripped = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    // Direct parse
    try { return JSON.parse(stripped); } catch { /* fall through */ }

    // Pull the first {...} block
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }

    // Last resort: try to repair a truncated JSON by closing brackets
    const repaired = repairTruncatedJson(stripped);
    if (repaired !== null) {
      try {
        const parsed = JSON.parse(repaired);
        console.warn('Recovered from truncated JSON. Some line items may be missing.');
        return parsed;
      } catch { /* give up */ }
    }

    throw new Error('Could not parse LLM response as JSON.');
  }

  function repairTruncatedJson(text) {
    // Trim trailing junk after the last comma/colon to a stable position
    let s = text.trim();
    if (!s.startsWith('{')) {
      const idx = s.indexOf('{');
      if (idx < 0) return null;
      s = s.slice(idx);
    }
    // Walk the string tracking open quotes and brackets
    let inStr = false, escape = false;
    const stack = [];
    let lastSafe = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') stack.pop();
      // Mark a "safe" position right after a comma at depth 1 (between line items)
      if (c === ',' && stack.length === 2) lastSafe = i;
    }
    // If we ended inside a string, terminate it
    if (inStr) {
      // Cut back to the last safe point (between objects in an array)
      if (lastSafe > 0) s = s.slice(0, lastSafe);
      else s = s + '"';
    } else if (lastSafe > 0 && stack.length > 0) {
      // Cut back to last clean comma to drop the partial last object
      s = s.slice(0, lastSafe);
    }
    // Recompute stack on the trimmed string and close brackets
    const closes = [];
    inStr = false; escape = false;
    const finalStack = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') finalStack.push(c);
      else if (c === '}' || c === ']') finalStack.pop();
    }
    while (finalStack.length) {
      const open = finalStack.pop();
      closes.push(open === '{' ? '}' : ']');
    }
    return s + closes.join('');
  }

  /**
   * Vision-mode extraction. Sends rendered PDF pages as images to a
   * vision-capable model. Used when text extraction fails (scanned PDFs).
   * Same JSON output schema as the text path.
   */
  async function extractWithVision(pageImages, { apiKey, apiKeys, model, signal, maxTokens = 1500 } = {}) {
    if (!pageImages || pageImages.length === 0) {
      throw new Error('No page images supplied for vision extraction.');
    }
    const keys = (Array.isArray(apiKeys) && apiKeys.length) ? apiKeys : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new Error('No API key configured. Set one in Settings.');
    return _withFallback(keys, (k) => _doVisionExtract(pageImages, { apiKey: k, model, signal, maxTokens }));
  }

  async function _doVisionExtract(pageImages, { apiKey, model, signal, maxTokens }) {

    const content = [
      { type: 'text', text: 'Extract the purchase order data from these page images. Follow the schema in the system prompt exactly.' },
      ...pageImages.map((url) => ({ type: 'image_url', image_url: { url } })),
    ];

    const body = {
      model: model || 'anthropic/claude-sonnet-4.5',
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    };

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Foundry PO Capture (vision)',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      let msg = `OpenRouter API ${res.status}`;
      try { msg = (await res.json())?.error?.message || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const json = await res.json();
    const choice = json?.choices?.[0];
    const text = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    if (!text) throw new Error('Empty response from vision model.');
    if (finishReason === 'length') {
      console.warn('Vision response truncated. Raw:', text);
      throw new Error('Vision response was cut off — try Haiku 4.5 in Settings or top up credits.');
    }
    try {
      return parseJsonContent(text);
    } catch {
      console.error('Vision JSON parse failed. Raw:', text);
      throw new Error('Vision model did not return valid JSON.');
    }
  }

  /**
   * Walk a list of API keys, trying each one. Falls back to the next key
   * only on credit / auth / rate-limit failures — non-recoverable errors
   * (truncation, parse failures, server 5xx) bubble up immediately.
   */
  async function _withFallback(keys, doRequest) {
    let lastError;
    for (let i = 0; i < keys.length; i++) {
      try {
        const result = await doRequest(keys[i]);
        if (i > 0) {
          console.info(`Foundry: succeeded on backup key #${i + 1}/${keys.length}`);
        }
        return result;
      } catch (err) {
        lastError = err;
        if (i < keys.length - 1 && _isFallbackable(err)) {
          console.warn(`Foundry: key #${i + 1} failed (${err.message}). Trying backup...`);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('All API keys failed.');
  }

  function _isFallbackable(err) {
    const msg = (err?.message || '').toLowerCase();
    return (
      msg.includes('credit') ||
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('rate-limit') ||
      msg.includes('rate_limit') ||
      msg.includes('unauthorized') ||
      msg.includes('invalid api key') ||
      msg.includes('invalid_api_key') ||
      msg.includes('401') ||
      msg.includes('402') ||
      msg.includes('403') ||
      msg.includes('429')
    );
  }

  /**
   * Lightweight connectivity test. Doesn't use the extraction system prompt —
   * just verifies that the API key works for the chosen model.
   */
  async function pingLLM({ apiKey, model } = {}) {
    if (!apiKey) throw new Error('No API key configured.');
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Foundry PO Capture',
      },
      body: JSON.stringify({
        model: model || 'anthropic/claude-sonnet-4.5',
        max_tokens: 16,
        temperature: 0,
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json())?.error?.message || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Empty response from LLM.');
    return { reply, model: data?.model, usage: data?.usage };
  }

  window.App = window.App || {};
  window.App.openrouter = { extractWithLLM, extractWithVision, pingLLM };
})();
