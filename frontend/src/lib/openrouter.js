/* ==========================================================================
   openrouter.js — Real LLM call against OpenRouter. Sends extracted PDF text,
   gets back a JSON object matching our PO schema.
   ========================================================================== */
(() => {
  'use strict';

  const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

  const SYSTEM_PROMPT = `You are a precise data extraction tool for purchase orders (POs).
Extract structured data into ONE JSON object that strictly matches the schema. No markdown fences, no commentary, no chain-of-thought before the JSON.

████ HARD RULES — VIOLATIONS BREAK DOWNSTREAM SOFTWARE ████

  R1. **MISSING means empty string.** If a field is not on the document,
      output "" — never "N/A", "TBD", "None", "Not Available", "Unknown",
      "—", or any human-style placeholder. The downstream UI renders
      empty as a soft dash; a literal "N/A" would be saved as data.
      Wrong: ship_via = "N/A"   Right: ship_via = ""
      Wrong: fob_terms = "None"  Right: fob_terms = ""

  R2. **PRESERVE EVERY LINE of a multi-line address.** When a supplier
      block reads:
          ALLIED COMPONENTS INC
          C/O LEKSON ASSOCIATES INC
          4004-105 BARRETT DRIVE
          RALEIGH NC 27609 USA
      the supplier_address field MUST be every line joined with \\n
      after the company name is split off into \`supplier\`. Never collapse
      to just the first line. Never drop the "C/O ..." routing line.
      Same rule for customer_address, ship_to, bill_to.

  R3. **PRESERVE ORIGINAL CASE for names + IDs.** If the PO prints
      "FRANK WILSON" (all caps), output "FRANK WILSON" — do not
      title-case to "Frank Wilson". If it prints "Cooper Lighting", keep
      that case. Same for company names, part numbers, addresses.
      Case-normalization is a downstream concern, not yours.

  R4. **NEVER invent fields the schema doesn't have.** Don't add
      "shipping_method", "po_total", "tax", or any other key.
      Stay strictly inside the OUTPUT SCHEMA at the bottom.

  R5. **NEVER repeat the description in line-item notes.** Notes are
      for instructions specific to that line (e.g. "30 PER PALLET",
      "Ship by 5/18/2026") — not a duplicate of the description.

  R6. The customer is the entity ACTUALLY ISSUING the PO (the logo /
      letterhead). "Agent for X" / "On behalf of Y" wording does NOT
      make X or Y the customer. See "WESCO-style agent POs" below for
      the canonical example.

████████████████████████████████████████████████████████████

FORMATTING
- Empty string "" for missing strings; 0 for missing numbers (see R1 above).
- Dates: YYYY-MM-DD (convert from any format, including MM/DD/YYYY and DD/MM/YY).
- Numbers: plain decimals — no currency symbols, no thousands commas, no $ or USD inline.
- Multi-line addresses + notes: preserve line breaks as \\n (see R2 above).
- Case: preserve exactly as printed (see R3 above).

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
2. If the PO has "Agent for X" / "On behalf of Y" wording, the customer is the entity ACTUALLY ISSUING the PO (the agent name on the logo) — X / Y are principals, not the customer. See "WESCO-style agent POs" below.
3. The text may have garbled-looking characters that are actually TWO strings overlaid (templates do this for placeholder + real value). If you see something like "DAPEGF PPuurrcchhaassiinngg CCoommppaannyy" or "SAELFLCIEODR INC", that's two strings interleaved letter-by-letter — pick the one a human reader would see (typically the value, not the italic placeholder). For "DAPEGF" output "APG"; for "SAELFLCIEODR" output "ALLIED" (or "SEFCOR" — pick whichever is non-italic / drawn on top).
4. buyer = a person's name. Don't put a company in buyer.
5. buyer_email = the buyer's personal email. Do NOT use generic invoicing addresses like "TEMA.INVOICES@…" or "ap@…" or "SCSInvoices@…" — those go nowhere useful; leave buyer_email as "" if no personal email is shown.

WESCO-STYLE AGENT POs (Meridian Supply / Wesco Distribution issuing on behalf of Apex / Duke / etc.)
  These POs have THREE company names in the header area, in this order:
    (1) The ACTUAL ISSUER — Wesco logo + letterhead at the top → customer
    (2) "Acting as an Agent for ..." — a principal Wesco represents → NOT extracted as a separate field; flows into the customer string as a suffix
    (3) The supplier in the VENDOR/SHIP TO block → supplier
  The customer field stores the issuer + agent-for clause as ONE string. The supplier is whoever fills the order.
  Worked example (Meridian / Wesco PO):
    Header:    "WESCO Distribution, Inc Meridian Supply Co. Acting as an Agent for Duke Energy Corporation"
    Vendor:    "SEFCOR INC ALLIED COMPONENTS INC C/O LEKSON ASSOCIATES INC"
    Ship to:   "Apex Power Group Corp ..."
    Correct mapping:
      customer        = "WESCO Distribution, Inc Meridian Supply Co. Acting as an Agent for Duke Energy Corporation"
      supplier        = "ALLIED COMPONENTS INC"        ← human-readable line on top
      supplier_address = "C/O LEKSON ASSOCIATES INC\\n<full multi-line>"
      ship_to         = "Apex Power Group Corp\\n<full multi-line>"
  WRONG: customer = "Meridian Supply Co." alone (drops the issuer)
  WRONG: supplier = "SEFCOR INC ALLIED COMPONENTS INC" (concatenated; pick one)
  WRONG: supplier_address = "ALLIED COMPONENTS INC" alone (drops the multi-line address)

LINE ITEMS

DESCRIPTION IS THE ONLY FIELD FOR PARTS + PRODUCT TEXT
The "description" field is the SINGLE source of truth for every line.
**ALWAYS** put every part identifier, model number, catalog code, AND
the actual product description into THIS ONE field, in the order they
appear on the page. Do NOT split anything off into customer_part /
vendor_part — those two fields must always be returned as empty
strings ("") in the schema.

What goes inside \`description\`:
  - Item # / Stock Code / Customer Part # / Buyer Part #
  - Mfr Part # / Vendor Part # / Mfr Model # / Catalog # / Manufacturer Part Number
  - Santee Cooper PN / customer-specified principal part #
  - "PLEASE FURNISH #" continuation codes
  - any extra Cat #, model #, drawing #, U-number
  - then " — " (space hyphen space) and the human-readable product description

Worked example (TEMA):
  Raw line in the doc:
    1   450 EA  39004430              145.5000 EA    65,475.00
                CRTKAA08E120510KTHVAU0037
                SEC LGT HEAD ONLY 29W LED
                PLEASE FURNISH #
                CRTK2-C016-D-U-T5R-U0-TH-4N7-10MSP-V-A-10
                X-U126120.
  Output:
    description    = "39004430 CRTKAA08E120510KTHVAU0037 CRTK2-C016-D-U-T5R-U0-TH-4N7-10MSP-V-A-10 X-U126120 — SEC LGT HEAD ONLY 29W LED"
    customer_part  = ""
    vendor_part    = ""

The schema keeps customer_part and vendor_part for backwards compatibility
with existing rows, but new extractions MUST leave them empty. The UI
treats \`description\` as the only line-identity field.

OTHER LINE FIELDS

⚠️ QUANTITY, UNIT_PRICE, and AMOUNT are CRITICAL — they drive the rep's invoice math. Never return 0 for any of these unless the document literally shows a blank or zero. If you see two of the three (e.g. only quantity and amount) compute the third yourself rather than leaving it at 0. The values must satisfy quantity × unit_price = amount within rounding tolerance.

- "quantity" — plain number. Look for the column literally labeled "Qty", "Quantity", "Order Quantity", "Order Qty". On Wesco/Meridian layouts it's the SECOND column of the line items table (right after Line #); on Ariba it appears between Contract Ref # and Units; on TEMA it's between LINE and UOM. If the doc shows "12 BX" the quantity is 12 and the uom is "BX". Never put 0 in quantity if the line clearly shows a real number — when in doubt, derive it from amount ÷ unit_price.
- "unit_price" — same rule. Labels include "Unit Price", "Unit Cost", "Net Quoted Price", "Price", "Net". Plain decimal, no $ sign or thousands commas.
- "amount" (a.k.a. "Extension", "Extended", "Line Cost", "Net", "Total") — same rule. Must equal quantity × unit_price within ±$0.50.
- "uom" (a.k.a. "Qty UM", "Units", "U/M"): Use the EXACT unit shown on the document — EA, BX, CS, LT, FT, M, LB, KG, RL, PK, PR, etc. If the doc shows "BX" use "BX", never normalize to "EA". Only fall back to "EA" when NO unit is shown anywhere on the line.
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

PRE-FLIGHT CHECKLIST — silently validate BEFORE emitting JSON
  □  Every missing field is "" — no "N/A", "TBD", "None", "Unknown".
  □  customer_address / supplier_address / bill_to / ship_to preserve every
     line of the printed block, joined with \\n. None truncated to the
     first line.
  □  customer is the issuer (logo / letterhead), not an "agent for" or
     "on behalf of" name buried in the body.
  □  supplier is ONE company name — not two concatenated.
  □  buyer is a person's name, not a company.
  □  Every line item's quantity × unit_price ≈ amount (within $0.50).
  □  Original case preserved for all names (no auto-title-casing).
  □  No fields added that aren't in the schema below.
  □  No commentary, no "Here is the extracted data:", no fenced code
     blocks. Output is RAW JSON only, opening with { and closing with }.

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
