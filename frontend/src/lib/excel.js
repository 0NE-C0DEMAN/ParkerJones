/* ==========================================================================
   excel.js — Two-sheet XLSX export via SheetJS (loaded as global XLSX).
   ========================================================================== */
(() => {
  'use strict';

  function downloadLedgerXlsx(records, filename = 'po_ledger.xlsx') {
    if (!window.XLSX) {
      console.error('SheetJS (XLSX) not loaded');
      throw new Error('Excel library not available');
    }
    const XLSX = window.XLSX;

    const poRows = records.map((r) => ({
      'PO Number': r.po_number,
      'PO Date': r.po_date,
      'Customer': r.customer,
      'Supplier': r.supplier,
      'Bill To': flatten(r.bill_to),
      'Ship To': flatten(r.ship_to),
      'Payment Terms': r.payment_terms,
      'Buyer': r.buyer,
      'Line Items': (r.line_items || []).length,
      'Total': r.total,
      'Currency': r.currency || 'USD',
      'Source File': r.filename || '',
      'Added': r.addedAt || '',
    }));

    const lineRows = [];
    records.forEach((r) => {
      (r.line_items || []).forEach((it) => {
        lineRows.push({
          'PO Number': r.po_number,
          'Customer': r.customer,
          'Supplier': r.supplier,
          'Line': it.line,
          'Customer Part': it.customer_part || '',
          'Vendor Part': it.vendor_part || '',
          'Description': it.description,
          'Quantity': it.quantity,
          'UOM': it.uom,
          'Unit Price': it.unit_price,
          'Amount': it.amount,
          'Required Date': it.required_date,
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const wsPOs = XLSX.utils.json_to_sheet(poRows.length ? poRows : [{}]);
    const wsLines = XLSX.utils.json_to_sheet(lineRows.length ? lineRows : [{}]);

    wsPOs['!cols'] = [
      { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 36 }, { wch: 36 },
      { wch: 14 }, { wch: 18 }, { wch: 11 }, { wch: 14 }, { wch: 8 }, { wch: 28 }, { wch: 18 },
    ];
    wsLines['!cols'] = [
      { wch: 14 }, { wch: 24 }, { wch: 24 }, { wch: 6 }, { wch: 14 }, { wch: 18 }, { wch: 40 },
      { wch: 9 }, { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
    ];

    XLSX.utils.book_append_sheet(wb, wsPOs, 'Purchase Orders');
    XLSX.utils.book_append_sheet(wb, wsLines, 'Line Items');
    XLSX.writeFile(wb, filename);
  }

  function flatten(s) {
    if (!s) return '';
    return String(s).replace(/\n+/g, ' · ').trim();
  }

  window.App = window.App || {};
  window.App.excel = { downloadLedgerXlsx };
})();
