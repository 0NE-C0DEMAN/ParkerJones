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
  payment_terms          <- "Payment Terms", "Terms"  (e.g. "Net 30", "Net 45", "1.5%10 Net 30")
  freight_terms          <- "Freight Terms", "Freight term", "Freight" (e.g. "Prepaid and Allowed", "Per Contract", "Collect")
  ship_via               <- "Ship Via", "Carrier", "Routing", "Method of Shipment"
  fob_terms              <- "F.O.B.", "FOB", "FOB Terms", "Freight Origin", "F.O.B. Point"
  buyer                  <- "Buyer", "Buyer Name", "Sourcing Representative", "Purchasing Agent" (PERSON, not company)
  buyer_email            <- "Email:" in the buyer block, "Buyer Contact" when it's an email
  buyer_phone            <- "Phone#:" inside the buyer block (NOT the receiving block phone)
  receiving_contact      <- "Receiving Contact", "Deliver To Attn", "Site Contact" (PERSON, at delivery location)
  receiving_contact_phone <- "Phone:" inside the receiving / ship-to block
  quote_number           <- "Quote #", "Quote", "QUOTE #", "Reference: Quote #..."
  contract_number        <- "Contract#", "Contract Ref #", "Master Agreement". On Ariba layouts the contract reference often appears INLINE inside the line-items row header — e.g. "Line# Item # Catalog # Required Date Contract Ref # Qty Units ..." followed by "Line 4002005   09/05/2026 25465   16 EA ...". The "25465" between the date and the quantity is the contract_number. Always check the line-items header for this column.
  total                  <- "TOTAL ORDER", "Total", "Grand Total", "Purchase Total", "Total PO Cost", "PO Total"

CRITICAL FIELD RULES

#1 — bill_to is an ADDRESS, never an email or a generic mailbox.
  * If the PO only says "Send invoices to ap@ceeus.com" or "SEND INVOICES TO: TEMA.INVOICES@NCEMCS.COM" or "Send all invoices to SCSInvoices@wescodist.com", do NOT put the email in bill_to. Leave bill_to as "" and put the whole instruction in the top-level notes field instead.
  * bill_to should ONLY contain a postal address that a paper invoice could be mailed to.
  * Example of correct extraction (TEMA-style PO):
        text:  "SEND INVOICES TO: TEMA.INVOICES@NCEMCS.COM"
        →  bill_to: ""
           notes:   "Send invoices to: TEMA.INVOICES@NCEMCS.COM"

#2 — Each address field belongs to its OWN entity. Never borrow.
  * If the PO names the customer at the top (logo / letterhead) but shows no separate customer address block, leave customer_address as "". This applies EVEN IF the ship-to entity has the same name as the customer (e.g. TEMA buying for TEMA) — DO NOT copy the ship-to address into customer_address, because the address shown is the warehouse, not the customer's HQ. customer_address must come from its OWN block, distinct from ship_to.
  * The supplier's address is often "C/O <broker> INC, ..." — that broker address belongs in supplier_address, NEVER in customer_address.
  * The SHIP TO block is typically a warehouse / DC belonging to the customer — NOT the supplier. Put it in ship_to, NEVER in supplier_address.

#3 — Reference codes next to labels:
  * A short numeric next to "VENDOR:" / "Supplier #" / "Company:" goes in supplier_code.
  * A single letter (e.g. "R" after "SHIP TO:") is a ship-to code — skip it, it's not an address.

#4 — Ariba-template two-column layout (Apex / Duke / APG Purchasing / etc.).
  Ariba POs lay out the supplier info on the LEFT and ship-to info on the RIGHT as two parallel column-blocks that continue for many lines. Read them STRICTLY column-by-column — never let one column's text bleed into the other's address field.

  Example (this is the literal pattern you will see):

      Company:           000098085004                  Ship To:
                         TRITON FABRICATORS INC        OBRIEN DISTRIBUTION CTR - FLORIDA
                                                       19800 South O'Brien Rd
                         C/O LEKSON & ASSOC            UNIT 101
                         4004-105 BARRETT DRIVE
                                                       GROVELAND FL 34736 USA
                         RALEIGH NC 27609 USA          FedEx Account : N/A
                         Attention: Order Entry...     UPS Account: 54AR68
                         Phone#: (919) 782-5426        Freight term : Per Contract

  Correct mapping:
      supplier         = "TRITON FABRICATORS INC"
      supplier_code    = "000098085004"
      supplier_address = "C/O LEKSON & ASSOC\\n4004-105 BARRETT DRIVE\\nRALEIGH NC 27609 USA"
      ship_to          = "OBRIEN DISTRIBUTION CTR - FLORIDA\\n19800 South O'Brien Rd\\nUNIT 101\\nGROVELAND FL 34736 USA"
      freight_terms    = "Per Contract"
      customer_address = ""   (no separate customer address block — APG is on letterhead only)
      bill_to          = ""   (no bill-to address shown — the Ariba "Invoicing:" paragraph is generic boilerplate)

  Anti-patterns to AVOID on this layout:
      ❌ Putting the ship-to address ("OBRIEN ... GROVELAND FL") in supplier_address
      ❌ Putting the broker address ("C/O LEKSON & ASSOC ... RALEIGH NC") in customer_address
      ❌ Leaving ship_to blank when it's clearly visible in the right column

NAME RULES (never concatenate, never hallucinate)
1. Pick ONE company name for each role. NEVER produce concatenations like:
   - WRONG: "SEFCOR INC ALLIED COMPONENTS INC"
   - WRONG: "VALMONT INDUSTRIES INC TRITON FABRICATORS INC"
   - WRONG: "DEF Purchasing Company, LLC APG Purchasing Company, LLC"
2. If the PO has "Agent for X" / "On behalf of Y" wording, the customer is the entity ACTUALLY ISSUING the PO (the agent name on the logo) — X / Y are principals, not the customer.
3. The text may have garbled-looking characters that are actually TWO strings overlaid (templates do this for placeholder + real value). If you see something like "DAPEGF PPuurrcchhaassiinngg CCoommppaannyy" or "SAELFLCIEODR INC", that's two strings interleaved letter-by-letter — pick the one a human reader would see (typically the value, not the italic placeholder). For "DAPEGF" output "APG"; for "SAELFLCIEODR" output "ALLIED" (or "SEFCOR" — pick whichever is non-italic / drawn on top).
4. buyer = a person's name. Don't put a company in buyer.
5. buyer_email = the buyer's personal email. Do NOT use generic invoicing addresses like "TEMA.INVOICES@…" or "ap@…" or "SCSInvoices@…" — those go nowhere useful; leave buyer_email as "" if no personal email is shown.

LINE ITEMS

DESCRIPTION IS THE CANONICAL FIELD FOR PARTS
The "description" field is the AUTHORITATIVE single source of truth for every line. **ALWAYS** lead the description with EVERY part identifier the document shows for that line, even if you ALSO fill customer_part / vendor_part below. The description must be self-contained: a rep reading the description alone should see every part code that appears on that line of the original PO.

Identifiers to include at the start of description (space-separated, in roughly the order they appear in the document):
  - Item # / Stock Code / Customer Part # / Buyer Part #
  - Mfr Part # / Vendor Part # / Mfr Model # / Catalog # / Manufacturer Part Number
  - Santee Cooper PN / customer-specified principal part #
  - "PLEASE FURNISH #" continuation codes
  - any extra Cat #, model #, drawing #, U-number

Then " — " (space hyphen space) and the actual product description text.

Worked example (TEMA):
  Raw line in the doc:
    1   450 EA  39004430              145.5000 EA    65,475.00
                CRTKAA08E120510KTHVAU0037
                SEC LGT HEAD ONLY 29W LED
                PLEASE FURNISH #
                CRTK2-C016-D-U-T5R-U0-TH-4N7-10MSP-V-A-10
                X-U126120.
  Output:
    description = "39004430 CRTKAA08E120510KTHVAU0037 CRTK2-C016-D-U-T5R-U0-TH-4N7-10MSP-V-A-10 X-U126120 — SEC LGT HEAD ONLY 29W LED"

OPTIONAL STRUCTURED PART FIELDS (only when labels are UNAMBIGUOUS)
- "customer_part" — only fill when a label clearly says "Customer Part #", "Stock Code", "Buyer Part #", or on Ariba layouts where the row starts "Line <NUMBER>" (then NUMBER → customer_part, e.g. "Line 1624939 ..." → "1624939").
- "vendor_part" — only fill when a label clearly says "Mfr Part #", "Vendor Part #", "Mfr Model #", "Catalog #", or "Manufacturer Part Number". The LABEL decides — even if the value looks like "DUKE-GB-DMA-70-70-FX-12-BK", a label of "Mfr Part #" means vendor_part.
- If the column header is just "ITEM" (no qualifier), or you cannot tell which side of the relationship a code belongs to, leave BOTH customer_part and vendor_part as "" — the description already has every identifier the rep needs.

OTHER LINE FIELDS
- "amount" (a.k.a. "Extension", "Extended", "Line Cost", "Net") = quantity × unit_price. If only one is given, compute the other.
- "uom" (a.k.a. "Qty UM", "Units", "U/M"): Use the EXACT unit shown on the document — EA, BX, CS, LT, FT, M, LB, KG, RL, PK, PR, etc. If the doc shows "BX" use "BX", never normalize to "EA". Only fall back to "EA" when NO unit is shown anywhere on the line.
- "quantity" — plain number. If the doc shows "12 BX" then quantity=12 and uom="BX".
- "required_date" (a.k.a. "Due Date", "Need By", "Ship Date"): delivery / required-by date for that line.
- "notes" (PER-LINE): short additional instructions specific to this line — examples from real POs:
    "30 PER PALLET", "Ship by 5/18/2026", "PLEASE SHIP X OR SOONER",
    "DO NOT SHIP USING AAA COOPER", "Quote # 859-0002746-009 applies",
    "Santee Cooper PN 390287603 Ln # 35", "Mfr: VALMONT".
  Keep it concise — one short paragraph max per line, line breaks as \\n. Don't repeat the description here.

PO-LEVEL NOTES (top-level "notes" field)
Collect SHORT PO-specific instructions only. Keep notes under ~10 lines / ~500 characters total. Multiple notes separated by \\n.

INCLUDE — short, specific, actionable instructions tied to THIS PO:
  - "Acknowledge receipt of PO in 24 Hrs by email to: TEMA_Purchase_Orders@ncemcs.com"
  - "Send PO Acknowledgement to: POA@ceeus.com"
  - "Send Invoices to: ap@ceeus.com" (when there is no real bill_to address)
  - "Send ASN to: receiving@ceeus.com"
  - "No Deliveries After 12:00 Noon"
  - "Receiving Hours 8:00AM-3:00PM Eastern, M-F"
  - "**** NON-TAXABLE ****"
  - "Contact buyer for any price discrepancy. Do not ship until buyer agrees to price."

SKIP — generic multi-paragraph boilerplate that appears on EVERY PO from the same template. These add noise and don't help the rep, so omit them entirely:
  - Ariba Network invoicing paragraphs ("All original invoices ... shall be issued via the Ariba Network...", "When submitting through the Ariba Network...", "Suppliers that have not yet signed up for their Ariba account...", "All invoice related questions should be sent to APQuestions@...")
  - Wesco / contract terms blurbs ("Unless there are different or additional terms...", "Wesco's purchase order terms and conditions available at www.wesco.com/...")
  - Standard carrier-routing rules (paragraphs about LTL/Truckload weight limits, "Shipments under 150 lbs. Use UPS", "DukeEnergyFreight.com", TONU / detention charges, ISPM 15 wood-packaging rules, Vendor Managed Freight, Duke Energy Logistics Group phone numbers)
  - Equal Opportunity Clause text ("This contract, unless exempt under the rules, regulations, and relevant order of the Secretary of Labor (41 CFR CH. 60)...")
  - RUS approval text ("All materials must be RUS approved under Section 43-5 list of materials.")
  - Duke Energy Standard Terms and Conditions / "SECTION 1: DEFINITIONS" / "1.1 Parties" etc.

CURRENCY + TOTALS
- "currency": default "USD" if not explicitly stated. If "CAD"/"EUR"/etc. appears, use that.
- "total": grand total of the PO. Look for "TOTAL ORDER", "Total", "Grand Total", "Purchase Total", "Total PO Cost". If only line subtotals are shown, sum them.

INPUT FORMAT
The document text you receive comes from a layout-preserving PDF parser, and at the bottom of each page you may see a section like:
  === STRUCTURED TABLES (use these for line items if visible) ===
  [TABLE 1]
  | Line | Part #  | Description | Qty | Unit Price | Total |
  | 1    | X-1234  | Widget A    | 5   | 10.00      | 50.00 |
  ...
When a [TABLE N] block is present, treat IT as the authoritative source for line items — it's the parser's structured view of the same table that may have been flattened into prose above. Header blocks (VENDOR / SHIP TO / BILL TO / BUYER) should still be read from the layout-preserved body text, not from tables.

COLUMN LAYOUT HINT (text mode)
The body text is whitespace-aligned to the original column layout. Related blocks may appear on the SAME LINE with significant whitespace between them — e.g.
  "VENDOR:  COOPER LIGHTING               SHIP TO:  TARHEEL ELECTRIC"
Treat the whitespace as a column boundary; the left column is the supplier block and the right column is the ship-to block. Do not concatenate their addresses. If the columns drift onto different vertical positions further down (one column has more lines than the other), stay aligned with the original column boundary, not with the visual row.

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

  /**
   * Hybrid extraction — sends BOTH the layout-preserved text AND the
   * rendered page images to Gemini in ONE call. The model uses the text
   * for clean character values (no OCR errors) and the images for
   * spatial layout grounding (which block is which column).
   *
   * Always uses gemini-2.5-flash even if the rep has Flash-Lite selected
   * for plain text extraction — Lite's vision is too weak to be useful
   * for layout grounding.
   *
   * Roughly 1.5× the cost of text-only (3 images at scale 2.0 add ~2.3K
   * input tokens to the existing ~5K of text). Eliminates most of the
   * column-confusion errors we saw on Ariba layouts (Apex / Duke where
   * supplier address vs ship-to address got swapped).
   */
  async function extractWithHybrid(documentText, pageImages, { apiKey, apiKeys, model, signal, maxTokens = 8192 } = {}) {
    if (!documentText || documentText.length < 20) {
      throw new Error('No text could be read from this document.');
    }
    if (!pageImages || pageImages.length === 0) {
      // Degrade to text-only rather than fail — caller chose hybrid but
      // rendering didn't work for some reason.
      return extractWithLLM(documentText, { apiKey, apiKeys, model, signal, maxTokens });
    }
    const keys = (Array.isArray(apiKeys) && apiKeys.length) ? apiKeys : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new Error('No Gemini API key configured.');

    const hybridModel = (!model || model === 'gemini-2.5-flash-lite')
      ? 'gemini-2.5-flash'
      : model;

    const MAX_CHARS = 500000;
    const trimmed = documentText.length > MAX_CHARS
      ? documentText.slice(0, MAX_CHARS) + '\n\n[document truncated for length]'
      : documentText;

    // Build a single user turn with text + each page image inline.
    // The leading text tells Gemini how to use the two views together.
    const parts = [{
      text:
        'You are given BOTH the parsed text of this PO AND the rendered page images. ' +
        'Use the text for clean character values (it has no OCR errors). ' +
        'Use the images for spatial layout — which block is in which column, ' +
        'which lines belong together visually, where the supplier ends and the ship-to begins. ' +
        'Cross-check: if the text suggests two values belong to the same field but the image shows ' +
        'they are in different columns, trust the image for that judgment.\n\n' +
        '=== PARSED TEXT ===\n\n' + trimmed +
        '\n\n=== PAGE IMAGES ===',
    }];
    for (const url of pageImages) {
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
      const text = await _callGemini(hybridModel, k, body, signal);
      return _parseJson(text);
    });
  }

  async function extractWithVision(pageImages, { apiKey, apiKeys, model, signal, maxTokens = 8192 } = {}) {
    if (!pageImages || pageImages.length === 0) {
      throw new Error('No page images supplied for vision extraction.');
    }
    const keys = (Array.isArray(apiKeys) && apiKeys.length) ? apiKeys : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new Error('No Gemini API key configured.');

    // Force gemini-2.5-flash for vision. Flash-Lite produces empty / near-
    // empty extractions for industrial POs — its OCR is too weak. If the
    // rep has Lite selected for text, we still upgrade to Flash for the
    // vision call. Pro is a valid override; anything else gets promoted.
    const visionModel = (!model || model === 'gemini-2.5-flash-lite')
      ? 'gemini-2.5-flash'
      : model;

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
      const text = await _callGemini(visionModel, k, body, signal);
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
  window.App.gemini = { extractWithLLM, extractWithHybrid, extractWithVision, pingLLM };
})();
