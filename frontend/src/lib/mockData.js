/* ==========================================================================
   mockData.js — Sample extractions for the 3 PDFs in the parent directory.
   Will be replaced by the real LLM extractor once Streamlit is wired up.
   ========================================================================== */
(() => {
  'use strict';

  const SAMPLES = {
    meridian: {
      po_number: '13214085',
      po_date: '2026-04-02',
      revision: '0',
      customer: 'Meridian Supply Co.',
      customer_address: '5521 Lakeview Road Suite W, Charlotte, NC 28269',
      supplier: 'Allied Components Inc',
      supplier_address: 'C/O Lekson Associates Inc, 4004-105 Barrett Dr, Raleigh, NC 27609',
      bill_to: 'Meridian Supply Co.\n5521 Lakeview Road Suite W\nCharlotte, NC 28269',
      ship_to: "OBrien Distribution Ctr - Florida\n19800 S OBrien Rd Unit 101\nGroveland, FL 34736-8580",
      payment_terms: 'Net 45',
      buyer: 'Debbie Caldwell',
      buyer_email: 'Debbie.Caldwell@duke-energy.com',
      currency: 'USD',
      line_items: [
        {
          line: 1,
          customer_part: '4005342',
          vendor_part: 'SNFT-36-4A-TP',
          description: 'CONNECTOR, ELECTRICAL, STUD, 1-1/4" STUD DIA, (4) HOLE PAD CONDUCTOR, 12THRD',
          quantity: 15,
          uom: 'E',
          unit_price: 95.50,
          amount: 1432.50,
          required_date: '2026-10-12',
        },
      ],
      total: 1432.50,
      confidence: {
        high: ['po_number', 'po_date', 'customer', 'supplier', 'payment_terms', 'total', 'buyer'],
        medium: ['ship_to', 'bill_to'],
        low: [],
      },
    },

    summit: {
      po_number: '115835-00',
      po_date: '2026-03-20',
      revision: '00',
      customer: 'Summit Industrial Corp',
      customer_address: '5410 Fallowater Lane, Roanoke, VA 24018',
      supplier: 'National Grid Supplies Inc',
      supplier_address: '4240 Army Post Road, Des Moines, IA 50321',
      bill_to: '',
      ship_to: 'Summit Industrial Corp.\n252 Industrial Park Road\nDuffield, VA 24244',
      payment_terms: 'Net 30',
      buyer: 'JB',
      confirming_to: 'Amanda',
      currency: 'USD',
      line_items: [
        { line: 1, vendor_part: 'VFP-40-3045-001 Rev 000', description: 'RLY PNL ASSY, PANEL 1', quantity: 1, uom: 'EA', unit_price: 85462.00, amount: 85462.00, required_date: '2026-08-24' },
        { line: 2, vendor_part: 'VFP-40-3045-002 Rev 000', description: 'RLY PNL ASSY, PANEL 2', quantity: 1, uom: 'EA', unit_price: 59296.00, amount: 59296.00, required_date: '2026-08-24' },
        { line: 3, vendor_part: 'VFP-40-3045-003 Rev 000', description: 'RLY PNL ASSY, PANEL 3', quantity: 1, uom: 'EA', unit_price: 46109.00, amount: 46109.00, required_date: '2026-08-24' },
        { line: 4, vendor_part: 'VFP-40-3045-004 Rev 000', description: 'RLY PNL ASSY, PANEL 4', quantity: 1, uom: 'EA', unit_price: 51034.00, amount: 51034.00, required_date: '2026-08-24' },
        { line: 5, vendor_part: 'VFP-40-3045-005 Rev 000', description: 'RLY PNL ASSY, PANEL 5', quantity: 1, uom: 'EA', unit_price: 51501.00, amount: 51501.00, required_date: '2026-08-24' },
        { line: 6, vendor_part: 'VFP-40-3045-006 Rev 000', description: 'RLY PNL ASSY, PANEL 6', quantity: 1, uom: 'EA', unit_price: 44414.00, amount: 44414.00, required_date: '2026-08-24' },
        { line: 7, vendor_part: 'VFP-40-3045-007 Rev 000', description: 'RLY PNL ASSY, PANEL 7', quantity: 1, uom: 'EA', unit_price: 42078.00, amount: 42078.00, required_date: '2026-08-24' },
        { line: 8, vendor_part: 'VFP-40-3045-008 Rev 000', description: 'RLY PNL ASSY, PANEL 8', quantity: 1, uom: 'EA', unit_price: 42167.00, amount: 42167.00, required_date: '2026-08-24' },
        { line: 9, vendor_part: 'VFP-40-3045-009 Rev 000', description: 'RLY PNL ASSY, PANEL 9', quantity: 1, uom: 'EA', unit_price: 83987.00, amount: 83987.00, required_date: '2026-08-24' },
        { line: 10, vendor_part: 'VFP-40-3045-010 Rev 000', description: 'RLY PNL ASSY, PANEL 10', quantity: 1, uom: 'EA', unit_price: 11984.00, amount: 11984.00, required_date: '2026-08-24' },
        { line: 11, vendor_part: 'VFP-40-3045-011 Rev 000', description: 'RLY PNL ASSY, TERMINATION CABINET', quantity: 1, uom: 'EA', unit_price: 10917.00, amount: 10917.00, required_date: '2026-08-24' },
        { line: 12, vendor_part: 'VFP-40-3045-012 Rev 000', description: 'RLY PNL ASSY, BESS TERMINATION CAB', quantity: 1, uom: 'EA', unit_price: 9224.00, amount: 9224.00, required_date: '2026-08-24' },
        { line: 13, vendor_part: 'VFP-FREIGHT', description: 'FREIGHT IN TO DUFFIELD', quantity: 1, uom: 'EA', unit_price: 2837.00, amount: 2837.00, required_date: '2026-08-24' },
      ],
      total: 541010.00,
      confidence: {
        high: ['po_number', 'po_date', 'supplier', 'total', 'payment_terms'],
        medium: ['customer'],
        low: ['bill_to'],
      },
    },

    apex: {
      po_number: '13213236',
      po_date: '2026-04-01',
      revision: '0',
      customer: 'Apex Power Group',
      customer_address: 'APG Purchasing Company, LLC',
      supplier: 'Triton Fabricators Inc',
      supplier_address: 'C/O Lekson & Assoc, 4004-105 Barrett Drive, Raleigh, NC 27609',
      bill_to: '',
      ship_to: "OBrien Distribution Ctr - Florida\n19800 South O'Brien Rd Unit 101\nGroveland, FL 34736",
      payment_terms: 'Net 30',
      buyer: 'Joshua N. Ashley',
      buyer_email: 'Joshua.Ashley@duke-energy.com',
      currency: 'USD',
      line_items: [
        {
          line: 1,
          customer_part: '4002005',
          vendor_part: '1MH1030H50A',
          description: 'BRACKET, MOUNTING, 10\' X 30" RISE, ALUM, W/ 5-9/16" OD HUB MOUNT ARM, HORZ ARM HUB, BARE ALUM FINISH; F/ POLE TOP BOLT-ON, F/ 26\' & 36\' ALUM STREETLIGHT POLE',
          quantity: 16,
          uom: 'EA',
          unit_price: 952.00,
          amount: 15232.00,
          required_date: '2026-09-05',
        },
      ],
      total: 15232.00,
      confidence: {
        high: ['po_number', 'po_date', 'customer', 'supplier', 'total'],
        medium: ['payment_terms', 'buyer'],
        low: ['bill_to'],
      },
    },
  };

  function makeBlankExtraction() {
    const today = new Date();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return {
      po_number: '',
      po_date: `${today.getFullYear()}-${m}-${d}`,
      revision: '',
      customer: '',
      customer_address: '',
      supplier: '',
      supplier_address: '',
      bill_to: '',
      ship_to: '',
      payment_terms: '',
      buyer: '',
      currency: 'USD',
      line_items: [
        { line: 1, customer_part: '', vendor_part: '', description: '', quantity: 1, uom: 'EA', unit_price: 0, amount: 0, required_date: '' },
      ],
      total: 0,
      confidence: { high: [], medium: [], low: ['po_number', 'customer', 'supplier'] },
    };
  }

  window.App = window.App || {};
  window.App.mockData = { SAMPLES, makeBlankExtraction };
})();
