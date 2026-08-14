import assert from 'node:assert/strict';

import { createDialogSettlement, normalizeDialogOptions } from '../app/static/js/app-dialog.js';

const destructive = normalizeDialogOptions({
  title: 'Delete Record?',
  message: 'This cannot be undone.',
  kind: 'destructive',
  showCancel: true,
  primaryButtonText: 'Delete',
});
assert.equal(destructive.kind, 'destructive');
assert.equal(destructive.showCancel, true);
assert.equal(destructive.cancelButtonText, 'Cancel');
assert.equal(destructive.allowEscape, true);
assert.equal(destructive.primaryButtonText, 'Delete');

const notice = normalizeDialogOptions({message: 'Popup blocked.', kind: 'warning'});
assert.equal(notice.kind, 'warning');
assert.equal(notice.showCancel, false);
assert.equal(notice.primaryButtonText, 'OK');

const resolutions = [];
const settle = createDialogSettlement(value => resolutions.push(value));
assert.equal(settle(true), true);
assert.equal(settle(false), false);
assert.equal(settle(true), false);
assert.deepEqual(resolutions, [true]);

const cancellations = [];
const cancelSettlement = createDialogSettlement(value => cancellations.push(value));
assert.equal(cancelSettlement(false), true);
assert.equal(cancelSettlement(true), false);
assert.deepEqual(cancellations, [false]);

console.log('app dialog state tests passed');
