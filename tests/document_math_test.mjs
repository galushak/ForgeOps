import assert from 'node:assert/strict';

import {
  calculateInvoiceTotals,
  calculateQuoteDraftTotals,
  calculateQuoteTotals,
  QUOTE_MARKUP_NAME,
} from '../app/static/js/document-math.js';

const quoteItems = [
  {kind:'equipment', name:'Taxable hardware', line_total:'100.00', taxable:true},
  {kind:'equipment', name:'Non-taxable equipment', line_total:'50.00', taxable:false},
  {kind:'fee', name:'Delivery', line_total:'10.00', taxable:true},
  {kind:'labor', name:'Installation', line_total:'200.00', taxable:false},
];
const draft = calculateQuoteDraftTotals(quoteItems, 0.07, 10);
assert.equal(draft.equipmentSubtotal, 150);
assert.equal(draft.taxableEquipmentSubtotal, 100);
assert.equal(draft.vendorFeesTotal, 10);
assert.ok(Math.abs(draft.tax - 7.7) < 1e-9);
assert.ok(Math.abs(draft.markupBase - 167.7) < 1e-9);
assert.ok(Math.abs(draft.markup - 16.77) < 1e-9);
assert.equal(draft.laborTotal, 200);

const saved = calculateQuoteTotals([
  ...quoteItems,
  {kind:'fee', name:QUOTE_MARKUP_NAME, line_total:'16.77', taxable:false},
], 0.07);
assert.ok(Math.abs(saved.total - 384.47) < 1e-9);

const invoice = calculateInvoiceTotals({
  laborTotal:100,
  salesTaxRate:0.07,
  lineItems:[
    {kind:'material', line_total:'50.00'},
    {kind:'vendor_fee', line_total:'10.00'},
  ],
});
assert.equal(invoice.subtotal, 160);
assert.ok(Math.abs(invoice.tax - 11.2) < 1e-9);
assert.ok(Math.abs(invoice.total - 171.2) < 1e-9);

console.log('quote and invoice vendor fee calculations passed');
