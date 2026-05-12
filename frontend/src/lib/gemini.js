/* ==========================================================================
   gemini.js — Google Generative Language API client.
   Used when the active API key starts with "AIzaSy" (Google Gemini key).

   Free tier (per Google project):
     gemini-2.5-flash-lite : ~1,500 req/day  (recommended default)
     gemini-2.5-flash      : ~1,500 req/day  (slightly better quality)
     gemini-2.5-pro        : ~50 req/day     (paid for higher)

   Same JSON schema in/out as openrouter.js so the extractor can route
   to either backend transparently.
   ========================================================================== */
(() => {
  'use strict';

  const ENDPOINT = (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

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
- "buyer": the named contact at the customer who placed the order.
- "po_number": the primary purchase order identifier. Strip any "PO#", "P.O.", or similar prefix.

LINE ITEMS
- Each row in the line-items table becomes one object in line_items[].
- "customer_part": the buyer's internal part number (sometimes "Item #", "Stock Code", "Customer Part #").
- "vendor_part": the supplier/manufacturer's part number (sometimes "Vendor Part #", "Mfr Part #", "Model #").
- If only one part number is given, put it in vendor_part and leave customer_part as "".
- "amount" must equal quantity × unit_price. If only one is given, compute the missing value.
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

  function _stripFences(content) {
    return content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
  }

  function _parseJson(content) {
    const stripped = _stripFences(content);
    try { return JSON.parse(stripped); } catch { /* fall through */ }
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Gemini did not return valid JSON.');
  }

  async function _callGemini(model, apiKey, body, signal, { allowTruncation = false } = {}) {
    const url = `${ENDPOINT(model)}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      let msg = `Gemini API ${res.status}`;
      try {
        const err = await res.json();
        msg = err?.error?.message || msg;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const parts = candidate?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();

    if (finishReason === 'MAX_TOKENS' && !allowTruncation) {
      console.warn('Gemini response truncated. Raw:', text);
      throw new Error('Response was cut off — increase max_tokens or switch to a smaller PO.');
    }
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      throw new Error(`Gemini blocked response (${finishReason}). Try a different model.`);
    }
    if (!text) {
      const blockReason = data?.promptFeedback?.blockReason;
      if (blockReason) throw new Error(`Gemini blocked the request (${blockReason}).`);
      throw new Error('Empty response from Gemini.');
    }
    return text;
  }

  async function extractWithLLM(documentText, { apiKey, apiKeys, model, signal, maxTokens = 1500 } = {}) {
    if (!documentText || documentText.length < 20) {
      throw new Error('No text could be read from this document.');
    }
    const keys = (Array.isArray(apiKeys) && apiKeys.length) ? apiKeys : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new Error('No Gemini API key configured.');

    const MAX_CHARS = 80000;
    const trimmed = documentText.length > MAX_CHARS
      ? documentText.slice(0, MAX_CHARS) + '\n\n[document truncated for length]'
      : documentText;

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        { role: 'user', parts: [{ text: 'Extract the purchase order data from the following document:\n\n' + trimmed }] },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        // Gemini 2.5 thinking models consume tokens before output. PO
        // extraction is mechanical — no reasoning needed — so disable.
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    return _withFallback(keys, async (k) => {
      const text = await _callGemini(model || 'gemini-2.5-flash-lite', k, body, signal);
      return _parseJson(text);
    });
  }

  async function extractWithVision(pageImages, { apiKey, apiKeys, model, signal, maxTokens = 1500 } = {}) {
    if (!pageImages || pageImages.length === 0) {
      throw new Error('No page images supplied for vision extraction.');
    }
    const keys = (Array.isArray(apiKeys) && apiKeys.length) ? apiKeys : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new Error('No Gemini API key configured.');

    const parts = [{ text: 'Extract the purchase order data from these page images. Follow the schema in the system prompt exactly.' }];
    for (const url of pageImages) {
      // Strip the data: prefix to get raw base64
      const m = url.match(/^data:(image\/\w+);base64,(.*)$/);
      if (!m) continue;
      parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    return _withFallback(keys, async (k) => {
      const text = await _callGemini(model || 'gemini-2.5-flash', k, body, signal);
      return _parseJson(text);
    });
  }

  async function pingLLM({ apiKey, model } = {}) {
    if (!apiKey) throw new Error('No API key configured.');
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Reply with a single word: pong' }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 32,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    // Allow MAX_TOKENS — for a connectivity check, ANY response means the
    // key + model work. We don't care if the model felt chatty.
    const text = await _callGemini(model || 'gemini-2.5-flash-lite', apiKey, body, undefined, { allowTruncation: true });
    return { reply: text, model };
  }

  async function _withFallback(keys, doRequest) {
    let lastError;
    for (let i = 0; i < keys.length; i++) {
      try {
        const result = await doRequest(keys[i]);
        if (i > 0) console.info(`Foundry: Gemini succeeded on backup key #${i + 1}/${keys.length}`);
        return result;
      } catch (err) {
        lastError = err;
        const msg = (err?.message || '').toLowerCase();
        const fallbackable = msg.includes('quota') || msg.includes('rate') ||
                            msg.includes('429') || msg.includes('401') || msg.includes('permission');
        if (i < keys.length - 1 && fallbackable) {
          console.warn(`Foundry: Gemini key #${i + 1} failed (${err.message}). Trying backup...`);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('All Gemini keys failed.');
  }

  window.App = window.App || {};
  window.App.gemini = { extractWithLLM, extractWithVision, pingLLM };
})();
