import assert from 'node:assert/strict';

import {
  duplicateInvoiceDialogOptions,
  startQuoteInvoiceDecision,
} from '../app/static/js/quote-invoice-flow.js';

const quote = {id: 42, client_id: 7, project_id: 11};

let warningCalls = 0;
let openedContexts = [];
const noDuplicate = await startQuoteInvoiceDecision({
  quote,
  loadLinkedInvoices: async quoteId => {
    assert.equal(quoteId, 42);
    return [];
  },
  confirmDuplicate: async () => {
    warningCalls += 1;
    return false;
  },
  openEditor: async context => openedContexts.push(context),
});
assert.equal(noDuplicate.opened, true);
assert.equal(warningCalls, 0);
assert.deepEqual(openedContexts, [{clientId: 7, projectId: 11, quoteId: 42}]);

let settleConfirmation;
let editorOpenedBeforeDecision = false;
let capturedDialog;
const pendingDecision = startQuoteInvoiceDecision({
  quote,
  loadLinkedInvoices: async () => [{id: 1, invoice_number: 'FS-INV-ONE'}],
  confirmDuplicate: async options => {
    capturedDialog = options;
    return new Promise(resolve => { settleConfirmation = resolve; });
  },
  openEditor: async () => { editorOpenedBeforeDecision = true; },
});
await Promise.resolve();
await Promise.resolve();
assert.equal(editorOpenedBeforeDecision, false);
assert.equal(capturedDialog.title, 'Invoice Already Exists');
assert.match(capturedDialog.message, /FS-INV-ONE/);
settleConfirmation(false);
const cancelled = await pendingDecision;
assert.equal(cancelled.opened, false);
assert.equal(editorOpenedBeforeDecision, false);

let escapeOpened = false;
const escaped = await startQuoteInvoiceDecision({
  quote,
  loadLinkedInvoices: async () => [{id: 2, invoice_number: 'FS-INV-ESCAPE'}],
  confirmDuplicate: async () => false,
  openEditor: async () => { escapeOpened = true; },
});
assert.equal(escaped.opened, false);
assert.equal(escapeOpened, false);

openedContexts = [];
const confirmed = await startQuoteInvoiceDecision({
  quote,
  loadLinkedInvoices: async () => [{id: 3, invoice_number: 'FS-INV-EXISTING'}],
  confirmDuplicate: async () => true,
  openEditor: async context => openedContexts.push(context),
});
assert.equal(confirmed.opened, true);
assert.deepEqual(openedContexts, [{clientId: 7, projectId: 11, quoteId: 42}]);
assert.deepEqual(Object.keys(openedContexts[0]).sort(), ['clientId', 'projectId', 'quoteId']);

const multiple = duplicateInvoiceDialogOptions([
  {invoice_number: 'FS-INV-FIRST'},
  {invoice_number: 'FS-INV-SECOND'},
]);
assert.match(multiple.message, /FS-INV-FIRST/);
assert.match(multiple.message, /FS-INV-SECOND/);
assert.equal(multiple.primaryButtonText, 'Create Another Invoice');
assert.equal(multiple.cancelButtonText, 'Cancel');

console.log('quote invoice duplicate decision tests passed');
