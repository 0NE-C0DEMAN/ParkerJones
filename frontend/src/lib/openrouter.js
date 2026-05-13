/* ==========================================================================
   openrouter.js — Real LLM call against OpenRouter. Sends extracted PDF text,
   gets back a JSON object matching our PO schema.
   ========================================================================== */
(() => {
  'use strict';

  const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

  const SYSTEM_PROMPT = `You are a precise data extraction tool for purchase orders (POs).
Extract structured data into ONE JSON object that strictly matches the schema. No markdown fences, no commentary.

FORMATTING
- Empty string "" for missing strings; 0 for missing numbers.
- Dates: YYYY-MM-DD (convert from any format, including MM/DD/YYYY and DD/MM/YY).
- Numbers: plain decimals — no currency symbols, no thousands commas, no $ or USD inline.
- Multi-line addresses + notes: preserve line breaks as \\n.

THE FOUR PARTIES (read carefully — most extraction errors live here)
A PO involves up to four roles. Map them to the right fields by reading the LABELED BLOCKS on the document.

  Block label on the PO            ->  Field(s) in output
  ─────────────────────────────────────────────────────────
  Logo / letterhead at top page    ->  customer (+ customer_address ONLY if a separate address block for the same entity exists)
  "VENDOR:", "SUPPLIER:", "Sold by",
    "Company:" (Ariba template)    ->  supplier + supplier_address (+ supplier_code if a number appears next to the label)
  "SHIP TO:", "Deliver To:"        ->  ship_to (where the GOODS physically go)
  "BILL TO:", "INVOICE TO:",
    "Remit To:"                    ->  bill_to (an ADDRESS only; see below)
  "BUYER:", "Sourcing Rep:",
    "Buyer Name:", "Authorized by" ->  buyer (a PERSON, not a company)

FIELD LABEL VARIATIONS — different PO templates use different words for the same thing. Map them as follows:

  po_number              <- "PURCHASE ORDER NUMBER", "PO Number", "Purchase Order:", "Purchase Order#:", "PO#", "P.O. NO."
  po_date                <- "DATE", "PO Date", "Date:", "Order Date"
  revision               <- "Revision", "Rev", "PO Revision", "Revision Number"
  supplier_code          <- "VENDOR: <num>", "Supplier #", "Vendor #", "Vendor No.", "Company: <id>", "Account #" (on the supplier line)
  payment_terms          <- "Payment Terms", "Terms"
  freight_terms          <- "Freight Terms", "Freight term", "Freight"
  ship_via               <- "Ship Via", "Carrier", "Routing", "Method of Shipment"
  fob_terms              <- "F.O.B.", "FOB", "FOB Terms", "Freight Origin", "F.O.B. Point"
  buyer                  <- "Buyer", "Buyer Name", "Sourcing Representative", "Purchasing Agent" (PERSON)
  buyer_email            <- "Email:" in buyer block, "Buyer Contact" when it's an email
  buyer_phone            <- "Phone#:" inside the buyer block (NOT the receiving block phone)
  receiving_contact      <- "Receiving Contact", "Deliver To Attn", "Site Contact"
  receiving_contact_phone <- "Phone:" inside the receiving / ship-to block
  quote_number           <- "Quote #", "Quote", "Reference: Quote #..."
  contract_number        <- "Contract#", "Contract Ref #", "Master Agreement". On Ariba layouts the contract ref appears INLINE in the line-items row header — e.g. "Line# Item # Catalog # Required Date Contract Ref # Qty Units ..." then "Line 4002005   09/05/2026 25465   16 EA ...". The "25465" between the date and the qty is contract_number.
  total                  <- "TOTAL ORDER", "Total", "Grand Total", "Purchase Total", "Total PO Cost"

CRITICAL FIELD RULES

#1 — bill_to is an ADDRESS, never an email or a generic mailbox.
  * If the PO only says "Send invoices to ap@ceeus.com" or "SEND INVOICES TO: TEMA.INVOICES@NCEMCS.COM" or "Send all invoices to SCSInvoices@wescodist.com", do NOT put the email in bill_to. Leave bill_to as "" and put the whole instruction in the top-level notes field instead.
  * bill_to should ONLY contain a postal address that a paper invoice could be mailed to.

#2 — Each address field belongs to its OWN entity. Never borrow.
  * If the PO names the customer at the top (logo / letterhead) but shows no separate customer address block, leave customer_address as "". This applies EVEN IF the ship-to entity has the same name as the customer — DO NOT copy the ship-to address into customer_address, because the address shown is the warehouse, not the customer's HQ.
  * The supplier's address is often "C/O <broker> INC, ..." — that broker address belongs in supplier_address, NEVER in customer_address.
  * The SHIP TO block is typically a warehouse / DC belonging to the customer — NOT the supplier. Put it in ship_to, NEVER in supplier_address.

#3 — Reference codes next to labels:
  * Short numeric next to "VENDOR:" / "Supplier #" / "Company:" → supplier_code.
  * Single letter (e.g. "R" after "SHIP TO:") → skip, not an address.

#4 — Ariba-template two-column layout (Apex / Duke / APG Purchasing / etc.).
  Ariba POs lay out the supplier info on the LEFT and ship-to info on the RIGHT as two parallel column-blocks that continue for many lines. Read STRICTLY column-by-column.

  Example:
      Company:           000098085004                  Ship To:
                         TRITON FABRICATORS INC        OBRIEN DISTRIBUTION CTR - FLORIDA
                                                       19800 South O'Brien Rd
                         C/O LEKSON & ASSOC            UNIT 101
                         4004-105 BARRETT DRIVE
                                                       GROVELAND FL 34736 USA
                         RALEIGH NC 27609 USA          FedEx Account : N/A

  Correct mapping:
      supplier         = "TRITON FABRICATORS INC"
      supplier_code    = "000098085004"
      supplier_address = "C/O LEKSON & ASSOC\\n4004-105 BARRETT DRIVE\\nRALEIGH NC 27609 USA"
      ship_to          = "OBRIEN DISTRIBUTION CTR - FLORIDA\\n19800 South O'Brien Rd\\nUNIT 101\\nGROVELAND FL 34736 USA"
      customer_address = ""   (no separate customer address block)
      bill_to          = ""   (no bill-to address shown)

  Anti-patterns to AVOID:
      ❌ Putting the ship-to address in supplier_address
      ❌ Putting the broker "C/O" address in customer_address
      ❌ Leaving ship_to blank when it's clearly in the right column

NAME RULES (never concatenate, never hallucinate)
1. Pick ONE company name for each role. NEVER produce concatenations like:
   - WRONG: "SEFCOR INC ALLIED COMPONENTS INC"
   - WRONG: "VALMONT INDUSTRIES INC TRITON FABRICATORS INC"
   - WRONG: "DEF Purchasing Company, LLC APG Purchasing Company, LLC"
2. "Agent for X" / "On behalf of Y" disclaimers do not make X / Y the customer — the customer is the entity actually issuing the PO.
3. Garbled text may be two strings overlaid letter-by-letter (e.g. "DAPEGF PPuurrcchhaassiinngg" = "APG Purchasing" overlaid on "DEF Purchasing"). Output the value a human reader sees on top.
4. buyer = a person's name, not a company.
5. buyer_email = the buyer's personal email. Skip generic invoicing addresses ("ap@…", "SCSInvoices@…", "TEMA.INVOICES@…") — leave "" if no personal email.

LINE ITEMS

DESCRIPTION IS THE CANONICAL FIELD FOR PARTS
The "description" field is the AUTHORITATIVE single source of truth for every line. **ALWAYS** lead the description with EVERY part identifier the document shows for that line, even if you ALSO fill customer_part / vendor_part below. The description must be self-contained: a rep reading description alone should see every code that appears on that line of the original PO.

Identifiers to include (space-separated, document order):
  - Item # / Stock Code / Customer Part # / Buyer Part #
  - Mfr Part # / Vendor Part # / Mfr Model # / Catalog # / Manufacturer Part Number
  - Santee Cooper PN / customer-specified principal part #
  - "PLEASE FURNISH #" continuation codes
  - any extra Cat #, model #, drawing #, U-number

Then " — " (space hyphen space) and the actual product description text.

Worked example (TEMA):
  description = "39004430 CRTKAA08E120510KTHVAU0037 CRTK2-C016-D-U-T5R-U0-TH-4N7-10MSP-V-A-10 X-U126120 — SEC LGT HEAD ONLY 29W LED"

OPTIONAL STRUCTURED PART FIELDS (fill ONLY when labels are UNAMBIGUOUS)
- "customer_part" — only when "Customer Part #", "Stock Code", "Buyer Part #" is the explicit label, or on Ariba "Line <NUMBER>" rows (NUMBER → customer_part).
- "vendor_part" — only when "Mfr Part #", "Vendor Part #", "Mfr Model #", "Catalog #" is the explicit label. The label decides regardless of what the code value looks like.
- If the column header is just "ITEM" or ambiguous, leave BOTH fields "" — the description already has every identifier.

OTHER LINE FIELDS

⚠️ QUANTITY, UNIT_PRICE, and AMOUNT are CRITICAL — they drive the rep's invoice math. Never return 0 for any of these unless the document literally shows a blank or zero. If you see two of the three, compute the third (quantity × unit_price = amount within rounding tolerance).

- "quantity" — labels: "Qty", "Quantity", "Order Quantity". On Wesco/Meridian it's the SECOND column right after Line #; on Ariba between Contract Ref # and Units; on TEMA between LINE and UOM.
- "unit_price" — labels: "Unit Price", "Unit Cost", "Net Quoted Price", "Price". Plain decimal, no $ or commas.
- "amount" (a.k.a. "Extension", "Extended", "Line Cost", "Net", "Total"). Must equal quantity × unit_price within ±$0.50.
- "uom" (a.k.a. "Qty UM", "Units", "U/M"): Use the EXACT unit shown — EA, BX, CS, LT, FT, M, LB, KG, RL, PK, PR, etc. Don't normalize to EA. Only default to "EA" when NO unit appears.
- "required_date" (a.k.a. "Due Date", "Need By", "Ship Date").
- "notes" (PER-LINE): short instructions specific to this line — e.g. "30 PER PALLET", "Ship by 5/18/2026", "DO NOT SHIP USING AAA COOPER". One short paragraph max, line breaks as \\n. Don't repeat the description here.

PO-LEVEL NOTES (top-level "notes")
Collect SHORT PO-specific instructions. Keep notes under ~10 lines / ~500 chars total.

INCLUDE — short actionable instructions tied to this PO:
  - "Acknowledge receipt of PO in 24 Hrs by email to: <email>"
  - "Send Invoices to: <email>" (when there is no real bill_to address)
  - "Send PO Acknowledgement to: <email>"
  - "Send ASN to: <email>"
  - "No Deliveries After 12:00 Noon"
  - "**** NON-TAXABLE ****"
  - "Contact buyer for any price discrepancy. Do not ship until buyer agrees."

SKIP — multi-paragraph boilerplate that appears on EVERY PO from the same template:
  - Ariba Network invoicing paragraphs ("...shall be issued via the Ariba Network...", "When submitting through the Ariba Network...", APQuestions@...)
  - Wesco contract terms ("...governed by Wesco's purchase order terms and conditions...")
  - Standard carrier-routing rules (LTL/Truckload weight limits, "Shipments under 150 lbs. Use UPS", DukeEnergyFreight.com, TONU / detention, ISPM 15 wood-packaging)
  - Equal Opportunity Clause ("This contract, unless exempt under the rules ... 41 CFR CH. 60 ...")
  - RUS approval text ("All materials must be RUS approved under Section 43-5...")
  - Duke Energy Standard Terms / SECTION 1 DEFINITIONS / etc.

CURRENCY + TOTALS
- "currency": default "USD". Use the explicit code if "CAD"/"EUR"/etc. appears.
- "total": grand total. Look for "TOTAL ORDER", "Total", "Grand Total", "Purchase Total", "Total PO Cost". Sum line subtotals if no explicit total is shown.

INPUT FORMAT
At the bottom of each page you may see a section like:
  === STRUCTURED TABLES (use these for line items if visible) ===
  [TABLE 1]
  | Line | Part #  | Description | Qty | Unit Price | Total |
  | 1    | X-1234  | Widget A    | 5   | 10.00      | 50.00 |
  ...
When a [TABLE N] block is present, treat IT as the authoritative source for line items — it's the parser's structured view of the same table that may have been flattened into prose above. Header blocks (VENDOR / SHIP TO / BILL TO / BUYER) should still be read from the layout-preserved body text.

COLUMN LAYOUT HINT (text mode)
The body text is whitespace-aligned to the original column layout. Related blocks may appear on the same line with significant whitespace between them — e.g.
  "VENDOR:  COOPER LIGHTING               SHIP TO:  TARHEEL ELECTRIC"
Treat whitespace as a column boundary. Do not concatenate addresses across columns. If the columns drift further down (one has more lines than the other), stay aligned with the original column boundary, not with the visual row.

OUTPUT SCHEMA
{
  "po_number": "string",
  "po_date": "YYYY-MM-DD",
  "revision": "string",
  "customer": "string",
  "customer_address": "string",
  "supplier": "string",
  "supplier_code": "string",
  "supplier_address": "string",
  "bill_to": "string (multi-line ok)",
  "ship_to": "string (multi-line ok)",
  "payment_terms": "string",
  "freight_terms": "string",
  "ship_via": "string",
  "fob_terms": "string",
  "buyer": "string",
  "buyer_email": "string",
  "buyer_phone": "string",
  "receiving_contact": "string",
  "receiving_contact_phone": "string",
  "quote_number": "string",
  "contract_number": "string",
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
      "required_date": "YYYY-MM-DD",
      "notes": "string"
    }
  ],
  "total": 0,
  "notes": "string (multi-line ok)"
}`;

  async function extractWithLLM(documentText, { apiKey, apiKeys, model, signal, maxTokens = 8192 } = {}) {
    if (!documentText || documentText.length < 20) {
      throw new Error('No text could be read from this document. Scanned PDFs auto-route to the vision model — try re-uploading.');
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
  /**
   * Hybrid extraction — text + page images in one call. The LLM uses text
   * for clean values, images for spatial layout. Same JSON schema as the
   * other two paths.
   */
  async function extractWithHybrid(documentText, pageImages, { apiKey, apiKeys, model, signal, maxTokens = 8192 } = {}) {
    if (!documentText || documentText.length < 20) {
      throw new Error('No text could be read from this document.');
    }
    if (!pageImages || pageImages.length === 0) {
      return extractWithLLM(documentText, { apiKey, apiKeys, model, signal, maxTokens });
    }
    const keys = (Array.isArray(apiKeys) && apiKeys.length) ? apiKeys : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new Error('No API key configured. Set one in Settings.');
    return _withFallback(keys, (k) => _doHybridExtract(documentText, pageImages, { apiKey: k, model, signal, maxTokens }));
  }

  async function _doHybridExtract(documentText, pageImages, { apiKey, model, signal, maxTokens }) {
    const MAX_CHARS = 60000;
    const trimmed = documentText.length > MAX_CHARS
      ? documentText.slice(0, MAX_CHARS) + '\n\n[document truncated for length]'
      : documentText;

    const content = [
      {
        type: 'text',
        text:
          'You are given BOTH the parsed text of this PO AND the rendered page images. ' +
          'Use the text for clean character values (it has no OCR errors). ' +
          'Use the images for spatial layout — which block is in which column, ' +
          'which lines belong together visually, where the supplier ends and the ship-to begins. ' +
          'Cross-check: if the text suggests two values belong to the same field but the image shows ' +
          'they are in different columns, trust the image for that judgment.\n\n' +
          '=== PARSED TEXT ===\n\n' + trimmed +
          '\n\n=== PAGE IMAGES ===',
      },
      ...pageImages.map((url) => ({ type: 'image_url', image_url: { url } })),
    ];

    const body = {
      model: model || 'anthropic/claude-sonnet-4.5',
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
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
        'X-Title': 'Foundry PO Capture (hybrid)',
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
    const text = json?.choices?.[0]?.message?.content;
    const finishReason = json?.choices?.[0]?.finish_reason;
    if (!text) throw new Error('Empty response from LLM.');
    if (finishReason === 'length') {
      throw new Error('Hybrid response was cut off — try a model with more max_tokens or split the PO.');
    }
    try {
      return parseJsonContent(text);
    } catch {
      throw new Error('Hybrid model did not return valid JSON.');
    }
  }

  async function extractWithVision(pageImages, { apiKey, apiKeys, model, signal, maxTokens = 8192 } = {}) {
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
  window.App.openrouter = { extractWithLLM, extractWithHybrid, extractWithVision, pingLLM };
})();
