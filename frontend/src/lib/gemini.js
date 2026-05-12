/* ==========================================================================
   gemini.js — Google Generative Language API client.
   Used when the active API key starts with "AIzaSy" (Google Gemini key).

   Free tier exists for all 2.5 models but Google publishes per-account
   limits via aistudio.google.com/rate-limit rather than fixed public
   numbers — don't hard-code RPD here.

   Same JSON schema in/out as openrouter.js so the extractor can route
   to either backend transparently.
   ========================================================================== */
(() => {
  'use strict';

  const ENDPOINT = (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const SYSTEM_PROMPT = `You are a precise data extraction tool for purchase orders (POs).
Extract structured data into ONE JSON object that strictly matches the schema. No markdown fences, no commentary.

FORMATTING
- Empty string "" for missing strings; 0 for missing numbers.
- Dates: YYYY-MM-DD (convert from any format).
- Numbers: plain decimals — no currency symbols, no thousands commas.
- Multi-line addresses: preserve line breaks as \\n.

THE FOUR PARTIES (read carefully — most extraction errors live here)
A PO involves up to four roles. Map them to the right fields by reading the LABELED BLOCKS on the document.

  Block label on the PO            ->  Field(s) in output
  ─────────────────────────────────────────────────────────
  Logo / letterhead at top page    ->  customer (+ customer_address ONLY if a separate address block for the same entity exists)
  "VENDOR:", "SUPPLIER:", "Sold by",
    "Company:" (Ariba template)    ->  supplier + supplier_address
  "SHIP TO:", "Deliver To:"        ->  ship_to (where the GOODS go)
  "BILL TO:", "INVOICE TO:",
    "Remit To:", "Send invoices to" ->  bill_to
  "BUYER:", "Sourcing Rep:",
    "Buyer Name:", "Authorized by" ->  buyer (a PERSON, not a company)

CRITICAL ADDRESS RULES
1. Each address field belongs to its OWN entity. Do NOT borrow another block's address into an empty slot.
   - If the PO names the customer at the top but shows no separate customer address block, leave customer_address as "".
   - The supplier's address is often a "c/o broker" address (e.g. "C/O LEKSON ASSOCIATES INC, ..."). That belongs in supplier_address — NEVER in customer_address.
   - The SHIP TO block on a PO is typically a warehouse or DC belonging to the customer — NOT the supplier's location. Put it in ship_to, NEVER in supplier_address.
2. If the customer is not the same entity as the ship-to but the ship-to is clearly the customer's warehouse, ship_to should include the company name + address from the SHIP TO block.
3. Stray single-letter codes next to a label ("SHIP TO:    R", "VENDOR:  4644") are ship-to / vendor reference codes — they are NOT part of the address. Skip them.

NAME RULES (never concatenate, never hallucinate)
1. Pick ONE company name for each role. NEVER produce concatenations like:
   - WRONG: "SEFCOR INC ALLIED COMPONENTS INC"
   - WRONG: "VALMONT INDUSTRIES INC TRITON FABRICATORS INC"
   - WRONG: "DEF Purchasing Company, LLC APG Purchasing Company, LLC"
2. If the PO has "Agent for X" or "On behalf of Y" wording, the customer is the ENTITY ACTUALLY ISSUING the PO (the agent name on the logo) — X / Y are principals, not the customer. Don't append the principal name.
3. The text may have garbled-looking characters that are actually TWO strings overlaid (templates do this for placeholder + real value). If you see something like "DAPEGF PPuurrcchhaassiinngg CCoommppaannyy" or "SAELFLCIEODR INC", that's two strings interleaved letter-by-letter — pick the one a human reader would see (typically the value, not the italic placeholder). For "DAPEGF" output "APG"; for "SAELFLCIEODR" output "ALLIED" (or "SEFCOR" — pick whichever is non-italic / drawn on top).
4. buyer = a person's name. Don't put a company in buyer.
5. buyer_email = the buyer's personal email. Do NOT use generic invoicing addresses like "TEMA.INVOICES@…" or "ap@…" or "SCSInvoices@…" — those go nowhere useful; leave buyer_email as "" if no personal email is shown.

LINE ITEMS
- Each row in the line-items table becomes one object in line_items[].
- "customer_part": the BUYER'S part number (labels: "Customer Part #", "Item #", "Stock Code", "Buyer Part").
- "vendor_part":   the SUPPLIER'S part number (labels: "Vendor Part #", "Mfr Part #", "Catalog #", "Model #", "Item").
- If only one part number is given, put it in vendor_part.
- If a "PLEASE FURNISH #" or continuation block lists ADDITIONAL identifiers spanning multiple lines, include ALL of them in customer_part separated by a single space.
- "amount" = quantity × unit_price. If only one is given, compute the other.
- "uom" defaults to "EA" if not specified.
- "required_date": delivery / required-by date for that line.

TOTALS
- "total": grand total of the PO (sum of all line items including freight/tax).

COLUMN LAYOUT HINT (text mode)
If the input text was extracted from a multi-column PDF, related blocks may appear on the SAME LINE with significant whitespace between them — e.g.
  "VENDOR:  COOPER LIGHTING               SHIP TO:  TARHEEL ELECTRIC"
Treat the whitespace as a column boundary; the left column is the supplier block and the right column is the ship-to block. Do not concatenate their addresses.

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
      // Don't throw — large POs hit this and the chunked extractor in
      // mockApi.js wants to salvage what it can. _parseJson upstream uses
      // a regex that often recovers a valid JSON object from truncated
      // output. If even that fails, the chunk will be marked failed and
      // its siblings still contribute.
      console.warn('Foundry: Gemini response truncated, returning partial text to caller.');
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

  async function extractWithLLM(documentText, { apiKey, apiKeys, model, signal, maxTokens = 8192 } = {}) {
    if (!documentText || documentText.length < 20) {
      throw new Error('No text could be read from this document.');
    }
    const keys = (Array.isArray(apiKeys) && apiKeys.length) ? apiKeys : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new Error('No Gemini API key configured.');

    // Gemini 2.5 models have a 1M-token input context window; 500k chars
    // (~125k tokens) is well within that and covers the largest real-world
    // POs we've seen (200+ pages). Past this, very few POs justify the
    // extra cost, and accuracy starts to fall.
    const MAX_CHARS = 500000;
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

  async function extractWithVision(pageImages, { apiKey, apiKeys, model, signal, maxTokens = 8192 } = {}) {
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
