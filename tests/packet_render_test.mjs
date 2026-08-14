import assert from 'node:assert/strict';

import {
  clientAdminPacketHtml,
  projectAdminGroupHtml,
  projectClientPacketHtml,
} from '../app/static/js/packet-renderers.js';

const internalValues = {
  ledgerDescription: 'PRIVATE_LEDGER_DESCRIPTION_7B12',
  expenseCategory: 'PRIVATE_COGS_CATEGORY_28F4',
  laborNote: 'PRIVATE_LABOR_NOTE_93AD',
  receiptFilename: 'PRIVATE_VENDOR_RECEIPT_51C8.pdf',
  clientNote: 'PRIVATE_CLIENT_NOTE_17E2',
  projectNote: 'PRIVATE_PROJECT_NOTE_64AA',
  salesTaxPayment: 'PRIVATE_SALES_TAX_PAID_42D0',
};

const client = {id: 10, name: 'Packet Client Alpha', notes: internalValues.clientNote};
const project = {id: 20, name: 'Packet Project Alpha', status: 'In Progress', site_address: '10 Packet Way', start_date: '2026-01-10', completed_date: null, notes:internalValues.projectNote};
const clientCopy = projectClientPacketHtml({
  businessName:'Forged Systems LLC',
  client,
  project,
  quoteSections:['<section>EXPECTED_CLIENT_QUOTE_Q-100</section>'],
  invoiceSections:['<section>EXPECTED_CLIENT_INVOICE_I-100</section>'],
  generatedAt:'Aug 14, 2026',
  ledger:[{description:internalValues.ledgerDescription, category:internalValues.expenseCategory}],
  labor:[{notes:internalValues.laborNote}],
  receipts:[{original_filename:internalValues.receiptFilename}],
  salesTaxPayment:internalValues.salesTaxPayment,
});

assert.match(clientCopy, /Project Packet — Client Copy/);
assert.match(clientCopy, /EXPECTED_CLIENT_QUOTE_Q-100/);
assert.match(clientCopy, /EXPECTED_CLIENT_INVOICE_I-100/);
assert.doesNotMatch(clientCopy, /INTERNAL \/ ADMIN COPY/);
for (const value of Object.values(internalValues)) assert.equal(clientCopy.includes(value), false, value);

const projectAdmin = projectAdminGroupHtml({
  businessName:'Forged Systems LLC',
  client,
  project,
  generatedAt:'Aug 14, 2026',
  includeCover:true,
  summaryHtml:`<section>${internalValues.projectNote}</section>`,
  quoteSections:['<section>ADMIN_QUOTE_Q-100</section>'],
  invoiceSections:['<section>ADMIN_INVOICE_I-100</section>'],
  laborHtml:`<section>${internalValues.laborNote}</section>`,
  ledgerHtml:`<section>${internalValues.ledgerDescription}</section>`,
  receiptSections:[`<section>${internalValues.receiptFilename}</section>`],
});
assert.match(projectAdmin, /Project Packet — Admin Copy/);
assert.match(projectAdmin, /INTERNAL \/ ADMIN COPY/);
for (const value of [internalValues.projectNote, internalValues.laborNote, internalValues.ledgerDescription, internalValues.receiptFilename]) assert.match(projectAdmin, new RegExp(value));

const clientAdmin = clientAdminPacketHtml({
  businessName:'Forged Systems LLC',
  client,
  generatedAt:'Aug 14, 2026',
  summaryHtml:'<section>SELECTED_CLIENT_SUMMARY</section>',
  projectSections:[projectAdmin],
  unassignedHtml:'<section>SELECTED_CLIENT_UNASSIGNED_RECORD</section>',
  otherClient:{id:999, name:'UNRELATED_CLIENT_MUST_NOT_LEAK'},
});
assert.match(clientAdmin, /Client Packet — Admin Copy/);
assert.match(clientAdmin, /SELECTED_CLIENT_SUMMARY/);
assert.match(clientAdmin, /Packet Project Alpha/);
assert.match(clientAdmin, /SELECTED_CLIENT_UNASSIGNED_RECORD/);
assert.doesNotMatch(clientAdmin, /UNRELATED_CLIENT_MUST_NOT_LEAK/);

console.log('packet renderer privacy, inclusion, and isolation assertions passed');
