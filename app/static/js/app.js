import { clientAdminPacketHtml, projectAdminGroupHtml, projectClientPacketHtml } from './packet-renderers.js?v=0.8.12-print-packets';
import { calculateInvoiceTotals, calculateQuoteDraftTotals, calculateQuoteTotals, isQuoteMarkupItem, QUOTE_MARKUP_NAME, quoteVendorFeeItems } from './document-math.js?v=0.8.12-vendor-fees-terms';
import { createForgeOpsDialogController } from './app-dialog.js?v=0.8.12-app-dialogs';

const state = { page: 'dashboard', clients: [], projects: [], quotes: [], invoices: [], termsTemplates: [], addressesByClient: {}, dropdowns: { ledger_category: [], service_type: [] }, salesTaxPeriods: [], editing: null, clientDetailTab: 'overview', clientDetailId: null, clientStatusFilter: 'all', projectDetailTab: 'overview', projectDetailId: null, projectStatusFilter: 'all', projectClientFilter: 'all', quoteStatusFilter: 'all', quoteClientFilter: 'all', quoteReturnFocusSelector: '', invoiceStatusFilter: 'all', invoiceClientFilter: 'all', invoiceReturnFocusSelector: '', laborStatusFilter: 'all', laborClientFilter: 'all', laborProjectFilter: 'all', laborBillingFilter: 'all', laborReturnFocusSelector: '', ledgerKindFilter: 'all', ledgerCategoryFilter: 'all', ledgerClientFilter: 'all', ledgerYearFilter: 'all', ledgerReturnFocusSelector: '', reportMode: 'year', reportYear: '', reportMonth: '', reportQuarter: '1', reportStart: '', reportEnd: '', user: null, lookupCacheAt: 0, lookupCachePromise: null };
const root = document.querySelector('#pageRoot');
const messages = document.querySelector('#messages');
const loginError = document.querySelector('#loginError');
const setupError = document.querySelector('#setupError');
const forgeOpsDialogs = createForgeOpsDialogController(document);

function askForgeOpsDialog(options) {
  return forgeOpsDialogs.ask(options);
}

function showForgeOpsNotice({title='ForgeOps Notice', message='', kind='info', primaryButtonText='OK'} = {}) {
  return forgeOpsDialogs.notice({title, message, kind, primaryButtonText});
}

function showForgeOpsError(error, fallback='Unable to complete that action.') {
  const message = String(error?.message || error || fallback);
  return showForgeOpsNotice({title:'Unable to Complete Action', message, kind:'warning'});
}
const DEFAULT_QUOTE_TERMS = `Full payment for equipment is due upfront prior to ordering hardware.
Labor is billed after work is completed and is subject to change.
Two (2) hour minimum labor charge applies.
Additional labor beyond estimate will be billed at the standard hourly rate.
This quote is valid for 30 days from the date issued. Pricing and availability of equipment are subject to change after this period.`;
const DEFAULT_INVOICE_TERMS = `Payment due upon receipt of this invoice.`;
const KNOWN_BAD_QUOTE_TERMS = new Set([
  '',
  'Equipment due up front. Labor due after completion.',
  'Payment due upon receipt of this invoice.',
  'Payment is due upon receipt of this invoice.',
  'Payment is due upon receipt of this invoice.\n\nLabor billed at the agreed rate shown above. Additional work or future project phases will be quoted separately.',
]);

function normalizedText(value) { return String(value ?? '').replace(/\r\n/g, '\n').trim(); }
function quoteTermsValue(recordTerms, settingTerms) {
  const current = normalizedText(recordTerms);
  if (KNOWN_BAD_QUOTE_TERMS.has(current)) {
    const setting = normalizedText(settingTerms);
    return KNOWN_BAD_QUOTE_TERMS.has(setting) ? DEFAULT_QUOTE_TERMS : setting;
  }
  return current;
}
function invoiceTermsValue(recordTerms, settingTerms) {
  const current = normalizedText(recordTerms);
  if (current) return current;
  const setting = normalizedText(settingTerms);
  return setting || DEFAULT_INVOICE_TERMS;
}
function termsTemplateOptions(templates=[], appliesTo='quote') {
  return templates
    .filter(template => template.applies_to === appliesTo || template.applies_to === 'both')
    .map(template => `<option value="${Number(template.id)}">${escapeHtml(template.name)}</option>`)
    .join('');
}
function savedTermsControlHtml({templates=[], appliesTo='quote', formId=''}) {
  const selectId = `${formId}SavedTerms`;
  return `<div class="saved-terms-control">
    <label for="${selectId}">Saved Terms</label>
    <div><select id="${selectId}" data-saved-terms-select><option value="">Select saved terms...</option>${termsTemplateOptions(templates, appliesTo)}</select><button class="ghost" type="button" data-apply-saved-terms disabled>Apply</button></div>
    <small>Apply copies this text into the document. You can edit it before saving.</small>
  </div>`;
}
function wireTermsTemplateApply(container, formId, templates=[]) {
  const form = container.querySelector(`#${formId}`);
  const select = form?.querySelector('[data-saved-terms-select]');
  const button = form?.querySelector('[data-apply-saved-terms]');
  const textarea = form?.querySelector('[name="terms"]');
  if (!select || !button || !textarea) return;
  select.addEventListener('change', () => { button.disabled = !select.value; });
  button.addEventListener('click', () => {
    const template = templates.find(item => Number(item.id) === Number(select.value));
    if (!template) return;
    textarea.value = template.content;
    textarea.dispatchEvent(new Event('input', {bubbles:true}));
    textarea.focus();
  });
}


const LEDGER_CATEGORIES_BY_TYPE = {
  income: ['Services', 'Installation', 'Sales of Product', 'Computer Parts & Accessories', 'Networking Parts & Accessories', 'Security Parts & Accessories'],
  cogs: ['Cost of Goods Sold', 'CGS Computer Parts & Accessories', 'CGS Networking Parts & Accessories', 'CGS Security Parts & Accessories', 'CGS Software & Apps'],
  expense: ['General Business Expense', 'Tools and Equipment', 'Office Supplies', 'Sales Tax Paid', 'Income Tax Paid'],
};
const TAX_PAYMENT_CATEGORIES = new Set(['Sales Tax Paid', 'Sales Tax', 'Income Tax Paid', 'Income Tax']);
const SALES_TAX_PERIOD_CATEGORY = 'Sales Tax Paid';
const SALES_TAX_QUARTERS = [1, 2, 3, 4];
function normalizeLedgerKind(value) { return value === 'revenue' ? 'income' : (value || 'income'); }
function ledgerCategoryOptions(kind, selected='') {
  const normalized = normalizeLedgerKind(kind);
  return (LEDGER_CATEGORIES_BY_TYPE[normalized] || []).map(label => `<option value="${escapeHtml(label)}" ${String(selected)===String(label)?'selected':''}>${escapeHtml(label)}</option>`).join('');
}
function ledgerKindLabel(kind) {
  const labels = {income: 'Income', revenue: 'Income', cogs: 'Cost of Goods Sold', expense: 'Expenses'};
  return labels[kind] || statusLabel(kind);
}
function salesTaxPeriodByKey(key) { return state.salesTaxPeriods.find(period => period.key === key); }
function salesTaxPeriodLabel(key) { return salesTaxPeriodByKey(key)?.label || key || ''; }
function parseSalesTaxPeriod(value='') {
  const match = String(value || '').match(/^(\d{4})-(Q[1-4])$/);
  return match ? {year: match[1], quarter: match[2]} : {year: '', quarter: ''};
}
function composeSalesTaxPeriod(year, quarter) {
  const normalizedYear = String(year ?? '').trim();
  const normalizedQuarter = String(quarter ?? '').trim();
  return /^\d{4}$/.test(normalizedYear) && /^Q[1-4]$/.test(normalizedQuarter) ? `${normalizedYear}-${normalizedQuarter}` : '';
}
function salesTaxYearFromDate(value) {
  const match = String(value || '').match(/^(\d{4})-/);
  return match ? match[1] : '';
}
function salesTaxQuarterLabel(quarter) {
  const quarterNumber = Number(String(quarter).replace(/^Q/, ''));
  const canonicalPeriod = state.salesTaxPeriods.find(period => Number(period.quarter) === quarterNumber);
  const monthRange = String(canonicalPeriod?.label || '').match(/\(([^)]+)\)$/)?.[1]?.replace('-', '–') || '';
  return monthRange ? `Q${quarterNumber} — ${monthRange}` : `Q${quarterNumber}`;
}
function salesTaxQuarterOptions(selected='') {
  return SALES_TAX_QUARTERS.map(quarter => {
    const key = `Q${quarter}`;
    return `<option value="${key}" ${String(selected)===key?'selected':''}>${escapeHtml(salesTaxQuarterLabel(key))}</option>`;
  }).join('');
}
function configureLedgerForm(form, opts={}) {
  const kind = form.elements.kind;
  const category = form.elements.category;
  const businessType = form.elements.business_type;
  const clientWrap = opts.clientWrap || form.querySelector('[data-ledger-client-wrap]');
  const projectWrap = opts.projectWrap || form.querySelector('[data-ledger-project-wrap]');
  const clientSelect = form.elements.client_id;
  const projectSelect = form.elements.project_id;
  const quoteWrap = opts.quoteWrap || form.querySelector('[data-ledger-quote-wrap]');
  const invoiceWrap = opts.invoiceWrap || form.querySelector('[data-ledger-invoice-wrap]');
  const quoteSelect = form.elements.quote_id;
  const invoiceSelect = form.elements.invoice_id;
  const salesTaxPeriodWrap = form.querySelector('[data-ledger-sales-tax-period-wrap]');
  const salesTaxQuarterSelect = form.elements.sales_tax_quarter;
  const salesTaxYearInput = form.elements.sales_tax_year;
  const salesTaxPeriodInput = form.elements.sales_tax_period;
  const entryDateInput = form.elements.entry_date;
  let followEntryDateYear = !salesTaxPeriodInput?.value;
  const selectedCategory = opts.selectedCategory || category?.value || '';
  function refreshCategories(preserve=true) {
    if (!category || !kind) return;
    const current = preserve ? category.value : selectedCategory;
    category.innerHTML = `<option value="">Select category...</option>${ledgerCategoryOptions(kind.value, current)}`;
    if (current && !category.value) category.value = '';
  }
  function refreshClientVisibility() {
    const isClient = !businessType || businessType.value === 'client';
    form.classList.toggle('ledger-client-mode', isClient);
    form.classList.toggle('ledger-admin-mode', !isClient);
    if (clientWrap) clientWrap.classList.toggle('hidden', !isClient);
    if (projectWrap) projectWrap.classList.toggle('hidden', !isClient);
    if (quoteWrap) quoteWrap.classList.toggle('hidden', !isClient);
    if (invoiceWrap) invoiceWrap.classList.toggle('hidden', !isClient);
    if (!isClient) {
      if (clientSelect) clientSelect.value = '';
      if (projectSelect) projectSelect.value = '';
      if (quoteSelect) quoteSelect.value = '';
      if (invoiceSelect) invoiceSelect.value = '';
    }
  }
  function refreshSalesTaxPeriodVisibility() {
    const active = normalizeLedgerKind(kind?.value) === 'expense' && category?.value === SALES_TAX_PERIOD_CATEGORY;
    salesTaxPeriodWrap?.classList.toggle('hidden', !active);
    [salesTaxQuarterSelect, salesTaxYearInput].forEach(control => {
      if (!control) return;
      control.required = active;
      control.disabled = !active;
    });
    if (!active) {
      if (salesTaxQuarterSelect) salesTaxQuarterSelect.value = '';
      if (salesTaxYearInput) salesTaxYearInput.value = salesTaxYearFromDate(entryDateInput?.value);
      if (salesTaxPeriodInput) salesTaxPeriodInput.value = '';
      followEntryDateYear = true;
      return;
    }
    if (salesTaxYearInput && !salesTaxYearInput.value) salesTaxYearInput.value = salesTaxYearFromDate(entryDateInput?.value);
    if (salesTaxPeriodInput) salesTaxPeriodInput.value = composeSalesTaxPeriod(salesTaxYearInput?.value, salesTaxQuarterSelect?.value);
  }
  kind?.addEventListener('change', () => { refreshCategories(false); refreshSalesTaxPeriodVisibility(); });
  category?.addEventListener('change', refreshSalesTaxPeriodVisibility);
  salesTaxQuarterSelect?.addEventListener('change', () => {
    if (salesTaxPeriodInput) salesTaxPeriodInput.value = composeSalesTaxPeriod(salesTaxYearInput?.value, salesTaxQuarterSelect.value);
  });
  salesTaxYearInput?.addEventListener('input', () => {
    followEntryDateYear = false;
    if (salesTaxPeriodInput) salesTaxPeriodInput.value = composeSalesTaxPeriod(salesTaxYearInput.value, salesTaxQuarterSelect?.value);
  });
  entryDateInput?.addEventListener('change', () => {
    if (!followEntryDateYear || !salesTaxYearInput) return;
    salesTaxYearInput.value = salesTaxYearFromDate(entryDateInput.value);
    if (salesTaxPeriodInput) salesTaxPeriodInput.value = composeSalesTaxPeriod(salesTaxYearInput.value, salesTaxQuarterSelect?.value);
  });
  function refreshLinkedSelectors() {
    const clientId = clientSelect?.value || opts.clientId || '';
    const projectId = projectSelect?.value || '';
    if (quoteSelect) quoteSelect.innerHTML = quoteOptions(quoteSelect.value, clientId, projectId);
    if (invoiceSelect) invoiceSelect.innerHTML = invoiceOptions(invoiceSelect.value, clientId, projectId);
  }
  businessType?.addEventListener('change', refreshClientVisibility);
  clientSelect?.addEventListener('change', () => {
    if (projectSelect) projectSelect.innerHTML = projectOptions('', clientSelect.value);
    refreshLinkedSelectors();
  });
  projectSelect?.addEventListener('change', refreshLinkedSelectors);
  refreshLinkedSelectors();
  refreshCategories(false);
  refreshClientVisibility();
  refreshSalesTaxPeriodVisibility();
}
function normalizeLedgerPayload(payload) {
  payload.kind = normalizeLedgerKind(payload.kind);
  payload.amount = Number(payload.amount);
  if (payload.business_type === 'admin') {
    delete payload.client_id;
    delete payload.project_id;
    delete payload.quote_id;
    delete payload.invoice_id;
  } else {
    numOrDelete(payload, 'client_id');
    numOrDelete(payload, 'project_id');
    numOrDelete(payload, 'quote_id');
    numOrDelete(payload, 'invoice_id');
  }
  numOrDelete(payload, 'receipt_id');
  if (payload.category === SALES_TAX_PERIOD_CATEGORY) payload.sales_tax_period = composeSalesTaxPeriod(payload.sales_tax_year, payload.sales_tax_quarter);
  else delete payload.sales_tax_period;
  delete payload.sales_tax_quarter;
  delete payload.sales_tax_year;
  return payload;
}

const titles = {
  dashboard: ['Home', 'Internal tracking overview for open work, invoices, and labor.'],
  clients: ['Clients', 'Client database, contact info, and site addresses.'],
  projects: ['Projects', 'Project-centered workflow for jobs and client work.'],
  quotes: ['Quotes', 'Create and track quotes attached to clients and projects.'],
  invoices: ['Invoices', 'Bill actual labor and materials, then track status and balance.'],
  ledger: ['Ledger', 'Revenue, expenses, reimbursements, and admin costs.'],
  labor: ['Labor', 'Track billable work against clients and projects.'],
  reports: ['Reports', 'Money flow, sales-tax periods, and client/project summaries.'],
  admin: ['Settings & Backup', 'Manage business defaults, application lists, and full-data backups.'],
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function money(value) { if (value === null || value === undefined || value === '') return ''; return `$${Number(value).toFixed(2)}`; }
function show(text) { messages.innerHTML = `<div class="notice">${escapeHtml(text)}</div>`; setTimeout(() => messages.innerHTML = '', 2500); }
function clientName(id) { return state.clients.find(c => Number(c.id) === Number(id))?.name || ''; }
function projectName(id) { return state.projects.find(p => Number(p.id) === Number(id))?.name || ''; }
function quoteName(id) { const q = state.quotes.find(q => Number(q.id) === Number(id)); return q ? `${q.quote_number} — ${q.title}` : ''; }
function invoiceName(id) { const i = state.invoices.find(i => Number(i.id) === Number(id)); return i ? `${i.invoice_number} — ${i.title}` : ''; }
function clientOptions(selected='') { return `<option value="">None</option>${state.clients.map(c => `<option value="${c.id}" ${String(selected)===String(c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}`; }
function optionList(options, selected='') {
  return options.map(o => `<option value="${escapeHtml(o.label)}" ${String(selected)===String(o.label)?'selected':''}>${escapeHtml(o.label)}</option>`).join('');
}
function projectOptions(selected='', clientId='') {
  const projects = clientId ? state.projects.filter(p => Number(p.client_id) === Number(clientId)) : state.projects;
  return `<option value="">None</option>${projects.map(p => `<option value="${p.id}" ${String(selected)===String(p.id)?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}`;
}
function quoteOptions(selected='', clientId='', projectId='') {
  let quotes = clientId ? state.quotes.filter(q => Number(q.client_id) === Number(clientId)) : state.quotes;
  if (projectId) quotes = quotes.filter(q => !q.project_id || Number(q.project_id) === Number(projectId));
  return `<option value="">None</option>${quotes.map(q => `<option value="${q.id}" ${String(selected)===String(q.id)?'selected':''}>${escapeHtml(q.quote_number)} — ${escapeHtml(q.title)}</option>`).join('')}`;
}
function invoiceOptions(selected='', clientId='', projectId='') {
  let invoices = clientId ? state.invoices.filter(i => Number(i.client_id) === Number(clientId)) : state.invoices;
  if (projectId) invoices = invoices.filter(i => !i.project_id || Number(i.project_id) === Number(projectId));
  return `<option value="">None</option>${invoices.map(i => `<option value="${i.id}" ${String(selected)===String(i.id)?'selected':''}>${escapeHtml(i.invoice_number)} — ${escapeHtml(i.title)}</option>`).join('')}`;
}
function receiptPreviewButton(id, label='View') {
  if (!id) return '—';
  return `<button class="link-button" type="button" data-action="preview-receipt" data-id="${Number(id)}">${escapeHtml(label)}</button>`;
}

function closeReceiptPreviewModal() {
  document.querySelector('#receiptPreviewModal')?.remove();
}

async function openReceiptPreviewModal(receiptId) {
  const receipt = await api(`/api/receipts/${receiptId}`);
  closeReceiptPreviewModal();
  const previewUrl = `/api/receipts/${receiptId}/preview?ts=${Date.now()}`;
  const downloadUrl = `/api/receipts/${receiptId}/file`;
  const isImage = String(receipt.content_type || '').startsWith('image/');
  const isPdf = receipt.content_type === 'application/pdf';
  const preview = isImage
    ? `<img class="receipt-preview-image" src="${previewUrl}" alt="Receipt preview: ${escapeHtml(receipt.original_filename || 'receipt')}">`
    : isPdf
      ? `<iframe class="receipt-preview-frame" src="${previewUrl}" title="Receipt PDF preview"></iframe>`
      : `<div class="receipt-preview-fallback">This receipt type cannot be previewed inline.</div>`;
  const wrapper = document.createElement('div');
  wrapper.id = 'receiptPreviewModal';
  wrapper.className = 'modal-backdrop receipt-preview-backdrop';
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');
  wrapper.innerHTML = `<div class="modal-card receipt-preview-card"><div class="modal-header"><div><h2>Receipt Preview</h2><p>${escapeHtml(receipt.original_filename || 'Receipt')}</p></div><button class="ghost modal-close" type="button" aria-label="Close receipt preview">×</button></div>
    <div class="receipt-preview-meta"><span>${escapeHtml(receipt.vendor_name || 'Unknown vendor')}</span><span>${escapeHtml(receipt.receipt_date || '')}</span><span>${money(receipt.total_amount)}</span></div>
    <div class="receipt-preview-stage">${preview}</div>
    <div class="modal-actions receipt-preview-actions"><a class="button-link" href="${downloadUrl}" download>Download</a><a class="button-link" href="${previewUrl}" target="_blank" rel="noopener">Open Full Size</a><button class="ghost" type="button" id="closeReceiptPreview">Close</button></div></div>`;
  document.body.appendChild(wrapper);
  const close = () => closeReceiptPreviewModal();
  wrapper.querySelector('.modal-close')?.addEventListener('click', close);
  wrapper.querySelector('#closeReceiptPreview')?.addEventListener('click', close);
  wrapper.addEventListener('click', e => { if (e.target === wrapper) close(); });
  const escClose = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', escClose); close(); } };
  document.addEventListener('keydown', escClose);
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function stamp(prefix) { const d = new Date(); const ymd = d.toISOString().slice(0,10).replaceAll('-',''); return `${prefix}-${ymd}-001`; }

function percentSetting(value, fallback=0) {
  const raw = Number(value ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return raw > 1 ? raw / 100 : raw;
}
function numberValue(value, fallback=0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}
function decimalString(value, places=2) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(places) : (0).toFixed(places);
}
function normalizeKind(kind) {
  if (kind === 'labor') return 'labor';
  if (kind === 'fee') return 'fee';
  return 'equipment';
}
function equipmentRowsFromItems(items) {
  return (items || []).filter(i => normalizeKind(i.kind) === 'equipment');
}
function laborRowsFromItems(items) {
  return (items || []).filter(i => normalizeKind(i.kind) === 'labor');
}
function quoteVendorFeeRowHtml(item={}) {
  const amount = item.line_total ?? item.unit_price ?? '0.00';
  return `<article class="quote-vendor-fee-row quote-line-card" data-kind="fee">
    <label class="quote-line-field quote-line-name"><span>Fee name</span><input name="vendor_fee_name" required maxlength="180" value="${escapeHtml(item.name || '')}" placeholder="Shipping, delivery, permit fee..."></label>
    <label class="quote-line-field"><span>Amount</span><input name="vendor_fee_amount" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(amount)}"></label>
    <button class="mini danger-mini quote-remove-fee" type="button" aria-label="Remove vendor fee">Remove</button>
  </article>`;
}
function quoteEquipmentRowHtml(item={}) {
  const qty = item.quantity ?? '1.00';
  const price = item.unit_price ?? '0.00';
  const total = item.line_total ?? (Number(qty || 0) * Number(price || 0)).toFixed(2);
  return `<article class="quote-sheet-row quote-line-row quote-line-card" data-kind="equipment">
    <label class="quote-line-field quote-line-name"><span>Item</span><input name="name" required value="${escapeHtml(item.name || '')}" placeholder="Item or material"></label>
    <label class="quote-line-field quote-line-description"><span>Description</span><input name="description" value="${escapeHtml(item.description || '')}" placeholder="Description"></label>
    <label class="quote-line-field"><span>Quantity</span><input name="quantity" type="number" min="0" step="0.01" value="${escapeHtml(qty)}" inputmode="decimal"></label>
    <label class="quote-line-field"><span>Unit price</span><input name="unit_price" type="number" min="0" step="0.01" value="${escapeHtml(price)}" inputmode="decimal"></label>
    <label class="quote-line-field quote-line-total"><span>Line total</span><input name="line_total" type="number" min="0" step="0.01" value="${escapeHtml(total)}" readonly aria-readonly="true"></label>
    <label class="quote-taxable-control"><input name="taxable" type="checkbox" ${item.taxable === false ? '' : 'checked'}><span>Taxable</span></label>
    <button class="mini danger-mini quote-remove-line" type="button" aria-label="Remove equipment or material row">Remove</button>
  </article>`;
}
function quoteLaborRowHtml(item={}) {
  const hours = item.quantity ?? '1.00';
  const rate = item.unit_price ?? '100.00';
  const total = item.line_total ?? (Number(hours || 0) * Number(rate || 0)).toFixed(2);
  return `<article class="quote-sheet-row quote-line-row quote-line-card labor-sheet-row" data-kind="labor">
    <label class="quote-line-field quote-line-name"><span>Service</span><input name="name" required value="${escapeHtml(item.name || '')}" placeholder="Service"></label>
    <label class="quote-line-field quote-line-description"><span>Description</span><input name="description" value="${escapeHtml(item.description || '')}" placeholder="Description"></label>
    <label class="quote-line-field"><span>Hours</span><input name="quantity" type="number" min="0" step="0.01" value="${escapeHtml(hours)}" inputmode="decimal"></label>
    <label class="quote-line-field"><span>Rate</span><input name="unit_price" type="number" min="0" step="0.01" value="${escapeHtml(rate)}" inputmode="decimal"></label>
    <label class="quote-line-field quote-line-total"><span>Line total</span><input name="line_total" type="number" min="0" step="0.01" value="${escapeHtml(total)}" readonly aria-readonly="true"></label>
    <button class="mini danger-mini quote-remove-line" type="button" aria-label="Remove labor row">Remove</button>
  </article>`;
}
function quoteLineEditorHtml(items=[], settings={}) {
  const markupPercent = Number(settings.quote_markup_percent ?? '10');
  const salesTaxRate = percentSetting(settings.sales_tax_rate ?? '0.07', 0.07);
  const laborRate = settings.default_labor_rate || '100.00';
  const equipment = equipmentRowsFromItems(items);
  const labor = laborRowsFromItems(items);
  const vendorFees = quoteVendorFeeItems(items);
  const markup = items.find(isQuoteMarkupItem)?.line_total || '0.00';
  return `<div class="quote-builder quote-editor-sections full" id="quoteLineEditor" data-markup-percent="${markupPercent}" data-sales-tax-rate="${salesTaxRate}">
    <section class="quote-sheet-section quote-editor-section" aria-labelledby="quoteEquipmentHeading">
      <div class="quote-editor-section-head"><span>2</span><div><h3 id="quoteEquipmentHeading">Equipment & Materials</h3><p>Add the hardware, materials, and quantities included in this estimate.</p></div></div>
      <div class="quote-sheet-head equipment-head"><span>Item</span><span>Description</span><span>Qty</span><span>Unit Price</span><span>Line Total</span><span>Tax</span><span></span></div>
      <div id="quoteEquipmentRows">${(equipment.length ? equipment : [{kind:'equipment', name:'', description:'', quantity:'1.00', unit_price:'0.00', line_total:'0.00', taxable:true}]).map(quoteEquipmentRowHtml).join('')}</div>
      <div class="quote-toolbar sheet-toolbar"><button class="mini quote-add-line" type="button" id="addEquipmentLine">+ Add Equipment or Material</button></div>
    </section>

    <section class="quote-sheet-section quote-editor-section quote-fees-section" aria-labelledby="quoteFeesHeading">
      <div class="quote-editor-section-head"><span>3</span><div><h3 id="quoteFeesHeading">Vendor Fees & Markup</h3><p>Add taxable vendor charges separately from the calculated coordination markup.</p></div></div>
      <div class="quote-vendor-fees">
        <div class="quote-vendor-fee-head"><span>Fee name</span><span>Amount</span><span></span></div>
        <div id="quoteVendorFeeRows">${vendorFees.map(quoteVendorFeeRowHtml).join('')}</div>
        <button class="mini quote-add-line" type="button" id="addQuoteVendorFee">+ Add Vendor Fee</button>
      </div>
      <div class="quote-fee-grid quote-markup-grid">
        <label>Markup / Project Coordination %<input id="quoteMarkupPercentInput" type="number" min="0" step="0.01" value="${escapeHtml(markupPercent)}"></label>
        <label>Project Coordination & Logistics<input id="quoteMarkupDisplay" readonly aria-readonly="true" value="${escapeHtml(Number(markup || 0).toFixed(2))}"></label>
      </div>
    </section>

    <section class="quote-sheet-section quote-editor-section" aria-labelledby="quoteLaborHeading">
      <div class="quote-editor-section-head"><span>4</span><div><h3 id="quoteLaborHeading">Estimated Labor</h3><p>Estimate installation, configuration, and other service work.</p></div></div>
      <div class="quote-sheet-head labor-head"><span>Service</span><span>Description</span><span>Hours</span><span>Rate</span><span>Line Total</span><span></span></div>
      <div id="quoteLaborRows">${(labor.length ? labor : [{kind:'labor', name:'', description:'', quantity:'0.00', unit_price:laborRate, line_total:'0.00', taxable:false}]).map(quoteLaborRowHtml).join('')}</div>
      <div class="quote-toolbar sheet-toolbar"><button class="mini quote-add-line" type="button" id="addLaborLine">+ Add Labor Row</button></div>
    </section>

    <section class="quote-sheet-section quote-editor-section quote-summary-section" aria-labelledby="quoteSummaryHeading">
      <div class="quote-editor-section-head"><span>5</span><div><h3 id="quoteSummaryHeading">Quote Summary</h3><p>Live totals from the existing Quote calculation.</p></div></div>
      <div class="quote-summary-grid" aria-live="polite">
        <div><span>Equipment subtotal</span><input id="equipmentSubtotalDisplay" aria-label="Equipment subtotal" readonly aria-readonly="true" value="$0.00"></div>
        <div data-quote-summary-row="vendor-fees"><span>Vendor fees</span><output data-quote-summary="vendor-fees">$0.00</output></div>
        <div><span>Sales Tax</span><input id="quoteTaxDisplay" aria-label="Sales Tax" readonly aria-readonly="true" value="$0.00"></div>
        <div><span>Project Coordination & Logistics</span><output data-quote-summary="markup">$0.00</output></div>
        <div class="quote-summary-equipment"><span>Total Equipment Cost</span><input id="quoteEquipmentTotalDisplay" aria-label="Total Equipment Cost" readonly aria-readonly="true" value="$0.00"></div>
        <div><span>Estimated Labor</span><input id="quoteLaborTotalDisplay" aria-label="Estimated Labor" readonly aria-readonly="true" value="$0.00"></div>
        <div class="quote-summary-grand"><span>Estimated Grand Total</span><input id="quoteGrandTotalDisplay" aria-label="Estimated Grand Total" readonly aria-readonly="true" value="$0.00"></div>
      </div>
    </section>
  </div>`;
}
function collectQuoteLineItems(container, quoteId=0) {
  const editor = container?.matches?.('#quoteLineEditor') ? container : container?.querySelector?.('#quoteLineEditor');
  if (!editor) return [];
  const rows = [...editor.querySelectorAll('.quote-line-row')];
  const items = rows.map((row, index) => {
    const kind = normalizeKind(row.dataset.kind || row.querySelector('[name="kind"]')?.value || 'equipment');
    const name = row.querySelector('[name="name"]')?.value.trim() || (kind === 'labor' ? 'Labor' : 'Line Item');
    const quantity = numberValue(row.querySelector('[name="quantity"]')?.value, 0);
    const unit_price = numberValue(row.querySelector('[name="unit_price"]')?.value, 0);
    let line_total = numberValue(row.querySelector('[name="line_total"]')?.value, 0);
    if (!line_total) line_total = quantity * unit_price;
    return {
      quote_id: Number(quoteId || 0), kind, name,
      description: row.querySelector('[name="description"]')?.value || '',
      quantity: decimalString(quantity), unit_price: decimalString(unit_price), line_total: decimalString(line_total),
      taxable: kind === 'equipment' ? (row.querySelector('[name="taxable"]')?.checked || false) : false,
      sort_order: (index + 1) * 10,
    };
  }).filter(item => item.name || item.line_total > 0);

  [...editor.querySelectorAll('.quote-vendor-fee-row')].forEach((row, index) => {
    const name = row.querySelector('[name="vendor_fee_name"]')?.value.trim() || '';
    const amount = numberValue(row.querySelector('[name="vendor_fee_amount"]')?.value, 0);
    if (name || amount > 0) items.push({quote_id:Number(quoteId || 0), kind:'fee', name, description:'Vendor fee included with quoted equipment/materials.', quantity:'1.00', unit_price:decimalString(amount), line_total:decimalString(amount), taxable:true, sort_order:500 + ((index + 1) * 10)});
  });
  const markup = numberValue(editor.querySelector('#quoteMarkupDisplay')?.value, 0);
  if (markup > 0) items.push({quote_id:Number(quoteId || 0), kind:'fee', name:QUOTE_MARKUP_NAME, description:'Procurement, coordination, logistics, and handling.', quantity:'1.00', unit_price:decimalString(markup), line_total:decimalString(markup), taxable:false, sort_order:900});
  return items;
}
function recalcQuoteEditor(container) {
  const editor = container.querySelector('#quoteLineEditor');
  if (!editor) return { subtotal:0, tax:0, total:0 };
  editor.querySelectorAll('.quote-line-row').forEach(row => {
    const qty = numberValue(row.querySelector('[name="quantity"]')?.value, 0);
    const price = numberValue(row.querySelector('[name="unit_price"]')?.value, 0);
    const totalInput = row.querySelector('[name="line_total"]');
    if (totalInput) totalInput.value = (qty * price).toFixed(2);
  });
  const taxRate = Number(editor.dataset.salesTaxRate || 0);
  const markupPercent = numberValue(editor.querySelector('#quoteMarkupPercentInput')?.value, numberValue(editor.dataset.markupPercent, 0));
  const draftItems = collectQuoteLineItems(editor).filter(item => !isQuoteMarkupItem(item));
  const draftTotals = calculateQuoteDraftTotals(draftItems, taxRate, markupPercent);
  const markupInput = editor.querySelector('#quoteMarkupDisplay');
  if (markupInput) markupInput.value = draftTotals.markup.toFixed(2);
  const items = collectQuoteLineItems(editor);
  const totals = calculateQuoteTotals(items, taxRate);
  const setTextInput = (selector, value, asMoney=true) => { const el = editor.querySelector(selector); if (el) el.value = asMoney ? money(value) : Number(value).toFixed(2); };
  setTextInput('#equipmentSubtotalDisplay', totals.equipmentSubtotal);
  setTextInput('#quoteTaxDisplay', totals.tax);
  setTextInput('#quoteEquipmentTotalDisplay', totals.equipmentTotal);
  setTextInput('#quoteLaborTotalDisplay', totals.laborTotal);
  setTextInput('#quoteGrandTotalDisplay', totals.total);
  const summaryValues = { 'vendor-fees': totals.vendorFeesTotal, markup: totals.markup };
  Object.entries(summaryValues).forEach(([name, value]) => {
    const output = editor.querySelector(`[data-quote-summary="${name}"]`);
    if (output) output.textContent = money(value);
    editor.querySelector(`[data-quote-summary-row="${name}"]`)?.classList.toggle('quote-zero-value', Number(value || 0) === 0);
  });
  container.querySelectorAll('[data-quote-sticky-total]').forEach(output => { output.textContent = money(totals.total); });
  ['subtotal','tax_amount','total_amount'].forEach((name) => {
    const input = container.querySelector(`[name="${name}"]`);
    if (input) {
      const val = name === 'subtotal' ? totals.subtotal : name === 'tax_amount' ? totals.tax : totals.total;
      input.value = Number(val).toFixed(2);
    }
  });
  return totals;
}
function wireQuoteLineEditor(container) {
  const editor = container.querySelector('#quoteLineEditor');
  if (!editor) return;
  const equipmentRows = editor.querySelector('#quoteEquipmentRows');
  const laborRows = editor.querySelector('#quoteLaborRows');
  const vendorFeeRows = editor.querySelector('#quoteVendorFeeRows');
  const addEquipment = () => {
    equipmentRows.insertAdjacentHTML('beforeend', quoteEquipmentRowHtml({kind:'equipment', quantity:'1.00', unit_price:'0.00', line_total:'0.00', taxable:true}));
    wireQuoteLineEditor(container);
    equipmentRows.lastElementChild?.querySelector('[name="name"]')?.focus();
  };
  const addLabor = () => {
    const rate = container.querySelector('[name="hourly_rate"]')?.value || '100.00';
    laborRows.insertAdjacentHTML('beforeend', quoteLaborRowHtml({kind:'labor', quantity:'1.00', unit_price:rate, line_total:rate, taxable:false}));
    wireQuoteLineEditor(container);
    laborRows.lastElementChild?.querySelector('[name="name"]')?.focus();
  };
  const addVendorFee = () => {
    vendorFeeRows.insertAdjacentHTML('beforeend', quoteVendorFeeRowHtml({line_total:'0.00'}));
    wireQuoteLineEditor(container);
    vendorFeeRows.lastElementChild?.querySelector('[name="vendor_fee_name"]')?.focus();
  };
  const equipmentButton = editor.querySelector('#addEquipmentLine');
  const laborButton = editor.querySelector('#addLaborLine');
  const vendorFeeButton = editor.querySelector('#addQuoteVendorFee');
  if (equipmentButton) equipmentButton.onclick = addEquipment;
  if (laborButton) laborButton.onclick = addLabor;
  if (vendorFeeButton) vendorFeeButton.onclick = addVendorFee;
  editor.querySelectorAll('input,select,textarea').forEach(el => el.oninput = () => recalcQuoteEditor(container));
  editor.querySelectorAll('.quote-remove-line').forEach(btn => btn.onclick = () => { btn.closest('.quote-line-row')?.remove(); recalcQuoteEditor(container); });
  editor.querySelectorAll('.quote-remove-fee').forEach(btn => btn.onclick = () => { btn.closest('.quote-vendor-fee-row')?.remove(); recalcQuoteEditor(container); });
  recalcQuoteEditor(container);
}

function quoteEditorFormHtml({editing=null, generatedQuoteNumber='', quoteNumberAttrs='', settings={}, existingItems=[], termsTemplates=[], formId='quoteForm', clientSelectId='quoteClient', projectSelectId='quoteProject', scopedClientId=null, scopedProjectId='', clientLabel='', closeButtonId='', cancelButtonId='', scoped=false}) {
  const isEdit = Boolean(editing);
  const titleId = `${formId}Title`;
  const closeId = closeButtonId ? ` id="${closeButtonId}"` : '';
  const cancelIdAttr = cancelButtonId ? ` id="${cancelButtonId}"` : '';
  const cancelClass = scoped ? ' quick-cancel' : '';
  const selectedClientId = scopedClientId || editing?.client_id || '';
  const selectedProjectId = scopedProjectId || editing?.project_id || '';
  const clientField = scopedClientId
    ? `<input type="hidden" name="client_id" value="${Number(scopedClientId)}"><div class="quote-context-readonly"><span>Client</span><strong>${clientLabel}</strong></div>`
    : `<label>Client<select name="client_id" id="${clientSelectId}" required>${clientOptions(editing?.client_id)}</select></label>`;
  return `<div class="modal-card wide-modal quote-editor-shell"><header class="modal-header quote-editor-header"><div><p class="quote-editor-eyebrow">Quote workflow</p><h2 id="${titleId}">${isEdit ? 'Edit Quote' : 'Add Quote'}</h2><p>${isEdit ? 'Review the estimate, adjust the work, and update the quote.' : 'Build a clear estimate for a client or project.'}</p></div><button class="ghost modal-close"${closeId} type="button" aria-label="Close quote form">×</button></header>
    <form id="${formId}" class="form-grid quote-editor-form">
      <section class="quote-sheet-section quote-editor-section quote-details-section full" aria-labelledby="${formId}DetailsHeading">
        <div class="quote-editor-section-head"><span>1</span><div><h3 id="${formId}DetailsHeading">Quote Details</h3><p>Choose the client and project, then name and date the quote.</p></div></div>
        <div class="quote-details-grid">
          ${clientField}
          <label>Project or site<select name="project_id" id="${projectSelectId}">${projectOptions(selectedProjectId, selectedClientId)}</select></label>
          <label class="quote-title-field">Quote title<input name="title" required value="${escapeHtml(editing?.title)}" placeholder="Network upgrade, camera installation, managed services..."></label>
          <label>Quote #<input name="quote_number" required${quoteNumberAttrs} value="${escapeHtml(generatedQuoteNumber)}"></label>
          <div class="quote-context-readonly"><span>Prepared by</span><strong>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</strong></div>
          <label>Status<select name="status"><option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="expired">Expired</option></select></label>
          <label>Issued date<input name="quote_date" type="date" required value="${escapeHtml(editing?.quote_date || todayIso())}"></label>
          <label>Valid through<input name="valid_until" type="date" value="${escapeHtml(editing?.valid_until)}"></label>
        </div>
      </section>
      <input name="subtotal" type="hidden" value="${escapeHtml(editing?.subtotal || '0.00')}"><input name="tax_amount" type="hidden" value="${escapeHtml(editing?.tax_amount || '0.00')}"><input name="total_amount" type="hidden" value="${escapeHtml(editing?.total_amount || '0.00')}">
      ${quoteLineEditorHtml(existingItems, settings)}
      <section class="quote-sheet-section quote-editor-section quote-terms-section full" aria-labelledby="${formId}TermsHeading">
        <div class="quote-editor-section-head"><span>6</span><div><h3 id="${formId}TermsHeading">Payment Terms & Conditions</h3><p>Client-facing terms included with the quote.</p></div></div>
        ${savedTermsControlHtml({templates:termsTemplates, appliesTo:'quote', formId})}
        <label>Terms<textarea name="terms" rows="7">${escapeHtml(quoteTermsValue(editing?.terms, settings.default_quote_terms))}</textarea></label>
      </section>
      <section class="quote-sheet-section quote-editor-section quote-notes-section full" aria-labelledby="${formId}NotesHeading">
        <div class="quote-editor-section-head"><span>7</span><div><h3 id="${formId}NotesHeading">Internal Notes</h3><p>Visible inside ForgeOps only; these notes are not printed on the Quote.</p></div></div>
        <label>Notes<textarea name="notes" rows="4" placeholder="Internal context, reminders, or follow-up notes">${escapeHtml(editing?.notes)}</textarea></label>
      </section>
      <footer class="form-actions quote-editor-actions"><div class="quote-editor-footer-total"><span>Grand total</span><strong data-quote-sticky-total>$0.00</strong></div><div class="quote-editor-action-buttons"><button class="ghost${cancelClass}"${cancelIdAttr} type="button">Cancel</button>${isEdit ? `<button class="ghost" type="button" data-action="create-invoice-from-quote" data-quote-id="${editing.id}">Create Invoice</button><button class="ghost" type="button" data-action="print" data-type="quote" data-id="${editing.id}">Print Quote</button>` : ''}<button class="primary" type="submit">${isEdit ? 'Update Quote' : 'Save Quote'}</button></div></footer>
    </form></div>`;
}

async function persistQuoteEditor(form, container, editing=null, scopedClientId=null) {
  if (form.dataset.submitting === 'true') return null;
  const submitButton = form.querySelector('button[type="submit"]');
  form.dataset.submitting = 'true';
  if (submitButton) submitButton.disabled = true;
  try {
    const payload = clean(formData(form));
    payload.client_id = Number(scopedClientId || payload.client_id);
    numOrDelete(payload, 'project_id');
    const items = collectQuoteLineItems(container.querySelector('#quoteLineEditor'));
    const totals = recalcQuoteEditor(container);
    payload.subtotal = decimalString(totals.subtotal || 0);
    payload.tax_amount = decimalString(totals.tax || 0);
    payload.total_amount = decimalString(totals.total || 0);
    const saved = editing ? await api(`/api/quotes/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}) : await api('/api/quotes', {method:'POST', body: JSON.stringify(payload)});
    const quoteId = saved.id || editing?.id;
    await api(`/api/quotes/${quoteId}/line-items`, {method:'PUT', body: JSON.stringify({items: items.map(item => ({...item, quote_id: Number(quoteId)}))})});
    return {saved, quoteId, payload, items};
  } catch (err) {
    delete form.dataset.submitting;
    if (submitButton) submitButton.disabled = false;
    throw err;
  }
}

function invoiceLineItemsFor(editing, kind) {
  return (editing?.line_items || []).filter(item => String(item.kind) === kind);
}

function invoiceMaterialRowHtml(item={}) {
  const qty = item.quantity ?? '1.00';
  const price = item.unit_price ?? '0.00';
  const total = item.line_total ?? (Number(qty || 0) * Number(price || 0)).toFixed(2);
  return `<article class="invoice-material-row invoice-line-card" data-kind="material">
    <label class="invoice-line-field invoice-line-description"><span>Description</span><input name="material_description" placeholder="Cable, keystone jacks, hardware..." value="${escapeHtml(item.description || '')}"></label>
    <label class="invoice-line-field"><span>Quantity</span><input name="material_quantity" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(qty)}"></label>
    <label class="invoice-line-field"><span>Unit price</span><input name="material_unit_price" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(price)}"></label>
    <label class="invoice-line-field invoice-line-total"><span>Line total</span><input name="material_line_total" readonly aria-readonly="true" value="${money(total)}"></label>
    <button class="mini danger-mini invoice-remove-line" type="button" aria-label="Remove material line">Remove</button>
  </article>`;
}

function invoiceCreditRowHtml(item={}) {
  const amount = item.line_total ?? item.unit_price ?? '0.00';
  const kind = ['credit','payment','adjustment'].includes(String(item.kind)) ? item.kind : 'payment';
  return `<article class="invoice-credit-row invoice-line-card" data-kind="credit">
    <label class="invoice-line-field"><span>Type</span><select name="credit_kind"><option value="payment" ${kind==='payment'?'selected':''}>Payment</option><option value="credit" ${kind==='credit'?'selected':''}>Credit</option><option value="adjustment" ${kind==='adjustment'?'selected':''}>Adjustment</option></select></label>
    <label class="invoice-line-field invoice-line-description"><span>Description</span><input name="credit_description" placeholder="Payment toward labor, cable credit..." value="${escapeHtml(item.description || '')}"></label>
    <label class="invoice-line-field"><span>Amount</span><input name="credit_amount" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(amount)}"></label>
    <button class="mini danger-mini invoice-remove-line" type="button" aria-label="Remove credit or payment line">Remove</button>
  </article>`;
}

function invoiceInternalSheetHtml({editing=null, generatedInvoiceNumber='', invoiceNumberAttrs='', scopedClientId='', presetClientId='', scopedProjectId='', scopedQuoteId='', clientLabel='', settings={}, termsTemplates=[], formId='invoiceForm', clientSelectId='invoiceClient', projectSelectId='invoiceProject', quoteSelectId='invoiceQuote'}) {
  const companyName = settings.company_name || 'Forged Systems LLC';
  const salesTaxRate = percentSetting(settings.sales_tax_rate ?? '0.07', 0.07);
  const selectedClientId = scopedClientId || editing?.client_id || presetClientId || '';
  const selectedProjectId = editing?.project_id || scopedProjectId || '';
  const selectedQuoteId = editing?.quote_id || scopedQuoteId || '';
  const clientField = scopedClientId
    ? `<input type="hidden" name="client_id" value="${escapeHtml(scopedClientId)}"><div class="invoice-context-readonly"><span>Client</span><strong>${clientLabel}</strong></div>`
    : `<label>Client<select name="client_id" id="${clientSelectId}" required>${clientOptions(selectedClientId)}</select></label>`;
  const terms = invoiceTermsValue(editing?.terms, settings.default_invoice_terms);
  const materials = invoiceLineItemsFor(editing, 'material');
  const vendorFees = invoiceLineItemsFor(editing, 'vendor_fee');
  const credits = (editing?.line_items || []).filter(item => ['credit','payment','adjustment'].includes(String(item.kind)));
  return `<form id="${formId}" class="invoice-internal-sheet invoice-editor-form full" data-sales-tax-rate="${salesTaxRate}">
    <input type="hidden" name="subtotal" value="${escapeHtml(editing?.subtotal || '0.00')}">
    <input type="hidden" name="tax_amount" value="${escapeHtml(editing?.tax_amount || '0.00')}">
    <input type="hidden" name="total_amount" value="${escapeHtml(editing?.total_amount || '0.00')}">
    <input type="hidden" name="amount_paid" value="${escapeHtml(editing?.amount_paid || '0.00')}">
    <section class="invoice-sheet-section invoice-editor-section invoice-details-section" aria-labelledby="${formId}DetailsHeading">
      <div class="invoice-editor-section-head"><span>1</span><div><h3 id="${formId}DetailsHeading">Invoice Details</h3><p>Name, date, and manually track the Invoice status.</p></div></div>
      <div class="invoice-details-grid">
        <label>Invoice #<input name="invoice_number" required${invoiceNumberAttrs} value="${escapeHtml(generatedInvoiceNumber)}"></label>
        <label>Status<select name="status"><option value="draft">Draft</option><option value="sent">Sent</option><option value="partially_paid">Partially Paid</option><option value="paid">Paid</option><option value="void">Void</option><option value="overdue">Overdue</option></select></label>
        <label class="invoice-title-field">Invoice title<input name="title" required value="${escapeHtml(editing?.title || 'Labor Services')}"></label>
        <label>Invoice date<input name="invoice_date" type="date" required value="${escapeHtml(editing?.invoice_date || todayIso())}"></label>
        <label>Due date<input name="due_date" type="date" value="${escapeHtml(editing?.due_date)}"></label>
        <div class="invoice-context-readonly"><span>From</span><strong>${escapeHtml(companyName)}</strong></div>
      </div>
    </section>

    <section class="invoice-sheet-section invoice-editor-section invoice-context-section" aria-labelledby="${formId}ContextHeading">
      <div class="invoice-editor-section-head"><span>2</span><div><h3 id="${formId}ContextHeading">Billing Context</h3><p>Connect the Invoice to its client, project, and optional source Quote.</p></div></div>
      <div class="invoice-context-grid">
        ${clientField}
        <label>Project<select name="project_id" id="${projectSelectId}">${projectOptions(selectedProjectId, selectedClientId)}</select></label>
        <label>Related Quote<select name="quote_id" id="${quoteSelectId}">${quoteOptions(selectedQuoteId, selectedClientId, selectedProjectId)}</select></label>
      </div>
    </section>

    <section class="invoice-sheet-section invoice-editor-section invoice-labor-section" aria-labelledby="${formId}LaborHeading">
      <div class="invoice-editor-section-head"><span>3</span><div><h3 id="${formId}LaborHeading">Available Uninvoiced Labor</h3><p>Selection behavior is unchanged; review each labor status before invoicing.</p></div></div>
      <div class="invoice-labor-head"><span>Use</span><span>Status</span><span>Date</span><span>Service</span><span>Hours</span><span>Rate</span><span>Line Total</span><span>Notes</span></div>
      <div class="invoice-labor-rows"><div class="invoice-empty-row">Select a client/project to load available labor.</div></div>
      <p class="invoice-sheet-note">Checked labor entries will be attached to this invoice and marked as invoiced when saved.</p>
      <div class="invoice-section-subtotal"><span>Selected labor</span><strong id="invoiceLaborTotalDisplay">${money(editing?.subtotal || 0)}</strong></div>
    </section>

    <section class="invoice-sheet-section invoice-editor-section invoice-materials-section" aria-labelledby="${formId}MaterialsHeading">
      <div class="invoice-editor-section-head"><span>4</span><div><h3 id="${formId}MaterialsHeading">Additional Parts & Materials</h3><p>Add billable materials and taxable vendor charges that belong on this Invoice.</p></div></div>
      <div class="invoice-materials-subsection">
        <h4>Parts & Materials</h4>
        <div class="invoice-material-head"><span>Description</span><span>Qty</span><span>Unit Price</span><span>Line Total</span><span></span></div>
        <div id="invoiceMaterialRows">${materials.length ? materials.map(invoiceMaterialRowHtml).join('') : ''}</div>
        <button class="mini invoice-add-line" id="addInvoiceMaterialLine" type="button">+ Add Material</button>
      </div>
      <div class="invoice-vendor-fees-subsection">
        <h4>Vendor Fees</h4>
        <div class="invoice-vendor-fee-head"><span>Fee name</span><span>Amount</span><span></span></div>
        <div id="invoiceVendorFeeRows">${vendorFees.map(invoiceVendorFeeRowHtml).join('')}</div>
        <button class="mini invoice-add-line" id="addInvoiceVendorFee" type="button">+ Add Vendor Fee</button>
      </div>
    </section>

    <section class="invoice-sheet-section invoice-editor-section invoice-payments-section" aria-labelledby="${formId}PaymentsHeading">
      <div class="invoice-editor-section-head"><span>5</span><div><h3 id="${formId}PaymentsHeading">Credits / Payments Applied</h3><p>Keep the existing payment, credit, and adjustment lines with this Invoice.</p></div></div>
      <div class="invoice-credit-head"><span>Type</span><span>Description</span><span>Amount</span><span></span></div>
      <div id="invoiceCreditRows">${credits.length ? credits.map(invoiceCreditRowHtml).join('') : ''}</div>
      <button class="mini invoice-add-line" id="addInvoiceCreditLine" type="button">+ Add Credit / Payment</button>
      <p class="invoice-sheet-note">These lines reduce Balance Due. They do not automatically change status or create Ledger entries.</p>
    </section>

    <section class="invoice-sheet-section invoice-editor-section invoice-totals-section" aria-labelledby="${formId}TotalsHeading">
      <div class="invoice-editor-section-head"><span>6</span><div><h3 id="${formId}TotalsHeading">Invoice Totals</h3><p>Live preview using the existing Invoice calculation.</p></div></div>
      <div class="invoice-totals-summary" aria-live="polite">
        <div><span>Labor</span><input id="invoiceLaborTotalDisplay2" readonly aria-readonly="true" value="${money(0)}"></div>
        <div><span>Materials</span><input id="invoiceMaterialsTotalDisplay" readonly aria-readonly="true" value="${money(0)}"></div>
        <div><span>Vendor fees</span><input id="invoiceVendorFeesTotalDisplay" readonly aria-readonly="true" value="${money(0)}"></div>
        <div><span>Subtotal</span><input id="invoiceSubtotalDisplay" readonly aria-readonly="true" value="${money(0)}"></div>
        <div><span>Sales Tax</span><input id="invoiceTaxDisplay" readonly aria-readonly="true" value="${money(editing?.tax_amount || 0)}"></div>
        <div class="invoice-total-row"><span>Invoice Total</span><input id="invoiceTotalDisplay" readonly aria-readonly="true" value="${money(editing?.total_amount || 0)}"></div>
        <div><span>Credits / Payments Applied</span><input id="invoiceCreditsDisplay" readonly aria-readonly="true" value="${money(editing?.amount_paid || 0)}"></div>
        <div class="invoice-balance-row"><span>Balance Due</span><input id="invoiceBalanceDisplay" readonly aria-readonly="true" value="${money((Number(editing?.total_amount || 0) - Number(editing?.amount_paid || 0)) || 0)}"></div>
      </div>
    </section>

    <section class="invoice-sheet-section invoice-editor-section invoice-terms-notes-section" aria-labelledby="${formId}TermsHeading">
      <div class="invoice-editor-section-head"><span>7</span><div><h3 id="${formId}TermsHeading">Terms and Notes</h3><p>Keep client-facing terms separate from internal ForgeOps context.</p></div></div>
      <div class="invoice-terms-notes-grid">
        <div class="invoice-terms-field">${savedTermsControlHtml({templates:termsTemplates, appliesTo:'invoice', formId})}<label>Payment Terms & Conditions<span>Included in the client-facing printout.</span><textarea name="terms" rows="6">${escapeHtml(terms)}</textarea></label></div>
        <label>Internal Notes<span>Retained with the Invoice; existing print behavior is unchanged.</span><textarea name="notes" rows="6" placeholder="Internal context, reminders, or follow-up notes">${escapeHtml(editing?.notes)}</textarea></label>
      </div>
      <div class="invoice-print-note"><strong>Print content preserved</strong><span>Client approval and signature lines remain in the printed Invoice and Ledger packet.</span></div>
    </section>

    <footer class="form-actions invoice-editor-actions"><div class="invoice-editor-footer-total"><span>Balance Due</span><strong data-invoice-sticky-balance>${money((Number(editing?.total_amount || 0) - Number(editing?.amount_paid || 0)) || 0)}</strong></div><div class="invoice-editor-action-buttons"><button class="ghost invoice-cancel" type="button">Cancel</button>${editing ? `<button class="ghost" type="button" data-action="print" data-type="invoice" data-id="${editing.id}">Print</button>` : ''}<button class="primary" type="submit">${editing ? 'Update Invoice' : 'Create Invoice'}</button></div></footer>
  </form>`;
}

function invoiceEditorShellHtml({editing=null, closeButtonId='', ...options}) {
  const formId = options.formId || 'invoiceForm';
  const closeId = closeButtonId ? ` id="${closeButtonId}"` : '';
  return `<div class="modal-card wide-modal invoice-editor-shell"><header class="modal-header invoice-editor-header"><div><p class="invoice-editor-eyebrow">Invoice workflow</p><h2 id="${formId}Title">${editing ? 'Edit Invoice' : 'Create Invoice'}</h2><p>${editing ? 'Review billing details, applied payments, and the current balance.' : 'Bill actual labor and additional materials for a client or project.'}</p></div><button class="ghost modal-close"${closeId} type="button" aria-label="Close invoice form">×</button></header>${invoiceInternalSheetHtml({editing, ...options})}</div>`;
}

function invoiceLaborRowHtml(entry, currentInvoiceId=null) {
  const linkedToCurrent = currentInvoiceId && Number(entry.invoice_id) === Number(currentInvoiceId);
  const checked = linkedToCurrent || (!currentInvoiceId && !entry.is_invoiced);
  return `<article class="invoice-labor-row invoice-labor-card" data-labor-id="${entry.id}" data-line-total="${Number(entry.line_total || 0)}">
    <label class="invoice-labor-select"><input class="invoice-labor-check" type="checkbox" ${checked ? 'checked' : ''}><span>Use</span></label>
    <span class="invoice-labor-status"><small>Status</small><span class="status">${statusLabel(entry.status)}</span></span>
    <span><small>Date</small>${escapeHtml(entry.work_date || '')}</span>
    <span class="invoice-labor-service"><small>Service</small><strong>${escapeHtml(entry.service_type || '')}</strong></span>
    <span><small>Hours</small>${escapeHtml(entry.hours || '0.00')}</span>
    <span><small>Rate</small>${money(entry.hourly_rate || 0)}</span>
    <span><small>Line total</small><strong>${money(entry.line_total || 0)}</strong></span>
    <span class="invoice-notes-cell"><small>Notes</small>${escapeHtml(entry.notes || 'No notes')}</span>
  </article>`;
}

function invoiceVendorFeeRowHtml(item={}) {
  const amount = item.line_total ?? item.unit_price ?? '0.00';
  return `<article class="invoice-vendor-fee-row invoice-line-card" data-kind="vendor_fee">
    <label class="invoice-line-field invoice-line-description"><span>Fee name</span><input name="invoice_vendor_fee_name" required maxlength="500" placeholder="Shipping, permit, delivery..." value="${escapeHtml(item.description || '')}"></label>
    <label class="invoice-line-field"><span>Amount</span><input name="invoice_vendor_fee_amount" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(amount)}"></label>
    <button class="mini danger-mini invoice-remove-line" type="button" aria-label="Remove vendor fee">Remove</button>
  </article>`;
}

function wireInvoiceLineEditor(container) {
  const form = container.querySelector('.invoice-internal-sheet');
  if (!form) return;
  const materialRows = form.querySelector('#invoiceMaterialRows');
  const vendorFeeRows = form.querySelector('#invoiceVendorFeeRows');
  const creditRows = form.querySelector('#invoiceCreditRows');
  const addMaterial = form.querySelector('#addInvoiceMaterialLine');
  const addVendorFee = form.querySelector('#addInvoiceVendorFee');
  const addCredit = form.querySelector('#addInvoiceCreditLine');
  if (addMaterial) addMaterial.onclick = () => {
    materialRows?.insertAdjacentHTML('beforeend', invoiceMaterialRowHtml({quantity:'1.00', unit_price:'0.00', line_total:'0.00'}));
    wireInvoiceLineEditor(container); recalcInvoiceEditor(container);
  };
  if (addVendorFee) addVendorFee.onclick = () => {
    vendorFeeRows?.insertAdjacentHTML('beforeend', invoiceVendorFeeRowHtml({line_total:'0.00'}));
    wireInvoiceLineEditor(container); recalcInvoiceEditor(container);
    vendorFeeRows?.lastElementChild?.querySelector('[name="invoice_vendor_fee_name"]')?.focus();
  };
  if (addCredit) addCredit.onclick = () => {
    creditRows?.insertAdjacentHTML('beforeend', invoiceCreditRowHtml({kind:'payment', line_total:'0.00'}));
    wireInvoiceLineEditor(container); recalcInvoiceEditor(container);
  };
  form.querySelectorAll('.invoice-remove-line').forEach(btn => btn.onclick = () => { btn.closest('.invoice-material-row,.invoice-vendor-fee-row,.invoice-credit-row')?.remove(); recalcInvoiceEditor(container); });
  form.querySelectorAll('#invoiceMaterialRows input,#invoiceMaterialRows select,#invoiceVendorFeeRows input,#invoiceCreditRows input,#invoiceCreditRows select').forEach(el => el.oninput = () => recalcInvoiceEditor(container));
}

function recalcInvoiceEditor(container) {
  const form = container.querySelector('.invoice-internal-sheet');
  if (!form) return {subtotal:0,tax:0,total:0,paid:0,balance:0,laborIds:[],lineItems:[]};
  const selectedRows = [...form.querySelectorAll('.invoice-labor-row')].filter(row => row.querySelector('.invoice-labor-check')?.checked);
  const laborTotal = selectedRows.reduce((sum, row) => sum + Number(row.dataset.lineTotal || 0), 0);
  const lineItems = [];
  [...form.querySelectorAll('.invoice-material-row')].forEach((row, index) => {
    const description = row.querySelector('[name="material_description"]')?.value?.trim() || '';
    const quantity = Number(row.querySelector('[name="material_quantity"]')?.value || 0);
    const unitPrice = Number(row.querySelector('[name="material_unit_price"]')?.value || 0);
    const lineTotal = quantity * unitPrice;
    const display = row.querySelector('[name="material_line_total"]');
    if (display) display.value = money(lineTotal);
    if (description || lineTotal > 0) lineItems.push({kind:'material', description: description || 'Additional parts/materials', quantity: decimalString(quantity), unit_price: decimalString(unitPrice), line_total: decimalString(lineTotal), taxable: true, sort_order: (index + 1) * 10});
  });
  [...form.querySelectorAll('.invoice-vendor-fee-row')].forEach((row, index) => {
    const description = row.querySelector('[name="invoice_vendor_fee_name"]')?.value?.trim() || '';
    const amount = Number(row.querySelector('[name="invoice_vendor_fee_amount"]')?.value || 0);
    if (description || amount > 0) lineItems.push({kind:'vendor_fee', description, quantity:'1.00', unit_price:decimalString(amount), line_total:decimalString(amount), taxable:true, sort_order:500 + ((index + 1) * 10)});
  });
  [...form.querySelectorAll('.invoice-credit-row')].forEach((row, index) => {
    const kind = row.querySelector('[name="credit_kind"]')?.value || 'payment';
    const description = row.querySelector('[name="credit_description"]')?.value?.trim() || statusLabel(kind);
    const amount = Number(row.querySelector('[name="credit_amount"]')?.value || 0);
    if (description || amount > 0) lineItems.push({kind, description, quantity: '1.00', unit_price: decimalString(amount), line_total: decimalString(amount), taxable: false, sort_order: 1000 + ((index + 1) * 10)});
  });
  const taxRate = percentSetting(form.dataset.salesTaxRate || '0.07', 0.07);
  const totals = calculateInvoiceTotals({laborTotal, lineItems, salesTaxRate:taxRate});
  const laborIds = selectedRows.map(row => Number(row.dataset.laborId)).filter(Boolean);
  const setVal = (name, value) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.value = decimalString(value); };
  setVal('subtotal', totals.subtotal); setVal('tax_amount', totals.tax); setVal('total_amount', totals.total); setVal('amount_paid', totals.paid);
  const display = (selector, value) => { form.querySelectorAll(selector).forEach(el => { if ('value' in el) el.value = money(value); else el.textContent = money(value); }); };
  display('#invoiceLaborTotalDisplay', laborTotal);
  display('#invoiceLaborTotalDisplay2', laborTotal);
  display('#invoiceMaterialsTotalDisplay', totals.materialsTotal);
  display('#invoiceVendorFeesTotalDisplay', totals.vendorFeesTotal);
  display('#invoiceSubtotalDisplay', totals.subtotal);
  display('#invoiceTaxDisplay', totals.tax);
  display('#invoiceTotalDisplay', totals.total);
  display('#invoiceCreditsDisplay', totals.paid);
  display('#invoiceBalanceDisplay', totals.balance);
  display('[data-invoice-sticky-balance]', totals.balance);
  return {...totals, laborIds, lineItems};
}

async function refreshInvoiceLaborRows(container, {clientId='', projectId='', invoiceId=null}={}) {
  const rows = container.querySelector('.invoice-labor-rows');
  if (!rows) return;
  if (!clientId) {
    rows.innerHTML = '<div class="invoice-empty-row">Select a client to load available labor.</div>';
    recalcInvoiceEditor(container);
    return;
  }
  rows.innerHTML = '<div class="invoice-empty-row">Loading labor entries...</div>';
  const params = new URLSearchParams({client_id: String(clientId), page_size: '100'});
  if (projectId) params.set('project_id', String(projectId));
  try {
    const data = await api(`/api/labor?${params.toString()}`);
    const items = (data.items || []).filter(entry => {
      const linkedToCurrent = invoiceId && Number(entry.invoice_id) === Number(invoiceId);
      const usable = !entry.is_invoiced || linkedToCurrent;
      return usable && Number(entry.hours || 0) > 0;
    });
    rows.innerHTML = items.length
      ? items.map(entry => invoiceLaborRowHtml(entry, invoiceId)).join('')
      : '<div class="invoice-empty-row">No available uninvoiced labor found for this selection.</div>';
    rows.querySelectorAll('.invoice-labor-check').forEach(check => check.addEventListener('change', () => recalcInvoiceEditor(container)));
  } catch (err) {
    rows.innerHTML = `<div class="invoice-empty-row error-text">Could not load labor: ${escapeHtml(err.message)}</div>`;
  }
  recalcInvoiceEditor(container);
}

async function wireInvoiceInternalForm(container, {formId, clientSelectId=null, projectSelectId, quoteSelectId, editing=null, scopedClientId=null, onSave}) {
  const form = container.querySelector(`#${formId}`);
  if (!form) return;
  form.status.value = editing?.status || 'draft';
  const clientSelect = clientSelectId ? container.querySelector(`#${clientSelectId}`) : null;
  const projectSelect = container.querySelector(`#${projectSelectId}`);
  const quoteSelect = container.querySelector(`#${quoteSelectId}`);
  const currentClientId = () => scopedClientId || clientSelect?.value || editing?.client_id || '';
  const currentProjectId = () => projectSelect?.value || '';
  const reloadLabor = () => refreshInvoiceLaborRows(container, {clientId: currentClientId(), projectId: currentProjectId(), invoiceId: editing?.id || null});
  if (clientSelect) {
    clientSelect.onchange = () => {
      projectSelect.innerHTML = projectOptions('', clientSelect.value);
      quoteSelect.innerHTML = quoteOptions('', clientSelect.value, '');
      reloadLabor();
    };
  }
  if (projectSelect) {
    projectSelect.onchange = () => {
      quoteSelect.innerHTML = quoteOptions('', currentClientId(), projectSelect.value);
      reloadLabor();
    };
  }
  wireInvoiceLineEditor(container);
  wireTermsTemplateApply(container, formId, state.termsTemplates);
  form.querySelector('.invoice-cancel')?.addEventListener('click', () => container.querySelector('.modal-close')?.click());
  await reloadLabor();
  recalcInvoiceEditor(container);
  form.onsubmit = async e => {
    e.preventDefault();
    const totals = recalcInvoiceEditor(container);
    const payload = clean(formData(form));
    payload.client_id = Number(payload.client_id || scopedClientId);
    numOrDelete(payload, 'project_id');
    numOrDelete(payload, 'quote_id');
    payload.subtotal = decimalString(totals.subtotal || 0);
    payload.tax_amount = decimalString(totals.tax || 0);
    payload.total_amount = decimalString(totals.total || 0);
    payload.amount_paid = decimalString(totals.paid || 0);
    payload.labor_entry_ids = totals.laborIds;
    payload.line_items = totals.lineItems;
    await onSave(payload);
  };
}

async function nextQuoteNumber() { try { return (await api('/api/quotes/next-number')).quote_number; } catch { return stamp('FS-QUOTE'); } }
async function nextInvoiceNumber() { try { return (await api('/api/invoices/next-number')).invoice_number; } catch { return stamp('FS-INV'); } }
function statusLabel(value) { if (['income','revenue','cogs','expense'].includes(String(value || ''))) return escapeHtml(ledgerKindLabel(value)); return escapeHtml(String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())); }
function clean(obj) { for (const k of Object.keys(obj)) { if (obj[k] === '') delete obj[k]; } return obj; }
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function formBool(form, name) { return form.querySelector(`[name="${name}"]`)?.checked || false; }
function numOrDelete(data, key) { if (data[key] === '' || data[key] === undefined) delete data[key]; else data[key] = Number(data[key]); }
function invalidateLookups() {
  state.lookupCacheAt = 0;
  state.lookupCachePromise = null;
}

async function api(url, options={}) {
  const headers = options.body instanceof FormData ? {} : {'Content-Type':'application/json'};
  const method = String(options.method || 'GET').toUpperCase();
  const res = await fetch(url, { credentials: 'same-origin', headers, ...options });
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = payload?.detail || payload?.message || payload || 'Request failed';
    throw new Error(Array.isArray(detail) ? detail.map(d => d.msg).join(', ') : detail);
  }
  if (method !== 'GET') invalidateLookups();
  return payload;
}

async function saveLedgerEntryWithReceipt(form, payload, editing=null) {
  const fileInput = form.querySelector('input[name="receipt_file"]');
  const receiptFile = fileInput?.files?.[0];
  let entry;
  if (editing) entry = await api(`/api/ledger/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)});
  else entry = await api('/api/ledger', {method:'POST', body: JSON.stringify(payload)});

  if (receiptFile) {
    const fd = new FormData();
    fd.append('file', receiptFile);
    const receipt = await api('/api/receipts', {method:'POST', body: fd});
    const patch = {
      linked_type: 'ledger_entry',
      linked_id: entry.id,
      vendor_name: payload.description || null,
      receipt_date: payload.entry_date || null,
      total_amount: payload.amount ?? null,
      category: payload.category || null,
      status: 'attached',
    };
    const updatedReceipt = await api(`/api/receipts/${receipt.id}`, {method:'PATCH', body: JSON.stringify(patch)});
    entry = await api(`/api/ledger/${entry.id}`, {method:'PATCH', body: JSON.stringify({receipt_id: updatedReceipt.id})});
  }
  return entry;
}

const THEME_STORAGE_KEY = 'forgeops-theme';
const THEME_COLORS = { light: '#10233c', dark: '#0b1420' };
let activeShellDialog = null;
let activeShellOpener = null;

function applyTheme(theme, persist=false) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = selected;
  document.documentElement.style.colorScheme = selected;
  document.querySelector('#themeColorMeta')?.setAttribute('content', THEME_COLORS[selected]);
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, selected); } catch (_) { /* Theme still applies for this page. */ }
  }
  const nextLabel = selected === 'dark' ? 'Light theme' : 'Dark theme';
  const accessibleLabel = selected === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  document.querySelectorAll('[data-theme-label]').forEach(label => { label.textContent = nextLabel; });
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-label', accessibleLabel);
    button.setAttribute('title', accessibleLabel);
  });
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
}

function shellDialogFocusables(dialog) {
  return [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.closest('.hidden'));
}

function hasOpenBusinessModal() {
  return [...document.querySelectorAll('.modal-backdrop:not(.hidden)')].some(modal => !modal.closest('.shell-dialog'));
}

function openShellDialog(id, opener) {
  const dialog = document.querySelector(`#${id}`);
  if (!dialog || hasOpenBusinessModal()) return false;
  if (activeShellDialog && activeShellDialog !== dialog) closeShellDialog(activeShellDialog.id, false);
  activeShellDialog = dialog;
  activeShellOpener = opener || document.activeElement;
  dialog.classList.remove('hidden');
  document.body.classList.add('shell-dialog-open');
  const appView = document.querySelector('#appView');
  if (appView && !appView.classList.contains('hidden')) appView.inert = true;
  if (id === 'mobileToolsMenu') document.querySelector('#mobileToolsBtn')?.setAttribute('aria-expanded', 'true');
  setTimeout(() => (shellDialogFocusables(dialog)[0] || dialog.querySelector('.shell-sheet'))?.focus(), 0);
  return true;
}

function closeShellDialog(id=activeShellDialog?.id, restoreFocus=true) {
  const dialog = id ? document.querySelector(`#${id}`) : activeShellDialog;
  if (!dialog) return;
  dialog.classList.add('hidden');
  document.body.classList.remove('shell-dialog-open');
  const appView = document.querySelector('#appView');
  if (appView) appView.inert = false;
  document.querySelector('#mobileToolsBtn')?.setAttribute('aria-expanded', 'false');
  const opener = activeShellOpener;
  if (dialog === activeShellDialog) {
    activeShellDialog = null;
    activeShellOpener = null;
  }
  if (restoreFocus && opener?.isConnected) setTimeout(() => opener.focus(), 0);
}

function trapShellDialogFocus(event) {
  if (!activeShellDialog) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeShellDialog();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = shellDialogFocusables(activeShellDialog);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function updateActiveNavigation(page) {
  document.querySelectorAll('.nav[data-page]').forEach(button => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const mobileTitle = document.querySelector('#mobilePageTitle');
  if (mobileTitle) mobileTitle.textContent = titles[page]?.[0] || 'ForgeOps';
}

async function navigateFromNavigation(page) {
  closeShellDialog(activeShellDialog?.id, false);
  if (state.page === page && root.innerHTML.trim()) return;
  await loadPage(page);
}

const QUICK_CREATE_ACTIONS = {
  client: { page: 'clients', control: 'openClientModal' },
  project: { page: 'projects', control: 'openProjectModal' },
  labor: { page: 'labor', control: 'openLaborModal' },
  expense: { page: 'ledger', control: 'openLedgerModal' },
  quote: { page: 'quotes', control: 'openQuoteModal' },
  invoice: { page: 'invoices', control: 'openInvoiceModal' },
};

async function runQuickCreate(action) {
  const target = QUICK_CREATE_ACTIONS[action];
  if (!target) return;
  closeShellDialog('quickCreateSheet', false);
  if (state.page !== target.page || !root.innerHTML.trim()) await loadPage(target.page);
  const openControl = document.querySelector(`#${target.control}`);
  if (!openControl) {
    show('That create form is not available right now.');
    return;
  }
  openControl.click();
  if (action === 'expense') {
    const kind = document.querySelector('#ledgerForm [name="kind"]');
    if (kind) {
      kind.value = 'expense';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {
        // PWA support is optional; the app should continue working if registration fails.
      });
    });
  }
}

async function createInitialAccount(e) {
  e.preventDefault();
  setupError.textContent = '';
  try {
    const payload = {
      full_name: document.querySelector('#setupFullName').value,
      email: document.querySelector('#setupEmail').value,
      password: document.querySelector('#setupPassword').value,
    };
    await api('/api/setup/account', { method: 'POST', body: JSON.stringify(payload) });
    document.querySelector('#setupView').classList.add('hidden');
    document.querySelector('#appView').classList.remove('hidden');
    await refreshCurrentUser();
    await loadPage('dashboard');
  } catch (err) { setupError.textContent = err.message; }
}

async function restoreInitialBackup(e) {
  e.preventDefault();
  setupError.textContent = '';
  const shouldRestore = await askForgeOpsDialog({
    title: 'Restore Backup?',
    message: 'Restore this backup now? This only runs during initial setup.',
    kind: 'destructive',
    primaryButtonText: 'Restore Backup',
    cancelButtonText: 'Cancel',
  });
  if (!shouldRestore) return;
  const form = document.querySelector('#setupRestoreForm');
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Restoring...';
  try {
    const fd = new FormData(form);
    const result = await api('/api/setup/restore', { method: 'POST', body: fd });
    const counts = result.restored_counts || {};
    setupError.textContent = `Restore completed. Clients: ${counts.clients ?? 0}, Projects: ${counts.projects ?? 0}, Quotes: ${counts.quotes ?? 0}, Invoices: ${counts.invoices ?? 0}. Reloading...`;
    setTimeout(() => window.location.href = `/?initial_restore=${Date.now()}`, 900);
  } catch (err) {
    setupError.textContent = err.message;
    button.disabled = false;
    button.textContent = 'Restore From Backup';
  }
}

function showSetupPane(which) {
  const create = which === 'create';
  document.querySelector('#setupAccountForm').classList.toggle('hidden', !create);
  document.querySelector('#setupRestoreForm').classList.toggle('hidden', create);
  document.querySelector('#showCreateSetup').classList.toggle('active', create);
  document.querySelector('#showRestoreSetup').classList.toggle('active', !create);
  document.querySelector('#showCreateSetup').setAttribute('aria-selected', create ? 'true' : 'false');
  document.querySelector('#showRestoreSetup').setAttribute('aria-selected', create ? 'false' : 'true');
  setupError.textContent = '';
}

async function login(e) {
  e.preventDefault();
  loginError.textContent = '';
  try {
    const payload = { email: email.value, password: password.value, remember_me: rememberMe.checked };
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    document.querySelector('#loginView').classList.add('hidden');
    document.querySelector('#appView').classList.remove('hidden');
    await refreshCurrentUser();
    await loadPage('dashboard');
  } catch (err) { loginError.textContent = err.message; }
}
async function logout() { await api('/api/auth/logout', {method:'POST'}); location.reload(); }

async function refreshCurrentUser() {
  try {
    state.user = await api('/api/auth/me');
    const userBtn = document.querySelector('#userBtn');
    if (userBtn) userBtn.title = state.user?.full_name ? `User Profile: ${state.user.full_name}` : 'User Profile';
    const mobileUserBtn = document.querySelector('#mobileUserBtn');
    if (mobileUserBtn) mobileUserBtn.title = state.user?.full_name ? `User Profile: ${state.user.full_name}` : 'User Profile';
  } catch {
    state.user = null;
    const userBtn = document.querySelector('#userBtn');
    if (userBtn) userBtn.title = 'User Profile';
  }
}

function closeUserModal() {
  document.querySelector('#userProfileModal')?.remove();
}

async function openUserModal() {
  await refreshCurrentUser();
  if (!state.user) {
    await showForgeOpsNotice({title:'Session Expired', message:'Please sign in again.', kind:'warning'});
    return;
  }
  closeUserModal();
  const wrapper = document.createElement('div');
  wrapper.id = 'userProfileModal';
  wrapper.className = 'modal-backdrop';
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');
  wrapper.innerHTML = `<div class="modal-card"><div class="modal-header"><div><h2>User Settings</h2><p>Update your name, email, or password.</p></div><button class="ghost modal-close" type="button" aria-label="Close user settings">×</button></div>
    <form id="userProfileForm" class="form-grid">
      <label>Full Name<input name="full_name" required maxlength="120" value="${escapeHtml(state.user.full_name || '')}"></label>
      <label>Email<input name="email" type="email" required maxlength="255" value="${escapeHtml(state.user.email || '')}"></label>
      <div class="full section-bar">Password</div>
      <p class="full muted">Leave these blank unless you want to change your password.</p>
      <label>Current Password<input name="current_password" type="password" autocomplete="current-password"></label>
      <label>New Password<input name="new_password" type="password" minlength="8" autocomplete="new-password"></label>
      <div class="full modal-actions"><button class="primary" type="submit">Save User</button><button class="ghost" type="button" id="cancelUserProfile">Cancel</button></div>
    </form></div>`;
  document.body.appendChild(wrapper);
  const close = () => closeUserModal();
  wrapper.querySelector('.modal-close')?.addEventListener('click', close);
  wrapper.querySelector('#cancelUserProfile')?.addEventListener('click', close);
  wrapper.addEventListener('click', e => { if (e.target === wrapper) close(); });
  const escClose = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', escClose); close(); } };
  document.addEventListener('keydown', escClose);
  const form = wrapper.querySelector('#userProfileForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const payload = clean(formData(form));
    if (!payload.new_password) {
      delete payload.new_password;
      delete payload.current_password;
    }
    try {
      await api('/api/auth/me', {method:'PATCH', body: JSON.stringify(payload)});
      await refreshCurrentUser();
      show('User settings saved');
      close();
    } catch (err) {
      await showForgeOpsError(err);
    }
  });
  setTimeout(() => form.querySelector('input[name="full_name"]')?.focus(), 0);
}

async function preloadLookups(force=false) {
  const now = Date.now();
  if (!force && state.lookupCachePromise && now - state.lookupCacheAt < 30000) return state.lookupCachePromise;
  state.lookupCachePromise = (async () => {
    const [clients, projects, quotes, invoices, termsTemplates, ledgerCategories, serviceTypes, salesTaxPeriods] = await Promise.allSettled([
      api('/api/clients?page_size=100'),
      api('/api/projects?page_size=100'),
      api('/api/quotes?page_size=100'),
      api('/api/invoices?page_size=100'),
      api('/api/terms'),
      api('/api/dropdowns?kind=ledger_category&page_size=100'),
      api('/api/dropdowns?kind=service_type&page_size=100'),
      api('/api/reports/ny-sales-tax-periods'),
    ]);
    state.clients = clients.status === 'fulfilled' ? clients.value.items : [];
    state.projects = projects.status === 'fulfilled' ? projects.value.items : [];
    state.quotes = quotes.status === 'fulfilled' ? quotes.value.items : [];
    state.invoices = invoices.status === 'fulfilled' ? invoices.value.items : [];
    state.termsTemplates = termsTemplates.status === 'fulfilled' ? termsTemplates.value.items : [];
    state.dropdowns.ledger_category = ledgerCategories.status === 'fulfilled' ? ledgerCategories.value.items : [];
    state.dropdowns.service_type = serviceTypes.status === 'fulfilled' ? serviceTypes.value.items : [];
    state.salesTaxPeriods = salesTaxPeriods.status === 'fulfilled' ? salesTaxPeriods.value.items : [];
    state.lookupCacheAt = Date.now();
  })();
  return state.lookupCachePromise;
}
async function ensureAddresses(clientId) {
  if (!clientId) return [];
  if (!state.addressesByClient[clientId]) {
    try { state.addressesByClient[clientId] = (await api(`/api/clients/${clientId}/addresses`)).items; }
    catch { state.addressesByClient[clientId] = []; }
  }
  return state.addressesByClient[clientId];
}
function addressOptions(addresses, selected='') {
  return `<option value="">Select saved address...</option>${addresses.map(a => `<option value="${escapeHtml(a.address)}" ${String(selected)===String(a.address)?'selected':''}>${escapeHtml(a.label)} — ${escapeHtml(a.address)}</option>`).join('')}<option value="__new__">+ Add new address</option>`;
}
async function loadPage(page) {
  state.page = page; state.editing = null; state.clientDetailId = null; state.projectDetailId = null;
  root.innerHTML = '<div class="panel"><p class="muted">Loading...</p></div>';
  updateActiveNavigation(page);
  document.querySelector('#pageTitle').textContent = titles[page][0];
  document.querySelector('#pageSubtitle').textContent = titles[page][1];
  await preloadLookups();
  if (page === 'dashboard') return renderDashboard();
  if (page === 'clients') return renderClients();
  if (page === 'projects') return renderProjects();
  if (page === 'quotes') return renderQuotes();
  if (page === 'invoices') return renderInvoices();
  if (page === 'ledger') return renderLedger();
  if (page === 'labor') return renderLabor();
  if (page === 'reports') return renderReports();
  if (page === 'admin') return renderAdmin();
}


function attachPageSearch(inputId, emptyText='No records match that search.') {
  const input = document.querySelector(`#${inputId}`);
  const tableEl = root.querySelector('.table-wrap table');
  if (!input || !tableEl) return;
  const tbody = tableEl.querySelector('tbody');
  const colCount = tableEl.querySelectorAll('thead th').length || 1;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    [...tbody.querySelectorAll('tr')].forEach(row => {
      if (row.dataset.searchEmpty === 'true') return;
      const visible = !q || row.textContent.toLowerCase().includes(q);
      row.classList.toggle('hidden', !visible);
      if (visible) shown += 1;
    });
    let empty = tbody.querySelector('[data-search-empty="true"]');
    if (!shown && q) {
      if (!empty) {
        empty = document.createElement('tr');
        empty.dataset.searchEmpty = 'true';
        empty.innerHTML = `<td colspan="${colCount}">${emptyText}</td>`;
        tbody.appendChild(empty);
      }
      empty.classList.remove('hidden');
    } else if (empty) empty.classList.add('hidden');
  });
}

function table(headers, rows, className='', rowAttrs=[]) {
  const wrapClass = className ? `table-wrap ${className}` : 'table-wrap';
  return `<div class="panel"><div class="${wrapClass}"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r, rowIndex)=>`<tr ${rowAttrs[rowIndex] || ''}>${r.map((c, i)=>`<td data-label="${escapeHtml(headers[i])}">${c??''}</td>`).join('')}</tr>`).join('') : `<tr class="table-empty-row"><td colspan="${headers.length}">No records yet.</td></tr>`}</tbody></table></div></div>`;
}
function rowActions(type, id) {
  const printableTypes = new Set(['quote', 'invoice', 'ledger']);
  const print = printableTypes.has(type) ? `<button class="mini" data-action="print" data-type="${type}" data-id="${id}">Print</button>` : '';
  return `<div class="row-actions"><button class="mini" data-action="edit" data-type="${type}" data-id="${id}">Edit</button>${print}<button class="mini danger-mini" data-action="delete" data-type="${type}" data-id="${id}">Delete</button></div>`;
}

function quoteRowActions(id) {
  return `<div class="row-actions quote-invoice-actions"><button class="mini" data-action="edit" data-type="quote" data-id="${id}">Edit</button><button class="mini" data-action="print" data-type="quote" data-id="${id}">Print</button><button class="mini" data-action="create-invoice-from-quote" data-quote-id="${id}">Create Invoice</button><button class="mini danger-mini" data-action="delete" data-type="quote" data-id="${id}">Delete</button></div>`;
}

function invoiceCardHtml(invoice) {
  const project = projectName(invoice.project_id);
  return `<article class="invoice-record-card" data-invoice-card data-invoice-id="${Number(invoice.id)}">
    <button class="invoice-card-open" type="button" data-invoice-id="${Number(invoice.id)}" aria-label="Open invoice ${escapeHtml(invoice.invoice_number)}">
      <span class="invoice-card-top"><strong>${escapeHtml(invoice.invoice_number)}</strong><span class="status">${statusLabel(invoice.status)}</span></span>
      <span class="invoice-card-main"><b>${escapeHtml(invoice.title)}</b><span>${escapeHtml(clientName(invoice.client_id))}</span>${project ? `<span>${escapeHtml(project)}</span>` : ''}</span>
      <span class="invoice-card-bottom"><span><small>Due</small><b>${invoice.due_date ? shortDate(invoice.due_date) : 'No due date'}</b></span><span><small>Total</small><strong>${money(invoice.total_amount)}</strong></span><span class="invoice-card-balance"><small>Balance</small><strong>${money(invoice.balance_due)}</strong></span></span>
    </button>
    <div class="invoice-card-actions">${rowActions('invoice', invoice.id)}</div>
  </article>`;
}

function invoiceListEmptyHtml({filtered=false, search=false}={}) {
  if (search) return `<section class="panel invoice-list-empty hidden" id="invoiceSearchEmpty"><strong>No invoices match this search.</strong><span>Try another search or reset the filters.</span><button class="ghost" type="button" data-reset-invoice-filters>Reset Filters</button></section>`;
  if (filtered) return `<section class="panel invoice-list-empty"><strong>No invoices match these filters.</strong><span>Reset the filters to see every Invoice.</span><button class="ghost" type="button" data-reset-invoice-filters>Reset Filters</button></section>`;
  return `<section class="panel invoice-list-empty"><strong>No invoices yet.</strong><span>Create an Invoice to bill actual labor and additional materials.</span><button class="primary" id="emptyAddInvoice" type="button">Add Invoice</button></section>`;
}

function attachInvoiceSearch(visibleCount) {
  const input = root.querySelector('#invoiceSearch');
  if (!input) return;
  const tableRows = [...root.querySelectorAll('.invoices-table .invoice-record-row[data-invoice-id]')];
  const cards = [...root.querySelectorAll('[data-invoice-card]')];
  const empty = root.querySelector('#invoiceSearchEmpty');
  const resultCount = root.querySelector('#invoiceResultCount');
  const apply = () => {
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach(card => {
      const visible = !query || card.textContent.toLowerCase().includes(query);
      card.classList.toggle('hidden', !visible);
      if (visible) shown += 1;
    });
    tableRows.forEach(row => row.classList.toggle('hidden', Boolean(query) && !row.textContent.toLowerCase().includes(query)));
    empty?.classList.toggle('hidden', !query || shown > 0);
    if (resultCount) resultCount.textContent = query ? `${shown} of ${visibleCount} invoice${visibleCount === 1 ? '' : 's'}` : `${visibleCount} invoice${visibleCount === 1 ? '' : 's'}`;
  };
  input.addEventListener('input', apply);
  apply();
}

function quoteCardHtml(quote) {
  const project = projectName(quote.project_id);
  return `<article class="quote-record-card" data-quote-card data-quote-id="${Number(quote.id)}">
    <button class="quote-card-open" type="button" data-quote-id="${Number(quote.id)}" aria-label="Open quote ${escapeHtml(quote.quote_number)}">
      <span class="quote-card-top"><strong>${escapeHtml(quote.quote_number)}</strong><span class="status">${statusLabel(quote.status)}</span></span>
      <span class="quote-card-main"><b>${escapeHtml(quote.title)}</b><span>${escapeHtml(clientName(quote.client_id))}</span>${project ? `<span>${escapeHtml(project)}</span>` : ''}</span>
      <span class="quote-card-bottom"><span><small>Total</small><strong>${money(quote.total_amount)}</strong></span><span><small>Issued</small><b>${shortDate(quote.quote_date)}</b></span>${quote.valid_until ? `<span><small>Valid through</small><b>${shortDate(quote.valid_until)}</b></span>` : ''}</span>
    </button>
    <div class="quote-card-actions">${quoteRowActions(quote.id)}</div>
  </article>`;
}

function quoteListEmptyHtml({filtered=false, search=false}={}) {
  if (search) return `<section class="panel quote-list-empty hidden" id="quoteSearchEmpty"><strong>No quotes match this search.</strong><span>Try another search or reset the filters.</span><button class="ghost" type="button" data-reset-quote-filters>Reset Filters</button></section>`;
  if (filtered) return `<section class="panel quote-list-empty"><strong>No quotes match these filters.</strong><span>Reset the filters to see every quote.</span><button class="ghost" type="button" data-reset-quote-filters>Reset Filters</button></section>`;
  return `<section class="panel quote-list-empty"><strong>No quotes yet.</strong><span>Create a quote for a client or project to begin estimating work.</span><button class="primary" id="emptyAddQuote" type="button">Add Quote</button></section>`;
}

function attachQuoteSearch(visibleCount) {
  const input = root.querySelector('#quoteSearch');
  if (!input) return;
  const tableRows = [...root.querySelectorAll('.quotes-table .quote-record-row[data-quote-id]')];
  const cards = [...root.querySelectorAll('[data-quote-card]')];
  const empty = root.querySelector('#quoteSearchEmpty');
  const resultCount = root.querySelector('#quoteResultCount');
  const apply = () => {
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach(card => {
      const visible = !query || card.textContent.toLowerCase().includes(query);
      card.classList.toggle('hidden', !visible);
      if (visible) shown += 1;
    });
    tableRows.forEach(row => row.classList.toggle('hidden', Boolean(query) && !row.textContent.toLowerCase().includes(query)));
    empty?.classList.toggle('hidden', !query || shown > 0);
    if (resultCount) resultCount.textContent = query ? `${shown} of ${visibleCount} quote${visibleCount === 1 ? '' : 's'}` : `${visibleCount} quote${visibleCount === 1 ? '' : 's'}`;
  };
  input.addEventListener('input', apply);
  apply();
}

function setupModal(modalId, openButtonId, closeButtonId, cancelButtonId, editing, rerender, firstSelector='input,select,textarea') {
  const modal = document.querySelector(`#${modalId}`);
  const openBtn = document.querySelector(`#${openButtonId}`);
  const closeBtn = document.querySelector(`#${closeButtonId}`);
  const cancelBtn = document.querySelector(`#${cancelButtonId}`);
  const openModal = () => {
    modal.classList.remove('hidden');
    setTimeout(() => modal.querySelector(firstSelector)?.focus(), 0);
  };
  const closeModal = () => rerender();
  if (openBtn) openBtn.onclick = openModal;
  if (closeBtn) closeBtn.onclick = closeModal;
  if (cancelBtn) cancelBtn.onclick = closeModal;
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      document.removeEventListener('keydown', escClose);
      closeModal();
    }
  });
  if (editing) openModal();
}

function setupQuoteModal({editing=null, rerender}) {
  const modal = root.querySelector('#quoteModal');
  const openButton = root.querySelector('#openQuoteModal');
  if (!modal || !openButton) return;
  let inertPeers = [];
  const setBackgroundInert = active => {
    if (active) inertPeers = [...root.children].filter(child => child !== modal);
    inertPeers.forEach(child => { child.inert = active; });
  };
  const onKeydown = event => { if (event.key === 'Escape') closeModal(); };
  const openModal = () => {
    if (!state.quoteReturnFocusSelector) state.quoteReturnFocusSelector = '#openQuoteModal';
    modal.classList.remove('hidden');
    setBackgroundInert(true);
    setQuoteEditorPageState(true);
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => modal.querySelector(editing ? 'input[name="quote_number"]' : 'input[name="title"]')?.focus(), 0);
  };
  const closeModal = async () => {
    document.removeEventListener('keydown', onKeydown);
    setBackgroundInert(false);
    setQuoteEditorPageState(false);
    const focusSelector = state.quoteReturnFocusSelector || '#openQuoteModal';
    state.quoteReturnFocusSelector = '';
    await Promise.resolve(rerender());
    setTimeout(() => (root.querySelector(focusSelector) || root.querySelector('#openQuoteModal'))?.focus(), 0);
  };
  openButton.onclick = openModal;
  modal.querySelector('#closeQuoteModal')?.addEventListener('click', closeModal);
  modal.querySelector('#cancelQuoteModal')?.addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  if (editing) openModal();
}

function setQuoteEditorPageState(active) {
  document.body.classList.toggle('quote-editor-open', active);
  const mobileNavigation = document.querySelector('.mobile-bottom-nav');
  if (!mobileNavigation) return;
  mobileNavigation.inert = active;
  if (active) mobileNavigation.setAttribute('aria-hidden', 'true');
  else mobileNavigation.removeAttribute('aria-hidden');
}

function setInvoiceEditorPageState(active) {
  document.body.classList.toggle('invoice-editor-open', active);
  const mobileNavigation = document.querySelector('.mobile-bottom-nav');
  if (!mobileNavigation) return;
  mobileNavigation.inert = active;
  if (active) mobileNavigation.setAttribute('aria-hidden', 'true');
  else mobileNavigation.removeAttribute('aria-hidden');
}

function setLaborEditorPageState(active) {
  document.body.classList.toggle('labor-editor-open', active);
  const mobileNavigation = document.querySelector('.mobile-bottom-nav');
  if (!mobileNavigation) return;
  mobileNavigation.inert = active;
  if (active) mobileNavigation.setAttribute('aria-hidden', 'true');
  else mobileNavigation.removeAttribute('aria-hidden');
}

function setLedgerEditorPageState(active) {
  document.body.classList.toggle('ledger-editor-open', active);
  const mobileNavigation = document.querySelector('.mobile-bottom-nav');
  if (!mobileNavigation) return;
  mobileNavigation.inert = active;
  if (active) mobileNavigation.setAttribute('aria-hidden', 'true');
  else mobileNavigation.removeAttribute('aria-hidden');
}

function setupLedgerModal({editing=null, rerender}) {
  const modal = root.querySelector('#ledgerModal');
  const openButton = root.querySelector('#openLedgerModal');
  if (!modal || !openButton) return;
  let inertPeers = [];
  const setBackgroundInert = active => {
    if (active) inertPeers = [...root.children].filter(child => child !== modal);
    inertPeers.forEach(child => { child.inert = active; });
  };
  const onKeydown = event => { if (event.key === 'Escape') closeModal(); };
  const openModal = () => {
    if (!state.ledgerReturnFocusSelector) state.ledgerReturnFocusSelector = '#openLedgerModal';
    modal.classList.remove('hidden');
    setBackgroundInert(true);
    setLedgerEditorPageState(true);
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => modal.querySelector(editing ? 'select[name="kind"]' : 'input[name="entry_date"]')?.focus(), 0);
  };
  const closeModal = async () => {
    document.removeEventListener('keydown', onKeydown);
    setBackgroundInert(false);
    setLedgerEditorPageState(false);
    const focusSelector = state.ledgerReturnFocusSelector || '#openLedgerModal';
    state.ledgerReturnFocusSelector = '';
    await Promise.resolve(rerender());
    setTimeout(() => {
      const focusTarget = [...root.querySelectorAll(focusSelector)].find(element => element.offsetParent !== null) || root.querySelector('#openLedgerModal');
      focusTarget?.focus();
    }, 0);
  };
  modal._closeLedgerEditor = closeModal;
  openButton.onclick = openModal;
  modal.querySelector('#closeLedgerModal')?.addEventListener('click', closeModal);
  modal.querySelector('#cancelLedgerModal')?.addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  if (editing) openModal();
}

function setupLaborModal({editing=null, rerender}) {
  const modal = root.querySelector('#laborModal');
  const openButton = root.querySelector('#openLaborModal');
  if (!modal || !openButton) return;
  let inertPeers = [];
  const setBackgroundInert = active => {
    if (active) inertPeers = [...root.children].filter(child => child !== modal);
    inertPeers.forEach(child => { child.inert = active; });
  };
  const onKeydown = event => { if (event.key === 'Escape') closeModal(); };
  const openModal = () => {
    if (!state.laborReturnFocusSelector) state.laborReturnFocusSelector = '#openLaborModal';
    modal.classList.remove('hidden');
    setBackgroundInert(true);
    setLaborEditorPageState(true);
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => modal.querySelector(editing ? 'select[name="status"]' : 'input[name="work_date"]')?.focus(), 0);
  };
  const closeModal = async () => {
    document.removeEventListener('keydown', onKeydown);
    setBackgroundInert(false);
    setLaborEditorPageState(false);
    const focusSelector = state.laborReturnFocusSelector || '#openLaborModal';
    state.laborReturnFocusSelector = '';
    await Promise.resolve(rerender());
    setTimeout(() => (root.querySelector(focusSelector) || root.querySelector('#openLaborModal'))?.focus(), 0);
  };
  modal._closeLaborEditor = closeModal;
  openButton.onclick = openModal;
  modal.querySelector('#closeLaborModal')?.addEventListener('click', closeModal);
  modal.querySelector('#cancelLaborModal')?.addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  if (editing) openModal();
}

function setupInvoiceModal({editing=null, autoOpen=false, rerender}) {
  const modal = root.querySelector('#invoiceModal');
  const openButton = root.querySelector('#openInvoiceModal');
  if (!modal || !openButton) return;
  let inertPeers = [];
  const setBackgroundInert = active => {
    if (active) inertPeers = [...root.children].filter(child => child !== modal);
    inertPeers.forEach(child => { child.inert = active; });
  };
  const onKeydown = event => { if (event.key === 'Escape') closeModal(); };
  const openModal = () => {
    if (!state.invoiceReturnFocusSelector) state.invoiceReturnFocusSelector = '#openInvoiceModal';
    modal.classList.remove('hidden');
    setBackgroundInert(true);
    setInvoiceEditorPageState(true);
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => modal.querySelector(editing ? 'input[name="invoice_number"]' : 'input[name="title"]')?.focus(), 0);
  };
  const closeModal = async () => {
    document.removeEventListener('keydown', onKeydown);
    setBackgroundInert(false);
    setInvoiceEditorPageState(false);
    const focusSelector = state.invoiceReturnFocusSelector || '#openInvoiceModal';
    state.invoiceReturnFocusSelector = '';
    await Promise.resolve(rerender());
    setTimeout(() => (root.querySelector(focusSelector) || root.querySelector('#openInvoiceModal'))?.focus(), 0);
  };
  openButton.onclick = openModal;
  modal.querySelector('#closeInvoiceModal')?.addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  if (editing || autoOpen) openModal();
}

async function startInvoiceFromQuote(quoteId) {
  await preloadLookups(true);
  const quote = state.quotes.find(item => Number(item.id) === Number(quoteId));
  if (!quote) throw new Error('Could not find that Quote. Refresh and try again.');
  const linkedInvoices = state.invoices.filter(invoice => Number(invoice.quote_id) === Number(quoteId));
  if (linkedInvoices.length) {
    const numbers = linkedInvoices.slice(0, 4).map(invoice => invoice.invoice_number).filter(Boolean);
    const remaining = linkedInvoices.length - numbers.length;
    const references = numbers.length ? ` (${numbers.join(', ')}${remaining > 0 ? `, plus ${remaining} more` : ''})` : '';
    const noun = linkedInvoices.length === 1 ? 'invoice' : 'invoices';
    const shouldContinue = await askForgeOpsDialog({
      title: 'Invoice Already Exists',
      message: `This Quote is already associated with ${linkedInvoices.length} ${noun}${references}. You can still create another Invoice if needed.`,
      kind: 'warning',
      primaryButtonText: 'Create Another Invoice',
      cancelButtonText: 'Cancel',
    });
    if (!shouldContinue) return;
  }

  const scopedModalOpen = Boolean(document.querySelector('#clientQuickModal'));
  if (scopedModalOpen || state.clientDetailId || state.projectDetailId || state.page === 'dashboard') {
    await openClientQuickModal(Number(quote.client_id), 'invoices', null, {
      projectId: quote.project_id || null,
      quoteId: quote.id,
      returnToProject: Boolean(state.projectDetailId),
      returnToDashboard: state.page === 'dashboard',
    });
    return;
  }

  state.page = 'invoices';
  state.editing = null;
  state.clientDetailId = null;
  state.projectDetailId = null;
  updateActiveNavigation('invoices');
  document.querySelector('#pageTitle').textContent = titles.invoices[0];
  document.querySelector('#pageSubtitle').textContent = titles.invoices[1];
  document.querySelector('#mobilePageTitle').textContent = titles.invoices[0];
  await renderInvoices(null, {clientId: quote.client_id, projectId: quote.project_id, quoteId: quote.id, autoOpen: true});
}

function attachQuoteInvoiceActions(scope=root) {
  scope.querySelectorAll('[data-action="create-invoice-from-quote"][data-quote-id]').forEach(button => {
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      startInvoiceFromQuote(Number(button.dataset.quoteId)).catch(err => showForgeOpsError(err, 'Unable to start the Invoice.'));
    };
  });
}


async function printRecord(type, id) {
  if (type === 'quote') return printQuote(id);
  if (type === 'invoice') return printInvoice(id);
  if (type === 'ledger') return printLedger(id);
}

function printWindow(title, bodyHtml, targetWindow=null) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><base href="${window.location.origin}/"><link rel="stylesheet" href="/static/forgeops-packets.css?v=0.8.12-print-packets"><style>
    body{font-family:Arial, sans-serif;color:#111827;margin:32px;font-size:13px} h1,h2,h3{margin:0 0 8px}.muted{color:#52627a}.banner{background:#3f4a57;color:white;font-weight:700;padding:6px 8px;margin:18px 0 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:12px 0}.box{border:1px solid #d1d5db;padding:8px}.right{text-align:right}.total{font-weight:700;background:#eaf5fb}.print-section{break-inside:avoid;margin-top:18px}.page-break{break-before:page}table{width:100%;border-collapse:collapse;margin:0 0 14px}th{background:#4b5563;color:white;text-align:left}th,td{border:1px solid #d1d5db;padding:6px;vertical-align:top}.terms p{margin:6px 0}.signature-line{display:inline-block;border-bottom:1px solid #111827;min-width:260px;margin-left:8px}.receipt-print-page{display:block;width:100%;max-width:760px;height:auto;margin:14px auto;border:1px solid #d1d5db;box-shadow:0 1px 3px rgba(15,23,42,.12);background:white}.receipt-original-link{font-size:12px;color:#52627a;margin-top:8px}.no-print{margin-bottom:16px;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;background:#f8fafc;cursor:pointer}@media print{.no-print,.receipt-original-link{display:none}body{margin:18mm}.page-break{break-before:page}.receipt-print-page{max-width:100%;width:100%;break-inside:avoid;page-break-inside:avoid;box-shadow:none}.receipt-page-wrapper{break-before:auto}.receipt-page-wrapper + .receipt-page-wrapper{break-before:page}}
  </style></head><body><button id="printBtn" class="no-print" type="button">Print</button>${bodyHtml}</body></html>`;
  const win = targetWindow || window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    void showForgeOpsNotice({
      title: 'Popup Blocked',
      message: 'Allow popups for ForgeOps to print.',
      kind: 'warning',
    });
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  const wirePrintButton = () => {
    const button = win.document.getElementById('printBtn');
    if (button) button.addEventListener('click', () => win.print());
  };
  if (win.document.readyState === 'loading') {
    win.addEventListener('DOMContentLoaded', wirePrintButton, { once: true });
  } else {
    wirePrintButton();
  }
  return win;
}

function reservePacketPrintWindow() {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    void showForgeOpsNotice({
      title: 'Popup Blocked',
      message: 'Allow popups for ForgeOps to print.',
      kind: 'warning',
    });
    return null;
  }
  win.document.open();
  win.document.write('<!doctype html><html><head><title>Preparing packet…</title></head><body style="font-family:Arial,sans-serif;padding:32px">Preparing packet…</body></html>');
  win.document.close();
  return win;
}


function defaultQuoteTerms(terms) {
  return quoteTermsValue(terms, DEFAULT_QUOTE_TERMS).split('\n').filter(Boolean);
}

function quoteVendorFeePrintRows(items, totals) {
  const rows = quoteVendorFeeItems(items)
    .filter(item => Number(item.line_total || 0) > 0)
    .map(item => `<tr><td>${escapeHtml(item.name)}</td><td class="right">${money(item.line_total)}</td></tr>`)
    .join('');
  return `${rows}<tr><td>Vendor Fees Total</td><td class="right">${money(totals.vendorFeesTotal)}</td></tr>`;
}


async function receiptPrintSection(receiptId, {pageBreak=true, heading='Receipt'} = {}) {
  if (!receiptId) return '';
  try {
    const receipt = await api(`/api/receipts/${receiptId}`);
    const pages = await api(`/api/receipts/${receiptId}/print-pages`);
    const downloadUrl = `${window.location.origin}/api/receipts/${receiptId}/file`;
    const meta = `<div class="grid"><div class="box"><strong>Filename</strong><br>${escapeHtml(receipt.original_filename || '')}</div><div class="box"><strong>Vendor / Date / Amount</strong><br>${escapeHtml(receipt.vendor_name || '—')}<br>${escapeHtml(receipt.receipt_date || '—')}<br>${money(receipt.total_amount)}</div></div>`;
    const pageImages = (pages.pages || []).map((pageUrl, index) => {
      const src = `${window.location.origin}${pageUrl}?ts=${Date.now()}`;
      const label = pages.mode === 'pdf_pages' ? `Receipt page ${index + 1}` : 'Receipt image';
      return `<div class="receipt-page-wrapper"><img class="receipt-print-page" src="${src}" alt="${escapeHtml(label)}"></div>`;
    }).join('');
    const preview = pageImages || `<p>Receipt preview is not available for this file type. <a href="${downloadUrl}">Download receipt</a></p>`;
    return `<section class="print-section receipt-document ${pageBreak ? 'page-break' : ''}"><h2>${escapeHtml(heading)}</h2>${meta}${preview}<p class="receipt-original-link"><a href="${downloadUrl}">Download original receipt</a></p></section>`;
  } catch (err) {
    return `<section class="print-section receipt-document ${pageBreak ? 'page-break' : ''}"><h2>${escapeHtml(heading)}</h2><p>Unable to load attached receipt: ${escapeHtml(err.message || 'Unknown error')}</p></section>`;
  }
}

async function quotePrintSection(id, {pageBreak=false, quoteRecord=null, settingsOverride=null, clientRecord=null, projectRecord=null, heading='Associated Quote', includeApproval=false, adminNotes=false} = {}) {
  if (!id) return '';
  await preloadLookups();
  let quote = quoteRecord || state.quotes.find(q => Number(q.id) === Number(id));
  if (!quote) quote = (await fetchAllPages('/api/quotes')).find(q => Number(q.id) === Number(id));
  if (!quote) return '<section class="print-section"><h2>Associated Quote</h2><p>Quote not found.</p></section>';
  const settings = settingsOverride || (await api('/api/admin/settings')).settings || {};
  const items = (await api(`/api/quotes/${id}/line-items`)).items || [];
  const equipment = equipmentRowsFromItems(items);
  const labor = laborRowsFromItems(items);
  const totals = calculateQuoteTotals(items, percentSetting(settings.sales_tax_rate ?? '0.07', 0.07));
  const vendorFeeRows = quoteVendorFeePrintRows(items, totals);
  const equipmentRows = equipment.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.description)}</td><td class="right">${Number(i.quantity || 0).toFixed(2)}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.line_total)}</td></tr>`).join('') || '<tr><td colspan="5">No equipment/material lines.</td></tr>';
  const laborRows = labor.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.description)}</td><td class="right">${Number(i.quantity || 0).toFixed(2)}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.line_total)}</td></tr>`).join('') || '<tr><td colspan="5">No labor lines.</td></tr>';
  const terms = defaultQuoteTerms(quoteTermsValue(quote.terms, settings.default_quote_terms)).map(t => `<p>• ${escapeHtml(t.replace(/^[-•]\s*/, ''))}</p>`).join('');
  const internalNotes = adminNotes && quote.notes ? `<div class="packet-note"><strong>Internal Quote Notes</strong><p>${escapeHtml(quote.notes)}</p></div>` : '';
  const approval = includeApproval ? '<div class="banner">Client Approval & Authorization</div><p>By signing below, the client acknowledges and agrees to the scope, pricing, and payment terms outlined in this quote.</p><p>Client Name:<span class="signature-line"></span></p><p>Signature:<span class="signature-line"></span></p><p>Date:<span class="signature-line"></span></p>' : '';
  const clientLabel = clientRecord?.name || clientName(quote.client_id);
  const projectLabel = projectRecord?.name || projectName(quote.project_id) || '';
  return `<section class="print-section packet-primary-document ${pageBreak ? 'page-break' : ''}"><h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>${escapeHtml(heading)}</h2><div class="grid"><div class="box"><strong>Client</strong><br>${escapeHtml(clientLabel)}<br>${escapeHtml(projectLabel)}</div><div class="box"><strong>Quote #:</strong> ${escapeHtml(quote.quote_number)}<br><strong>Date:</strong> ${escapeHtml(quote.quote_date || '')}<br><strong>Valid Through:</strong> ${escapeHtml(quote.valid_until || '')}<br><strong>Status:</strong> ${escapeHtml(statusLabel(quote.status))}</div></div><h2>${escapeHtml(quote.title || '')}</h2><div class="banner">Equipment & Materials</div><table><thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${equipmentRows}</tbody></table><table><tbody><tr><td>Equipment Subtotal</td><td class="right">${money(totals.equipmentSubtotal)}</td></tr>${vendorFeeRows}<tr><td>Sales Tax</td><td class="right">${money(totals.tax)}</td></tr><tr><td>Project Coordination & Logistics</td><td class="right">${money(totals.markup)}</td></tr><tr class="total"><td>Total Equipment Cost</td><td class="right">${money(totals.equipmentTotal)}</td></tr></tbody></table><div class="banner">Labor – Installation & Configuration (Estimate)</div><table><thead><tr><th>Service</th><th>Description</th><th>Hours</th><th>Rate</th><th>Line Total</th></tr></thead><tbody>${laborRows}</tbody></table><table><tbody><tr><td>Estimated Labor Total</td><td class="right">${money(totals.laborTotal)}</td></tr><tr class="total"><td>Estimated Grand Total</td><td class="right">${money(totals.total)}</td></tr></tbody></table><div class="banner">Payment Terms & Conditions</div><div class="terms">${terms}</div>${internalNotes}${approval}</section>`;
}

async function invoicePrintSection(id, {pageBreak=false, invoiceRecord=null, settingsOverride=null, clientRecord=null, projectRecord=null, laborEntries=null, heading='Associated Invoice', includeApproval=false, adminNotes=false} = {}) {
  if (!id) return '';
  await preloadLookups();
  let invoice = invoiceRecord || state.invoices.find(i => Number(i.id) === Number(id));
  if (!invoice) invoice = (await fetchAllPages('/api/invoices')).find(i => Number(i.id) === Number(id));
  if (!invoice) return '<section class="print-section"><h2>Associated Invoice</h2><p>Invoice not found.</p></section>';
  const settings = settingsOverride || (await api('/api/admin/settings')).settings || {};
  const labor = laborEntries || (await fetchAllPages(`/api/labor?client_id=${Number(invoice.client_id)}`)).filter(l => Number(l.invoice_id) === Number(id));
  const laborRows = labor.map(l => `<tr><td>${escapeHtml(l.work_date)}</td><td>${escapeHtml(l.service_type)}</td><td>${escapeHtml(l.notes || '')}</td><td class="right">${Number(l.hours || 0).toFixed(2)}</td><td class="right">${money(l.hourly_rate)}</td><td class="right">${money(l.line_total)}</td></tr>`).join('') || `<tr><td colspan="6">${escapeHtml(invoice.notes || 'Labor services')}</td></tr>`;
  const lineItems = invoice.line_items || [];
  const materials = lineItems.filter(item => item.kind === 'material');
  const vendorFees = lineItems.filter(item => item.kind === 'vendor_fee');
  const credits = lineItems.filter(item => ['credit','payment','adjustment'].includes(String(item.kind)));
  const materialRows = materials.map(item => `<tr><td>${escapeHtml(item.description)}</td><td class="right">${Number(item.quantity || 0).toFixed(2)}</td><td class="right">${money(item.unit_price)}</td><td class="right">${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="4">No additional parts or materials.</td></tr>`;
  const vendorFeeRows = vendorFees.map(item => `<tr><td>${escapeHtml(item.description)}</td><td class="right">${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="2">No vendor fees.</td></tr>`;
  const creditRows = credits.map(item => `<tr><td>${escapeHtml(statusLabel(item.kind))}</td><td>${escapeHtml(item.description)}</td><td class="right">-${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="3">No credits or payments applied.</td></tr>`;
  const materialsTotal = materials.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const vendorFeesTotal = vendorFees.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const laborTotal = labor.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
  const terms = invoiceTermsValue(invoice.terms, settings.default_invoice_terms).split('\n').filter(Boolean).map(t => `<p>• ${escapeHtml(t.replace(/^[-•]\s*/, ''))}</p>`).join('');
  const internalNotes = adminNotes && invoice.notes ? `<div class="packet-note"><strong>Internal Invoice Notes</strong><p>${escapeHtml(invoice.notes)}</p></div>` : '';
  const approval = includeApproval ? '<div class="banner">Client Approval & Acknowledgment</div><p>Client Name:<span class="signature-line"></span></p><p>Signature:<span class="signature-line"></span></p><p>Date:<span class="signature-line"></span></p>' : '';
  const clientLabel = clientRecord?.name || clientName(invoice.client_id);
  const projectLabel = projectRecord?.name || projectName(invoice.project_id) || '';
  return `<section class="print-section packet-primary-document ${pageBreak ? 'page-break' : ''}"><h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>${escapeHtml(heading)}</h2><div class="grid"><div class="box"><strong>Bill To</strong><br>${escapeHtml(clientLabel)}<br>${escapeHtml(projectLabel)}</div><div class="box"><strong>Invoice #:</strong> ${escapeHtml(invoice.invoice_number)}<br><strong>Date:</strong> ${escapeHtml(invoice.invoice_date || '')}<br><strong>Due:</strong> ${escapeHtml(invoice.due_date || '')}<br><strong>Status:</strong> ${escapeHtml(statusLabel(invoice.status))}</div></div><h2>${escapeHtml(invoice.title || 'Labor Services')}</h2><div class="banner">Labor Summary</div><table><thead><tr><th>Date</th><th>Service</th><th>Description</th><th>Hours</th><th>Rate</th><th>Line Total</th></tr></thead><tbody>${laborRows}</tbody></table><div class="banner">Additional Parts & Materials</div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${materialRows}</tbody></table><div class="banner">Vendor Fees</div><table><thead><tr><th>Fee</th><th>Amount</th></tr></thead><tbody>${vendorFeeRows}</tbody></table><div class="banner">Credits / Payments Applied</div><table><thead><tr><th>Type</th><th>Description</th><th>Amount</th></tr></thead><tbody>${creditRows}</tbody></table><table><tbody><tr><td>Labor Total</td><td class="right">${money(laborTotal)}</td></tr><tr><td>Parts / Materials</td><td class="right">${money(materialsTotal)}</td></tr><tr><td>Vendor Fees</td><td class="right">${money(vendorFeesTotal)}</td></tr><tr><td>Sales Tax</td><td class="right">${money(invoice.tax_amount)}</td></tr><tr class="total"><td>Invoice Total</td><td class="right">${money(invoice.total_amount)}</td></tr><tr><td>Credits / Payments Applied</td><td class="right">-${money(invoice.amount_paid)}</td></tr><tr class="total"><td>Balance Due</td><td class="right">${money(invoice.balance_due)}</td></tr></tbody></table><div class="banner">Payment Terms & Conditions</div><div class="terms">${terms}</div>${internalNotes}${approval}</section>`;
}

async function printQuote(id) {
  await preloadLookups();
  let quote = state.quotes.find(q => Number(q.id) === Number(id));
  if (!quote) quote = (await api('/api/quotes?page_size=100')).items.find(q => Number(q.id) === Number(id));
  if (!quote) throw new Error('Quote not found.');
  const settings = (await api('/api/admin/settings')).settings || {};
  const items = (await api(`/api/quotes/${id}/line-items`)).items || [];
  const equipment = equipmentRowsFromItems(items);
  const labor = laborRowsFromItems(items);
  const totals = calculateQuoteTotals(items, percentSetting(settings.sales_tax_rate ?? '0.07', 0.07));
  const vendorFeeRows = quoteVendorFeePrintRows(items, totals);
  const equipmentRows = equipment.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.description)}</td><td class="right">${Number(i.quantity || 0).toFixed(2)}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.line_total)}</td></tr>`).join('') || '<tr><td colspan="5">No equipment/material lines.</td></tr>';
  const laborRows = labor.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.description)}</td><td class="right">${Number(i.quantity || 0).toFixed(2)}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.line_total)}</td></tr>`).join('') || '<tr><td colspan="5">No labor lines.</td></tr>';
  const terms = defaultQuoteTerms(quoteTermsValue(quote.terms, settings.default_quote_terms)).map(t => `<p>• ${escapeHtml(t.replace(/^[-•]\s*/, ''))}</p>`).join('');
  printWindow(`Quote ${quote.quote_number}`, `<h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>Quote</h2><div class="grid"><div class="box"><strong>Client</strong><br>${escapeHtml(clientName(quote.client_id))}<br>${escapeHtml(projectName(quote.project_id) || '')}</div><div class="box"><strong>Quote #:</strong> ${escapeHtml(quote.quote_number)}<br><strong>Date:</strong> ${escapeHtml(quote.quote_date || '')}<br><strong>Valid Through:</strong> ${escapeHtml(quote.valid_until || '')}</div></div><h2>${escapeHtml(quote.title || '')}</h2><div class="banner">Equipment & Materials</div><table><thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${equipmentRows}</tbody></table><table><tbody><tr><td>Equipment Subtotal</td><td class="right">${money(totals.equipmentSubtotal)}</td></tr>${vendorFeeRows}<tr><td>Sales Tax</td><td class="right">${money(totals.tax)}</td></tr><tr><td>Project Coordination & Logistics</td><td class="right">${money(totals.markup)}</td></tr><tr class="total"><td>Total Equipment Cost</td><td class="right">${money(totals.equipmentTotal)}</td></tr></tbody></table><div class="banner">Labor – Installation & Configuration (Estimate)</div><table><thead><tr><th>Service</th><th>Description</th><th>Hours</th><th>Rate</th><th>Line Total</th></tr></thead><tbody>${laborRows}</tbody></table><table><tbody><tr><td>Estimated Labor Total</td><td class="right">${money(totals.laborTotal)}</td></tr><tr class="total"><td>Estimated Grand Total</td><td class="right">${money(totals.total)}</td></tr></tbody></table><div class="banner">Payment Terms & Conditions</div><div class="terms">${terms}</div><div class="banner">Client Approval & Authorization</div><p>By signing below, the client acknowledges and agrees to the scope, pricing, and payment terms outlined in this quote.</p><p>Client Name:<span class="signature-line"></span></p><p>Signature:<span class="signature-line"></span></p><p>Date:<span class="signature-line"></span></p>`);
}

async function printInvoice(id) {
  await preloadLookups();
  let invoice = state.invoices.find(i => Number(i.id) === Number(id));
  if (!invoice) invoice = (await api('/api/invoices?page_size=100')).items.find(i => Number(i.id) === Number(id));
  if (!invoice) throw new Error('Invoice not found.');
  const settings = (await api('/api/admin/settings')).settings || {};
  const labor = (await api(`/api/labor?page_size=100`)).items.filter(l => Number(l.invoice_id) === Number(id));
  const laborRows = labor.map(l => `<tr><td>${escapeHtml(l.work_date)}</td><td>${escapeHtml(l.service_type)}</td><td>${escapeHtml(l.notes || '')}</td><td class="right">${Number(l.hours || 0).toFixed(2)}</td><td class="right">${money(l.hourly_rate)}</td><td class="right">${money(l.line_total)}</td></tr>`).join('') || `<tr><td colspan="6">${escapeHtml(invoice.notes || 'Labor services')}</td></tr>`;
  const lineItems = invoice.line_items || [];
  const materials = lineItems.filter(item => item.kind === 'material');
  const vendorFees = lineItems.filter(item => item.kind === 'vendor_fee');
  const credits = lineItems.filter(item => ['credit','payment','adjustment'].includes(String(item.kind)));
  const materialRows = materials.map(item => `<tr><td>${escapeHtml(item.description)}</td><td class="right">${Number(item.quantity || 0).toFixed(2)}</td><td class="right">${money(item.unit_price)}</td><td class="right">${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="4">No additional parts or materials.</td></tr>`;
  const vendorFeeRows = vendorFees.map(item => `<tr><td>${escapeHtml(item.description)}</td><td class="right">${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="2">No vendor fees.</td></tr>`;
  const creditRows = credits.map(item => `<tr><td>${escapeHtml(statusLabel(item.kind))}</td><td>${escapeHtml(item.description)}</td><td class="right">-${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="3">No credits or payments applied.</td></tr>`;
  const materialsTotal = materials.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const vendorFeesTotal = vendorFees.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const laborTotal = labor.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
  const terms = invoiceTermsValue(invoice.terms, settings.default_invoice_terms).split('\n').filter(Boolean).map(t => `<p>• ${escapeHtml(t.replace(/^[-•]\s*/, ''))}</p>`).join('');
  printWindow(`Invoice ${invoice.invoice_number}`, `<h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>Invoice</h2><div class="grid"><div class="box"><strong>Bill To</strong><br>${escapeHtml(clientName(invoice.client_id))}<br>${escapeHtml(projectName(invoice.project_id) || '')}</div><div class="box"><strong>Invoice #:</strong> ${escapeHtml(invoice.invoice_number)}<br><strong>Date:</strong> ${escapeHtml(invoice.invoice_date || '')}<br><strong>Due:</strong> ${escapeHtml(invoice.due_date || '')}<br><strong>Status:</strong> ${escapeHtml(statusLabel(invoice.status))}</div></div><h2>${escapeHtml(invoice.title || 'Labor Services')}</h2><div class="banner">Labor Summary</div><table><thead><tr><th>Date</th><th>Service</th><th>Description</th><th>Hours</th><th>Rate</th><th>Line Total</th></tr></thead><tbody>${laborRows}</tbody></table><div class="banner">Additional Parts & Materials</div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${materialRows}</tbody></table><div class="banner">Vendor Fees</div><table><thead><tr><th>Fee</th><th>Amount</th></tr></thead><tbody>${vendorFeeRows}</tbody></table><div class="banner">Credits / Payments Applied</div><table><thead><tr><th>Type</th><th>Description</th><th>Amount</th></tr></thead><tbody>${creditRows}</tbody></table><table><tbody><tr><td>Labor Total</td><td class="right">${money(laborTotal)}</td></tr><tr><td>Parts / Materials</td><td class="right">${money(materialsTotal)}</td></tr><tr><td>Vendor Fees</td><td class="right">${money(vendorFeesTotal)}</td></tr><tr><td>Sales Tax</td><td class="right">${money(invoice.tax_amount)}</td></tr><tr class="total"><td>Invoice Total</td><td class="right">${money(invoice.total_amount)}</td></tr><tr><td>Credits / Payments Applied</td><td class="right">-${money(invoice.amount_paid)}</td></tr><tr class="total"><td>Balance Due</td><td class="right">${money(invoice.balance_due)}</td></tr></tbody></table><div class="banner">Payment Terms & Conditions</div><div class="terms">${terms}</div><div class="banner">Client Approval & Acknowledgment</div><p>Client Name:<span class="signature-line"></span></p><p>Signature:<span class="signature-line"></span></p><p>Date:<span class="signature-line"></span></p>`);
}


async function printLedger(id) {
  await preloadLookups();
  const data = await api('/api/ledger?page_size=100');
  const entry = (data.items || []).find(e => Number(e.id) === Number(id));
  if (!entry) throw new Error('Ledger entry not found.');
  const settings = (await api('/api/admin/settings')).settings || {};
  const client = clientName(entry.client_id) || '—';
  const project = projectName(entry.project_id) || '—';
  const quote = quoteName(entry.quote_id) || '—';
  const invoice = invoiceName(entry.invoice_id) || '—';
  const receiptSection = entry.receipt_id ? await receiptPrintSection(entry.receipt_id) : '<section class="print-section"><h2>Receipt</h2><p>No receipt attached to this ledger entry.</p></section>';
  const quoteSection = entry.quote_id ? await quotePrintSection(entry.quote_id, { pageBreak: true }) : '';
  const invoiceSection = entry.invoice_id ? await invoicePrintSection(entry.invoice_id, { pageBreak: true }) : '';
  const linkedDocs = `${quoteSection}${invoiceSection}${receiptSection}`;
  const body = `<h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>Ledger Entry Packet</h2><p class="muted">Includes the ledger entry and any linked quote, invoice, and receipt.</p>
    <section class="print-section"><div class="banner">Ledger Entry</div><div class="grid">
      <div class="box"><strong>Date</strong><br>${escapeHtml(entry.entry_date || '')}</div>
      <div class="box"><strong>Amount</strong><br>${money(entry.amount)}</div>
      <div class="box"><strong>Account Type</strong><br>${escapeHtml(ledgerKindLabel(entry.kind))}</div>
      <div class="box"><strong>Category</strong><br>${escapeHtml(entry.category || '')}</div>
      <div class="box"><strong>Business Type</strong><br>${escapeHtml(statusLabel(entry.business_type))}</div>
      <div class="box"><strong>Client</strong><br>${escapeHtml(client)}</div>
      <div class="box"><strong>Project</strong><br>${escapeHtml(project)}</div>
      <div class="box"><strong>Quote</strong><br>${escapeHtml(quote)}</div>
      <div class="box"><strong>Invoice</strong><br>${escapeHtml(invoice)}</div>
      <div class="box"><strong>Receipt</strong><br>${entry.receipt_id ? `Attached #${Number(entry.receipt_id)}` : '—'}</div>
    </div><div class="box"><strong>Description / Notes</strong><br>${escapeHtml(entry.description || '—')}</div></section>${linkedDocs}`;
  printWindow(`Ledger Entry ${entry.entry_date} ${entry.category}`, body);
}

async function fetchAllPages(path, {pageSize=100} = {}) {
  const url = new URL(path, window.location.origin);
  const items = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < total) {
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));
    const response = await api(`${url.pathname}${url.search}`);
    const batch = Array.isArray(response.items) ? response.items : [];
    items.push(...batch);
    total = Number(response.meta?.total ?? items.length);
    if (!batch.length || items.length >= total) break;
    page += 1;
  }
  return items;
}

function packetGeneratedAt() {
  return new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'}).format(new Date());
}

function packetSort(items, dateKey, numberKey='id') {
  return [...items].sort((left, right) => String(left?.[dateKey] || '').localeCompare(String(right?.[dateKey] || '')) || String(left?.[numberKey] || '').localeCompare(String(right?.[numberKey] || ''), undefined, {numeric:true}));
}

function uniquePacketRecords(items) {
  return [...new Map(items.filter(item => item?.id).map(item => [Number(item.id), item])).values()];
}

function packetRelatedReceipts(receipts, {clientId=null, projectId=null, quotes=[], invoices=[], ledger=[]} = {}) {
  const quoteIds = new Set(quotes.map(item => Number(item.id)));
  const invoiceIds = new Set(invoices.map(item => Number(item.id)));
  const ledgerIds = new Set(ledger.map(item => Number(item.id)));
  const attachedReceiptIds = new Set(ledger.map(item => Number(item.receipt_id)).filter(Boolean));
  return uniquePacketRecords(receipts.filter(receipt => {
    const receiptId = Number(receipt.id);
    const linkedId = Number(receipt.linked_id);
    return attachedReceiptIds.has(receiptId)
      || (clientId && receipt.linked_type === 'client' && linkedId === Number(clientId))
      || (projectId && receipt.linked_type === 'project' && linkedId === Number(projectId))
      || (receipt.linked_type === 'quote' && quoteIds.has(linkedId))
      || (receipt.linked_type === 'invoice' && invoiceIds.has(linkedId))
      || (receipt.linked_type === 'ledger_entry' && ledgerIds.has(linkedId));
  }));
}

async function loadProjectPacketData(projectId, {includeAdmin=false} = {}) {
  await preloadLookups();
  const project = state.projects.find(item => Number(item.id) === Number(projectId)) || (await fetchAllPages('/api/projects')).find(item => Number(item.id) === Number(projectId));
  if (!project) throw new Error('Project not found.');
  const client = state.clients.find(item => Number(item.id) === Number(project.client_id)) || await api(`/api/clients/${project.client_id}`);
  const settings = (await api('/api/admin/settings')).settings || {};
  const [quotes, invoices, labor] = await Promise.all([
    fetchAllPages(`/api/quotes?project_id=${Number(projectId)}`),
    fetchAllPages(`/api/invoices?project_id=${Number(projectId)}`),
    fetchAllPages(`/api/labor?project_id=${Number(projectId)}`),
  ]);
  const data = {
    settings,
    client,
    project,
    quotes: packetSort(quotes, 'quote_date', 'quote_number'),
    invoices: packetSort(invoices, 'invoice_date', 'invoice_number'),
    labor: packetSort(labor, 'work_date'),
    ledger: [],
    receipts: [],
  };
  if (includeAdmin) {
    const [ledger, allReceipts] = await Promise.all([
      fetchAllPages(`/api/ledger?project_id=${Number(projectId)}`),
      fetchAllPages('/api/receipts'),
    ]);
    data.ledger = packetSort(ledger, 'entry_date');
    data.receipts = packetRelatedReceipts(allReceipts, {projectId, quotes:data.quotes, invoices:data.invoices, ledger:data.ledger});
  }
  return data;
}

async function loadClientAdminPacketData(clientId) {
  await preloadLookups();
  const client = state.clients.find(item => Number(item.id) === Number(clientId)) || await api(`/api/clients/${clientId}`);
  const settings = (await api('/api/admin/settings')).settings || {};
  const [projects, quotes, invoices, labor, allLedger, allReceipts] = await Promise.all([
    fetchAllPages(`/api/projects?client_id=${Number(clientId)}`),
    fetchAllPages(`/api/quotes?client_id=${Number(clientId)}`),
    fetchAllPages(`/api/invoices?client_id=${Number(clientId)}`),
    fetchAllPages(`/api/labor?client_id=${Number(clientId)}`),
    fetchAllPages('/api/ledger'),
    fetchAllPages('/api/receipts'),
  ]);
  const projectIds = new Set(projects.map(project => Number(project.id)));
  const ledger = allLedger.filter(entry => Number(entry.client_id) === Number(clientId) || (entry.project_id && projectIds.has(Number(entry.project_id))));
  return {
    settings,
    client,
    projects: [...projects].sort((left, right) => String(left.start_date || left.created_at || '').localeCompare(String(right.start_date || right.created_at || '')) || String(left.name || '').localeCompare(String(right.name || ''))),
    quotes: packetSort(quotes, 'quote_date', 'quote_number'),
    invoices: packetSort(invoices, 'invoice_date', 'invoice_number'),
    labor: packetSort(labor, 'work_date'),
    ledger: packetSort(ledger, 'entry_date'),
    receipts: allReceipts,
  };
}

function adminProjectSummaryHtml({project, client, quotes, invoices, labor, ledger, receipts}) {
  return `<section class="packet-section packet-summary"><h2>Project Summary</h2><div class="packet-summary-grid">
    <div><strong>Client</strong><span>${escapeHtml(client?.name || '—')}</span></div><div><strong>Project</strong><span>${escapeHtml(project?.name || '—')}</span></div><div><strong>Status</strong><span>${escapeHtml(statusLabel(project?.status))}</span></div><div><strong>Site</strong><span>${escapeHtml(project?.site_address || '—')}</span></div>
    <div><strong>Start</strong><span>${escapeHtml(project?.start_date || '—')}</span></div><div><strong>Completed</strong><span>${escapeHtml(project?.completed_date || '—')}</span></div><div><strong>Created</strong><span>${escapeHtml(project?.created_at || '—')}</span></div><div><strong>Updated</strong><span>${escapeHtml(project?.updated_at || '—')}</span></div>
    <div><strong>Quotes</strong><span>${quotes.length}</span></div><div><strong>Invoices</strong><span>${invoices.length}</span></div><div><strong>Labor Entries</strong><span>${labor.length}</span></div><div><strong>Ledger / Receipts</strong><span>${ledger.length} / ${receipts.length}</span></div>
  </div>${project?.notes ? `<div class="packet-note"><strong>Internal Project Notes</strong><p>${escapeHtml(project.notes)}</p></div>` : ''}</section>`;
}

function adminClientSummaryHtml(client) {
  return `<section class="packet-section packet-summary"><h2>Client Summary</h2><div class="packet-summary-grid">
    <div><strong>Client</strong><span>${escapeHtml(client?.name || '—')}</span></div><div><strong>Status</strong><span>${client?.is_active ? 'Active' : 'Inactive'}</span></div><div><strong>Primary Contact</strong><span>${escapeHtml(client?.contact_name || '—')}</span></div><div><strong>Email</strong><span>${escapeHtml(client?.email || '—')}</span></div><div><strong>Phone</strong><span>${escapeHtml(client?.phone || '—')}</span></div><div><strong>Site Address</strong><span>${escapeHtml(client?.site_address || '—')}</span></div><div><strong>Billing Address</strong><span>${escapeHtml(client?.billing_address || '—')}</span></div><div><strong>Updated</strong><span>${escapeHtml(client?.updated_at || '—')}</span></div>
  </div>${client?.notes ? `<div class="packet-note"><strong>Internal Client Notes</strong><p>${escapeHtml(client.notes)}</p></div>` : ''}</section>`;
}

function adminLaborPacketSection(labor, heading='Labor') {
  if (!labor.length) return '';
  const rows = labor.map(entry => `<tr><td>${escapeHtml(entry.work_date || '')}</td><td>${escapeHtml(statusLabel(entry.status))}</td><td>${escapeHtml(entry.service_type || '')}<br><span class="muted">${escapeHtml(entry.notes || '')}</span></td><td class="right">${Number(entry.hours || 0).toFixed(2)}</td><td class="right">${money(entry.hourly_rate)}</td><td class="right">${money(entry.line_total)}</td><td>${entry.is_invoiced ? `Invoiced${entry.invoice_number ? ` — ${escapeHtml(entry.invoice_number)}` : ''}` : 'Uninvoiced'}</td></tr>`).join('');
  return `<section class="packet-section page-break"><h2>${escapeHtml(heading)}</h2><table><thead><tr><th>Date</th><th>Status</th><th>Service / Notes</th><th>Hours</th><th>Rate</th><th>Value</th><th>Billing</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function adminLedgerPacketSection(ledger, quotes, invoices, heading='Ledger') {
  if (!ledger.length) return '';
  const quoteMap = new Map(quotes.map(item => [Number(item.id), item]));
  const invoiceMap = new Map(invoices.map(item => [Number(item.id), item]));
  const rows = ledger.map(entry => `<tr><td>${escapeHtml(entry.entry_date || '')}</td><td>${escapeHtml(ledgerKindLabel(entry.kind))}</td><td>${escapeHtml(entry.category || '')}<br><span class="muted">${escapeHtml(entry.description || '')}</span></td><td class="right">${money(entry.amount)}</td><td>${entry.quote_id ? escapeHtml(quoteMap.get(Number(entry.quote_id))?.quote_number || `Quote #${entry.quote_id}`) : '—'}</td><td>${entry.invoice_id ? escapeHtml(invoiceMap.get(Number(entry.invoice_id))?.invoice_number || `Invoice #${entry.invoice_id}`) : '—'}</td><td>${entry.receipt_id ? 'Attached' : 'None'}</td><td>${escapeHtml(salesTaxPeriodLabel(entry.sales_tax_period) || '—')}</td></tr>`).join('');
  return `<section class="packet-section page-break"><h2>${escapeHtml(heading)}</h2><table><thead><tr><th>Date</th><th>Account Type</th><th>Category / Description</th><th>Amount</th><th>Quote</th><th>Invoice</th><th>Receipt</th><th>Sales Tax Period</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

async function adminReceiptPacketSections(receipts) {
  const sorted = [...uniquePacketRecords(receipts)].sort((left, right) => String(left.receipt_date || left.uploaded_at || '').localeCompare(String(right.receipt_date || right.uploaded_at || '')) || Number(left.id) - Number(right.id));
  return Promise.all(sorted.map(receipt => receiptPrintSection(receipt.id, {heading:`Receipt / Documentation — ${receipt.original_filename || `Receipt ${receipt.id}`}`})));
}

async function projectQuotePacketSections(data, {clientCopy=false} = {}) {
  return Promise.all(data.quotes.map(quote => quotePrintSection(quote.id, {pageBreak:true, quoteRecord:quote, settingsOverride:data.settings, clientRecord:data.client, projectRecord:data.project, heading:'Quote', includeApproval:clientCopy, adminNotes:!clientCopy})));
}

async function projectInvoicePacketSections(data, {clientCopy=false} = {}) {
  return Promise.all(data.invoices.map(invoice => invoicePrintSection(invoice.id, {pageBreak:true, invoiceRecord:invoice, settingsOverride:data.settings, clientRecord:data.client, projectRecord:data.project, laborEntries:data.labor.filter(entry => Number(entry.invoice_id) === Number(invoice.id)), heading:'Invoice', includeApproval:clientCopy, adminNotes:!clientCopy})));
}

async function renderProjectAdminGroup(data, {includeCover=false} = {}) {
  const [quoteSections, invoiceSections, receiptSections] = await Promise.all([
    projectQuotePacketSections(data),
    projectInvoicePacketSections(data),
    adminReceiptPacketSections(data.receipts),
  ]);
  return projectAdminGroupHtml({
    businessName:data.settings.company_name,
    client:data.client,
    project:{...data.project, status:statusLabel(data.project.status)},
    generatedAt:packetGeneratedAt(),
    includeCover,
    summaryHtml:adminProjectSummaryHtml(data),
    quoteSections,
    invoiceSections,
    laborHtml:adminLaborPacketSection(data.labor),
    ledgerHtml:adminLedgerPacketSection(data.ledger, data.quotes, data.invoices),
    receiptSections,
  });
}

async function buildProjectClientPacket(projectId) {
  const data = await loadProjectPacketData(projectId);
  const [quoteSections, invoiceSections] = await Promise.all([
    projectQuotePacketSections(data, {clientCopy:true}),
    projectInvoicePacketSections(data, {clientCopy:true}),
  ]);
  return projectClientPacketHtml({businessName:data.settings.company_name, client:data.client, project:{...data.project, status:statusLabel(data.project.status)}, quoteSections, invoiceSections, generatedAt:packetGeneratedAt()});
}

async function buildProjectAdminPacket(projectId) {
  const data = await loadProjectPacketData(projectId, {includeAdmin:true});
  return `<main class="packet packet-admin-copy" data-packet-type="project-admin-copy">${await renderProjectAdminGroup(data, {includeCover:true})}</main>`;
}

async function buildClientAdminPacket(clientId) {
  const data = await loadClientAdminPacketData(clientId);
  const usedReceiptIds = new Set();
  const projectSections = [];
  for (const project of data.projects) {
    const quotes = data.quotes.filter(item => Number(item.project_id) === Number(project.id));
    const invoices = data.invoices.filter(item => Number(item.project_id) === Number(project.id));
    const labor = data.labor.filter(item => Number(item.project_id) === Number(project.id));
    const ledger = data.ledger.filter(item => Number(item.project_id) === Number(project.id));
    const receipts = packetRelatedReceipts(data.receipts, {projectId:project.id, quotes, invoices, ledger});
    receipts.forEach(receipt => usedReceiptIds.add(Number(receipt.id)));
    projectSections.push(await renderProjectAdminGroup({...data, project, quotes, invoices, labor, ledger, receipts}));
  }
  const unassignedQuotes = data.quotes.filter(item => !item.project_id);
  const unassignedInvoices = data.invoices.filter(item => !item.project_id);
  const unassignedLabor = data.labor.filter(item => !item.project_id);
  const unassignedLedger = data.ledger.filter(item => !item.project_id && Number(item.client_id) === Number(clientId));
  const unassignedReceipts = packetRelatedReceipts(data.receipts, {clientId, quotes:unassignedQuotes, invoices:unassignedInvoices, ledger:unassignedLedger}).filter(receipt => !usedReceiptIds.has(Number(receipt.id)));
  const unassignedData = {...data, project:null, quotes:unassignedQuotes, invoices:unassignedInvoices, labor:unassignedLabor, ledger:unassignedLedger, receipts:unassignedReceipts};
  const hasUnassigned = unassignedQuotes.length || unassignedInvoices.length || unassignedLabor.length || unassignedLedger.length || unassignedReceipts.length;
  let unassignedHtml = '';
  if (hasUnassigned) {
    const [quoteSections, invoiceSections, receiptSections] = await Promise.all([
      projectQuotePacketSections(unassignedData),
      projectInvoicePacketSections(unassignedData),
      adminReceiptPacketSections(unassignedReceipts),
    ]);
    unassignedHtml = `<section class="packet-unassigned page-break"><header class="packet-project-heading"><p class="packet-kicker">Client-level history</p><h2>Client-Level / Unassigned Records</h2></header>${quoteSections.join('')}${invoiceSections.join('')}${adminLaborPacketSection(unassignedLabor)}${adminLedgerPacketSection(unassignedLedger, unassignedQuotes, unassignedInvoices)}${receiptSections.join('')}</section>`;
  }
  return clientAdminPacketHtml({businessName:data.settings.company_name, client:data.client, generatedAt:packetGeneratedAt(), summaryHtml:adminClientSummaryHtml(data.client), projectSections, unassignedHtml});
}

async function runPacketPrint(title, buildHtml) {
  const win = reservePacketPrintWindow();
  if (!win) return;
  try {
    printWindow(title, await buildHtml(), win);
  } catch (error) {
    win.close();
    throw error;
  }
}

function printProjectClientPacket(projectId) {
  return runPacketPrint('Project Packet — Client Copy', () => buildProjectClientPacket(projectId));
}

function printProjectAdminPacket(projectId) {
  return runPacketPrint('Project Packet — Admin Copy', () => buildProjectAdminPacket(projectId));
}

function printClientAdminPacket(clientId) {
  return runPacketPrint('Client Packet — Admin Copy', () => buildClientAdminPacket(clientId));
}

function openProjectPacketMenu(project) {
  openScopedActionSheet({eyebrow:'Print packet', title:`Print ${project.name}`, subtitle:'Choose the audience for this Project packet.', actions:[
    {label:'Client Copy', description:'Quotes and Invoices only; safe to give to the Client.', run:() => printProjectClientPacket(project.id)},
    {label:'Admin Copy', description:'Complete internal record with Labor, Ledger, and receipts.', run:() => printProjectAdminPacket(project.id)},
  ]});
}

function attachPrintActions(scope=root) {
  scope.querySelectorAll('[data-action="print"]').forEach(btn => {
    btn.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      try { await printRecord(btn.dataset.type, Number(btn.dataset.id)); }
      catch (err) { await showForgeOpsError(err, 'Unable to print.'); }
    };
  });
}

function attachRowActions() {
  attachPrintActions(root);
  root.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.type === 'quote') state.quoteReturnFocusSelector = `[data-action="edit"][data-type="quote"][data-id="${Number(btn.dataset.id)}"]`;
      if (btn.dataset.type === 'ledger') state.ledgerReturnFocusSelector = `[data-action="edit"][data-type="ledger"][data-id="${Number(btn.dataset.id)}"]`;
      try { await editRecord(btn.dataset.type, Number(btn.dataset.id)); }
      catch (err) { await showForgeOpsError(err, 'Unable to open edit form.'); }
    };
  });
  root.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      try { await deleteRecord(btn.dataset.type, Number(btn.dataset.id)); }
      catch (err) { await showForgeOpsError(err, 'Unable to delete record.'); }
    };
  });
}

function attachProjectRowClicks() {
  root.querySelectorAll('.project-record-list [data-project-id]').forEach(row => {
    const open = () => renderProjectDetail(Number(row.dataset.projectId));
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      open();
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      open();
    });
  });
}

function attachQuoteRowClicks() {
  root.querySelectorAll('.quotes-table .quote-record-row[data-quote-id]').forEach(row => {
    const open = () => {
      state.quoteReturnFocusSelector = `[data-action="edit"][data-type="quote"][data-id="${Number(row.dataset.quoteId)}"]`;
      return editRecord('quote', Number(row.dataset.quoteId));
    };
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      open();
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      open();
    });
  });
  root.querySelectorAll('.quote-card-open[data-quote-id]').forEach(button => {
    button.onclick = () => {
      state.quoteReturnFocusSelector = `[data-action="edit"][data-type="quote"][data-id="${Number(button.dataset.quoteId)}"]`;
      return editRecord('quote', Number(button.dataset.quoteId));
    };
  });
}

function attachInvoiceRowClicks() {
  root.querySelectorAll('.invoices-table .invoice-record-row[data-invoice-id]').forEach(row => {
    const open = () => {
      state.invoiceReturnFocusSelector = `[data-action="edit"][data-type="invoice"][data-id="${Number(row.dataset.invoiceId)}"]`;
      return editRecord('invoice', Number(row.dataset.invoiceId));
    };
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      open();
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      open();
    });
  });
  root.querySelectorAll('.invoice-card-open[data-invoice-id]').forEach(button => {
    button.onclick = () => {
      state.invoiceReturnFocusSelector = `[data-action="edit"][data-type="invoice"][data-id="${Number(button.dataset.invoiceId)}"]`;
      return editRecord('invoice', Number(button.dataset.invoiceId));
    };
  });
}

function attachLedgerRowClicks() {
  root.querySelectorAll('.ledger-table .ledger-record-row[data-ledger-id]').forEach(row => {
    const open = () => {
      state.ledgerReturnFocusSelector = `[data-action="edit"][data-type="ledger"][data-id="${Number(row.dataset.ledgerId)}"]`;
      return editRecord('ledger', Number(row.dataset.ledgerId));
    };
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      open();
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      open();
    });
  });
  root.querySelectorAll('.ledger-card-open[data-ledger-id]').forEach(button => {
    button.onclick = () => {
      state.ledgerReturnFocusSelector = `[data-action="edit"][data-type="ledger"][data-id="${Number(button.dataset.ledgerId)}"]`;
      return editRecord('ledger', Number(button.dataset.ledgerId));
    };
  });
}

function attachLaborRowClicks() {
  root.querySelectorAll('.labor-table .labor-record-row[data-labor-id]').forEach(row => {
    const open = () => {
      state.laborReturnFocusSelector = `[data-action="edit"][data-type="labor"][data-id="${Number(row.dataset.laborId)}"]`;
      return editRecord('labor', Number(row.dataset.laborId));
    };
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      open();
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      open();
    });
  });
  root.querySelectorAll('.labor-card-open[data-labor-id]').forEach(button => {
    button.onclick = () => {
      state.laborReturnFocusSelector = `[data-action="edit"][data-type="labor"][data-id="${Number(button.dataset.laborId)}"]`;
      return editRecord('labor', Number(button.dataset.laborId));
    };
  });
}
async function deleteRecord(type, id) {
  const names = {client:'client', project:'project', quote:'quote', invoice:'invoice', ledger:'ledger entry', labor:'labor entry', receipt:'receipt'};
  const recordName = names[type] || 'record';
  const shouldDelete = await askForgeOpsDialog({
    title: `Delete ${recordName}?`,
    message: `Delete this ${recordName}? This cannot be undone.`,
    kind: 'destructive',
    primaryButtonText: 'Delete',
    cancelButtonText: 'Cancel',
  });
  if (!shouldDelete) return;
  try {
    const paths = {client:`/api/clients/${id}`, project:`/api/projects/${id}`, quote:`/api/quotes/${id}`, invoice:`/api/invoices/${id}`, ledger:`/api/ledger/${id}`, labor:`/api/labor/${id}`, receipt:`/api/receipts/${id}`};
    const clientId = state.clientDetailId;
    const clientTab = state.clientDetailTab;
    const projectId = state.projectDetailId;
    const projectTab = state.projectDetailTab;
    await api(paths[type], { method:'DELETE' });
    show(`${names[type]} deleted`);
    if (projectId && type !== 'project') {
      const typeMap = { quote: 'quotes', invoice: 'invoices', ledger: 'ledger', labor: 'labor', receipt: 'overview' };
      await renderProjectDetail(Number(projectId), typeMap[type] || projectTab || 'overview');
    } else if (clientId && type !== 'client') {
      const typeMap = { project: 'projects', quote: 'quotes', invoice: 'invoices', ledger: 'ledger', labor: 'labor', receipt: 'receipts' };
      await renderClientDetail(Number(clientId), typeMap[type] || clientTab || 'overview');
    } else {
      await loadPage(state.page);
    }
  } catch (err) { await showForgeOpsError(err); }
}
async function editRecord(type, id) {
  state.editing = { type, id };
  if (state.projectDetailId) {
    if (type === 'project') return renderProjects(id, Number(state.projectDetailId));
    const project = state.projects.find(item => Number(item.id) === Number(state.projectDetailId));
    const typeMap = { quote: 'quotes', invoice: 'invoices', labor: 'labor', receipt: 'receipts', ledger: 'ledger' };
    const quickType = typeMap[type];
    if (!project || !quickType) throw new Error(`Unknown project record type: ${type}`);
    await openClientQuickModal(Number(project.client_id), quickType, id, {projectId:Number(project.id), returnToProject:true});
    return;
  }
  if (state.clientDetailId && type !== 'client') {
    const typeMap = { project: 'projects', quote: 'quotes', invoice: 'invoices', labor: 'labor', receipt: 'receipts', ledger: 'ledger' };
    const quickType = typeMap[type];
    if (!quickType) throw new Error(`Unknown record type: ${type}`);
    await openClientQuickModal(Number(state.clientDetailId), quickType, id);
    return;
  }
  if (type === 'client') return renderClients(id);
  if (type === 'project') return renderProjects(id);
  if (type === 'quote') return renderQuotes(id);
  if (type === 'invoice') return renderInvoices(id);
  if (type === 'ledger') return renderLedger(id);
  if (type === 'labor') return renderLabor(id);
  if (type === 'receipt') return renderReceipts(id);
  throw new Error(`Unknown record type: ${type}`);
}

function adaptiveRecordList(headers, rows, empty='No records yet.', className='') {
  if (!rows.length) return `<div class="record-empty"><strong>Nothing here yet.</strong><span>${escapeHtml(empty)}</span></div>`;
  const columns = headers.map(() => 'minmax(0, 1fr)').join(' ');
  const header = headers.map(h => `<span>${escapeHtml(h)}</span>`).join('');
  const body = rows.map(row => `<article class="record-row ${row.className || ''}" ${row.attrs || ''} style="--record-columns:${columns}">${row.cells.map((cell, index) => `<div class="record-cell" data-label="${escapeHtml(headers[index])}">${cell ?? ''}</div>`).join('')}</article>`).join('');
  return `<div class="record-list ${className}"><div class="record-list-head" style="--record-columns:${columns}">${header}</div>${body}</div>`;
}

function attachRecordOpen(selector, callback) {
  root.querySelectorAll(selector).forEach(row => {
    const open = () => callback(row);
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      open();
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      open();
    });
  });
}

function contactEmail(value) {
  return value ? `<a href="mailto:${escapeHtml(value)}">${escapeHtml(value)}</a>` : '<span class="muted">No email</span>';
}

function contactPhone(value) {
  const href = String(value || '').replace(/[^+\d]/g, '');
  return value ? `<a href="tel:${escapeHtml(href)}">${escapeHtml(value)}</a>` : '<span class="muted">No phone</span>';
}

function detailTabButton(scope, current, tab, label) {
  return `<button class="tab ${current === tab ? 'active' : ''}" type="button" role="tab" aria-selected="${current === tab}" data-${scope}-tab="${tab}">${label}</button>`;
}

function setInlineFormError(form, error) {
  const target = form.querySelector('[data-form-error]');
  if (!target) return;
  target.textContent = error?.message || 'Unable to save this record.';
  target.classList.remove('hidden');
  target.focus();
}

function openScopedActionSheet({eyebrow='Add to record', title, subtitle='', actions=[]}) {
  document.querySelector('#scopedActionSheet')?.remove();
  const returnFocus = document.activeElement;
  const wrapper = document.createElement('div');
  wrapper.id = 'scopedActionSheet';
  wrapper.className = 'modal-backdrop scoped-action-backdrop';
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');
  wrapper.setAttribute('aria-labelledby', 'scopedActionTitle');
  wrapper.innerHTML = `<section class="scoped-action-sheet"><header><div><p class="sheet-eyebrow">${escapeHtml(eyebrow)}</p><h2 id="scopedActionTitle">${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><button class="sheet-close" type="button" data-scoped-close aria-label="Close action menu">×</button></header><div class="scoped-action-grid">${actions.map((action, index) => `<button type="button" data-scoped-action="${index}"><strong>${escapeHtml(action.label)}</strong><span>${escapeHtml(action.description || '')}</span></button>`).join('')}</div></section>`;
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    wrapper.remove();
    returnFocus?.focus?.();
  };
  const onKeydown = event => { if (event.key === 'Escape') close(); };
  wrapper.querySelector('[data-scoped-close]').onclick = close;
  wrapper.addEventListener('click', event => { if (event.target === wrapper) close(); });
  wrapper.querySelectorAll('[data-scoped-action]').forEach(button => {
    button.onclick = () => {
      const action = actions[Number(button.dataset.scopedAction)];
      close();
      Promise.resolve(action.run()).catch(err => showForgeOpsError(err, 'Unable to open that form.'));
    };
  });
  document.addEventListener('keydown', onKeydown);
  document.body.appendChild(wrapper);
  setTimeout(() => wrapper.querySelector('[data-scoped-action]')?.focus(), 0);
}


async function renderClients(editId=null, returnClientId=null) {
  const data = await api('/api/clients?page_size=100');
  const clients = [...(data.items || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, {sensitivity:'base'}));
  const editing = editId ? clients.find(c => c.id === editId) : null;
  const formTitle = editing ? 'Edit Client' : 'Add Client';
  const hasSeparateBilling = Boolean(editing?.billing_address && editing?.billing_address !== editing?.site_address);
  const clientRows = clients.map(c => ({
    attrs: `role="button" tabindex="0" data-client-id="${Number(c.id)}" data-active="${c.is_active ? 'active' : 'inactive'}" data-search="${escapeHtml([c.name,c.contact_name,c.email,c.phone,c.site_address,c.billing_address].join(' ').toLowerCase())}"`,
    cells: [
      `<div class="record-primary"><strong>${escapeHtml(c.name)}</strong><span>${escapeHtml(c.site_address || 'No primary site')}</span></div>`,
      `<div class="record-contact"><span>${escapeHtml(c.contact_name || 'No contact')}</span>${contactEmail(c.email)}${contactPhone(c.phone)}</div>`,
      `<span class="status ${c.is_active ? '' : 'muted-status'}">${c.is_active ? 'Active' : 'Inactive'}</span>`,
      rowActions('client', c.id),
    ],
  }));

  root.innerHTML = `<div class="page-actions record-page-actions"><div class="record-controls"><label class="search-field">Search Clients<input id="clientSearch" type="search" placeholder="Name, contact, email, phone, or address"></label><label class="filter-field">Status<select id="clientStatusFilter"><option value="all">All clients</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label><button class="ghost reset-filters" id="resetClientFilters" type="button">Reset</button><span class="result-count" id="clientResultCount" aria-live="polite"></span></div><button class="primary" id="openClientModal" type="button">+ Add Client</button></div>
  <section class="panel list-panel record-list-panel" aria-label="Clients">${adaptiveRecordList(['Client','Contact','Status','Actions'], clientRows, 'No clients yet. Add your first client to get started.', 'client-record-list')}</section>
  <div id="clientModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="clientModalTitle"><div class="modal-card"><div class="modal-header"><div><h2 id="clientModalTitle">${formTitle}</h2><p>${editing ? 'Update this client record.' : 'Create a client record without leaving the list.'}</p></div><button class="ghost modal-close" id="closeClientModal" type="button" aria-label="Close client form">×</button></div><form id="clientForm" class="form-grid">
    <fieldset class="form-section full"><legend>Identity &amp; contact</legend><div class="form-section-grid"><label class="client-field client-name-field">Client Name<input name="name" required value="${escapeHtml(editing?.name)}" placeholder="Company or household name"></label><label class="client-field">Primary Contact<input name="contact_name" value="${escapeHtml(editing?.contact_name)}" placeholder="Contact name"></label>
    <label class="client-field">Email<input name="email" type="email" value="${escapeHtml(editing?.email)}" placeholder="name@example.com"></label><label class="client-field">Phone<input name="phone" value="${escapeHtml(editing?.phone)}" placeholder="(555) 555-5555"></label></div></fieldset>
    <fieldset class="form-section full"><legend>Addresses</legend><div class="form-section-grid"><label class="client-field client-address-field">Primary Site Address<textarea name="site_address" rows="2" placeholder="Main job/site address for this client">${escapeHtml(editing?.site_address)}</textarea></label>
    <label class="check-row client-billing-toggle"><input id="separateBilling" type="checkbox" ${hasSeparateBilling ? 'checked' : ''}> Separate billing address</label>
    <label id="billingAddressField" class="full client-field client-address-field ${hasSeparateBilling ? '' : 'hidden'}">Billing Address<textarea name="billing_address" rows="3" placeholder="Billing address">${escapeHtml(editing?.billing_address)}</textarea></label></div></fieldset>
    <fieldset class="form-section full"><legend>Internal details</legend><div class="form-section-grid"><label class="full client-field">Notes<textarea name="notes" rows="3" placeholder="Internal notes">${escapeHtml(editing?.notes)}</textarea></label><label class="check-row client-active-toggle"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? 'checked' : ''}> Active Client</label></div></fieldset>
    <p class="form-error hidden full" data-form-error role="alert" tabindex="-1"></p>
    <div class="form-actions client-modal-actions"><button class="ghost" type="button" id="cancelClientModal">Cancel</button><button class="primary" type="submit">${editing ? 'Update Client' : 'Save Client'}</button></div>
  </form></div></div>`;

  const modal = document.querySelector('#clientModal');
  const clientFormEl = document.querySelector('#clientForm');
  const separateBillingToggle = document.querySelector('#separateBilling');
  const billingAddressField = document.querySelector('#billingAddressField');
  const openModal = () => { modal.classList.remove('hidden'); setTimeout(() => clientFormEl.querySelector('input[name="name"]')?.focus(), 0); };
  const closeModal = () => returnClientId ? renderClientDetail(returnClientId) : renderClients();
  document.querySelector('#openClientModal').onclick = openModal;
  document.querySelector('#closeClientModal').onclick = closeModal;
  document.querySelector('#cancelClientModal').onclick = closeModal;
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function escClose(e) { if (e.key === 'Escape' && !modal.classList.contains('hidden')) { document.removeEventListener('keydown', escClose); closeModal(); } });
  separateBillingToggle.onchange = () => {
    billingAddressField.classList.toggle('hidden', !separateBillingToggle.checked);
    if (!separateBillingToggle.checked) clientFormEl.elements.billing_address.value = clientFormEl.elements.site_address.value;
  };
  if (editing) openModal();

  const applyClientFilters = () => {
    const q = clientSearch.value.trim().toLowerCase();
    const status = clientStatusFilter.value;
    const rows = [...root.querySelectorAll('.client-record-list .record-row')];
    let shown = 0;
    for (const row of rows) {
      const matchesSearch = !q || row.dataset.search.includes(q);
      const matchesStatus = status === 'all' || row.dataset.active === status;
      const showRow = matchesSearch && matchesStatus;
      row.classList.toggle('hidden', !showRow);
      if (showRow) shown += 1;
    }
    let empty = root.querySelector('[data-client-filter-empty]');
    if (!shown && clients.length) {
      if (!empty) {
        empty = document.createElement('div');
        empty.dataset.clientFilterEmpty = 'true';
        empty.className = 'record-empty';
        empty.innerHTML = '<strong>No matches</strong><span>Try a different search or reset the filters.</span>';
        root.querySelector('.client-record-list')?.appendChild(empty);
      }
      empty.classList.remove('hidden');
    } else if (empty) {
      empty.classList.add('hidden');
    }
    clientResultCount.textContent = `${shown} of ${clients.length} client${clients.length === 1 ? '' : 's'}`;
  };
  clientStatusFilter.value = state.clientStatusFilter || 'all';
  clientSearch.addEventListener('input', applyClientFilters);
  clientStatusFilter.addEventListener('change', () => { state.clientStatusFilter = clientStatusFilter.value; applyClientFilters(); });
  resetClientFilters.onclick = () => { clientSearch.value = ''; clientStatusFilter.value = 'all'; state.clientStatusFilter = 'all'; applyClientFilters(); clientSearch.focus(); };
  applyClientFilters();
  attachRecordOpen('.client-record-list [data-client-id]', row => renderClientDetail(Number(row.dataset.clientId)));

  clientFormEl.onsubmit = async e => {
    e.preventDefault();
    if (!separateBillingToggle.checked) clientFormEl.elements.billing_address.value = clientFormEl.elements.site_address.value;
    const payload = clean(formData(clientFormEl)); payload.is_active = formBool(clientFormEl, 'is_active');
    try {
      if (editing) await api(`/api/clients/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)});
      else await api('/api/clients', {method:'POST', body: JSON.stringify(payload)});
      show(editing ? 'Client updated' : 'Client saved');
      await preloadLookups();
      if (returnClientId) await renderClientDetail(returnClientId); else await renderClients();
    } catch (err) { setInlineFormError(clientFormEl, err); }
  };
  attachRowActions();
}


function clientRelatedReceipts(clientId, receipts, ledgerEntries) {
  const projectIds = new Set(state.projects.filter(p => Number(p.client_id) === Number(clientId)).map(p => Number(p.id)));
  const quoteIds = new Set(state.quotes.filter(q => Number(q.client_id) === Number(clientId)).map(q => Number(q.id)));
  const invoiceIds = new Set(state.invoices.filter(i => Number(i.client_id) === Number(clientId)).map(i => Number(i.id)));
  const ledgerIds = new Set(ledgerEntries.filter(l => Number(l.client_id) === Number(clientId) || (l.project_id && projectIds.has(Number(l.project_id)))).map(l => Number(l.id)));
  return receipts.filter(r => {
    const linkedId = Number(r.linked_id);
    return (r.linked_type === 'client' && linkedId === Number(clientId))
      || (r.linked_type === 'project' && projectIds.has(linkedId))
      || (r.linked_type === 'quote' && quoteIds.has(linkedId))
      || (r.linked_type === 'invoice' && invoiceIds.has(linkedId))
      || (r.linked_type === 'ledger_entry' && ledgerIds.has(linkedId));
  });
}
function tabButton(tab, label) {
  return `<button class="tab ${state.clientDetailTab === tab ? 'active' : ''}" data-client-tab="${tab}">${label}</button>`;
}
function compactTable(headers, rows, empty='No records yet.', className='') {
  const wrapClass = className ? `table-wrap ${className}` : 'table-wrap';
  return `<div class="${wrapClass}"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r=>`<tr>${r.map((c, i)=>`<td data-label="${escapeHtml(headers[i])}">${c??''}</td>`).join('')}</tr>`).join('') : `<tr class="compact-empty-row"><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`;
}
function dashboardTable(headers, rows, empty='No records yet.', rowAttrs=[]) {
  const body = rows.length
    ? rows.map((r, rowIndex) => `<tr ${rowAttrs[rowIndex] || ''}>${r.map((c, i) => `<td data-label="${escapeHtml(headers[i])}">${c ?? ''}</td>`).join('')}</tr>`).join('')
    : `<tr class="dashboard-empty-row"><td colspan="${headers.length}">${empty}</td></tr>`;
  return `<div class="table-wrap dashboard-table"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
async function renderClientDetailLegacy(clientId, tab=state.clientDetailTab || 'overview') {
  state.page = 'clients';
  state.clientDetailId = clientId;
  state.clientDetailTab = tab;
  state.editing = null;
  await preloadLookups();
  const client = state.clients.find(c => Number(c.id) === Number(clientId)) || await api(`/api/clients/${clientId}`);
  const [projectsData, quotesData, invoicesData, laborData, ledgerData, receiptsData] = await Promise.all([
    api(`/api/projects?client_id=${clientId}&page_size=100`),
    api(`/api/quotes?client_id=${clientId}&page_size=100`),
    api(`/api/invoices?client_id=${clientId}&page_size=100`),
    api(`/api/labor?client_id=${clientId}&page_size=100`),
    api('/api/ledger?page_size=100'),
    api('/api/receipts?page_size=100'),
  ]);
  const projects = projectsData.items || [];
  const quotes = quotesData.items || [];
  const invoices = invoicesData.items || [];
  const labor = laborData.items || [];
  const ledger = (ledgerData.items || []).filter(l => Number(l.client_id) === Number(clientId) || (l.project_id && projects.some(p => Number(p.id) === Number(l.project_id))));
  const receipts = clientRelatedReceipts(clientId, receiptsData.items || [], ledger);
  const outstanding = invoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
  const invoiceTotal = invoices.reduce((sum, i) => sum + Number(i.total_amount || 0), 0);
  const uninvoicedLabor = labor.filter(l => !l.is_invoiced).reduce((sum, l) => sum + Number(l.line_total || 0), 0);
  const revenue = ledger.filter(l => l.kind === 'revenue' || l.kind === 'income').reduce((sum, l) => sum + Math.abs(Number(l.amount || 0)), 0);
  const expenses = ledger
    .filter(l => (l.kind === 'expense' || l.kind === 'cogs') && !TAX_PAYMENT_CATEGORIES.has(l.category || ''))
    .reduce((sum, l) => sum + Math.abs(Number(l.amount || 0)), 0);

  document.querySelector('#pageTitle').textContent = client.name;
  document.querySelector('#pageSubtitle').textContent = 'Client profile with projects, quotes, invoices, labor, and ledger activity.';
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.page === 'clients'));

  const overviewHtml = `<div class="cards detail-cards client-summary-cards">
    <div class="card"><span>Projects</span><strong>${projects.length}</strong></div>
    <div class="card"><span>Quotes</span><strong>${quotes.length}</strong></div>
    <div class="card"><span>Invoices</span><strong>${invoices.length}</strong></div>
    <div class="card"><span>Outstanding</span><strong>${money(outstanding)}</strong></div>
    <div class="card"><span>Uninvoiced Labor</span><strong>${money(uninvoicedLabor)}</strong></div>
    <div class="card"><span>Ledger Profit</span><strong>${money(revenue - expenses)}</strong></div>
  </div>
  <div class="panel"><h2>Client Info</h2><div class="info-grid"><div><strong>Contact</strong><span>${escapeHtml(client.contact_name || '—')}</span></div><div><strong>Email</strong><span>${escapeHtml(client.email || '—')}</span></div><div><strong>Phone</strong><span>${escapeHtml(client.phone || '—')}</span></div><div><strong>Status</strong><span>${client.is_active ? 'Active' : 'Inactive'}</span></div><div class="wide"><strong>Billing Address</strong><span>${escapeHtml(client.billing_address || '—')}</span></div><div class="wide"><strong>Primary Site</strong><span>${escapeHtml(client.site_address || '—')}</span></div></div></div>
  <div class="panel"><h2>Recent Activity</h2>${compactTable(['Type','Reference','Project','Status/Date','Amount'], [
    ...invoices.slice(0, 5).map(i => ['Invoice', escapeHtml(i.invoice_number), escapeHtml(projectName(i.project_id)), statusLabel(i.status), money(i.balance_due)]),
    ...quotes.slice(0, 5).map(q => ['Quote', escapeHtml(q.quote_number), escapeHtml(projectName(q.project_id)), statusLabel(q.status), money(q.total_amount)]),
    ...labor.slice(0, 5).map(l => ['Labor', escapeHtml(l.service_type), escapeHtml(projectName(l.project_id)), escapeHtml(l.work_date), money(l.line_total)]),
  ].slice(0, 10), 'No activity for this client yet.')}</div>`;

  const tabHtml = {
    overview: overviewHtml,
    projects: `<div class="panel"><h2>Projects</h2>${compactTable(['Project','Status','Site Address','Start','End','Actions'], projects.map(p => [escapeHtml(p.name), `<span class="status">${statusLabel(p.status)}</span>`, escapeHtml(p.site_address), p.start_date, p.completed_date, rowActions('project', p.id)]))}</div>`,
    quotes: `<div class="panel"><h2>Quotes</h2>${compactTable(['Quote #','Title','Project','Status','Date','Valid Until','Total','Actions'], quotes.map(q => [escapeHtml(q.quote_number), escapeHtml(q.title), escapeHtml(projectName(q.project_id)), `<span class="status">${statusLabel(q.status)}</span>`, q.quote_date, q.valid_until, money(q.total_amount), rowActions('quote', q.id)]))}</div>`,
    invoices: `<div class="panel"><h2>Invoices</h2>${compactTable(['Invoice #','Title','Project','Quote','Status','Date','Total','Paid','Balance','Actions'], invoices.map(i => [escapeHtml(i.invoice_number), escapeHtml(i.title), escapeHtml(projectName(i.project_id)), escapeHtml(quoteName(i.quote_id)), `<span class="status">${statusLabel(i.status)}</span>`, i.invoice_date, money(i.total_amount), money(i.amount_paid), money(i.balance_due), rowActions('invoice', i.id)]))}<div class="totals-row"><strong>Total invoiced: ${money(invoiceTotal)}</strong><strong>Outstanding: ${money(outstanding)}</strong></div></div>`,
    labor: `<div class="panel"><h2>Labor</h2>${compactTable(['Date','Project','Service','Hours','Rate','Total','Invoice','Invoiced','Actions'], labor.map(l => [l.work_date, escapeHtml(projectName(l.project_id)), escapeHtml(l.service_type), l.hours, money(l.hourly_rate), money(l.line_total), escapeHtml(invoiceName(l.invoice_id) || l.invoice_number || ''), l.is_invoiced ? 'Yes' : 'No', rowActions('labor', l.id)]))}<div class="totals-row"><strong>Uninvoiced labor: ${money(uninvoicedLabor)}</strong></div></div>`,
    ledger: `<div class="panel"><h2>Ledger</h2>${compactTable(['Date','Account Type','Category','Project','Quote','Invoice','Amount','Receipt','Notes','Actions'], ledger.map(l => [l.entry_date, statusLabel(l.kind), escapeHtml(l.category), escapeHtml(projectName(l.project_id)), escapeHtml(quoteName(l.quote_id)), escapeHtml(invoiceName(l.invoice_id)), money(l.amount), l.receipt_id ? receiptPreviewButton(l.receipt_id) : '—', escapeHtml(l.description), rowActions('ledger', l.id)]))}<div class="totals-row"><strong>Revenue: ${money(revenue)}</strong><strong>Expenses: ${money(expenses)}</strong><strong>Profit: ${money(revenue - expenses)}</strong></div></div>`,
  };

  root.innerHTML = `<div class="detail-header"><button class="ghost" id="backToClients" type="button">← Back to Clients</button><div class="detail-title"><h2>${escapeHtml(client.name)}</h2><p>${escapeHtml(client.contact_name || '')}${client.phone ? ` • ${escapeHtml(client.phone)}` : ''}${client.email ? ` • ${escapeHtml(client.email)}` : ''}</p></div><div class="quick-actions"><button class="mini" data-quick-page="projects">+ Project</button><button class="mini" data-quick-page="quotes">+ Quote</button><button class="mini" data-quick-page="invoices">+ Invoice</button><button class="mini" data-quick-page="labor">+ Labor</button><button class="mini" data-quick-page="ledger">+ Ledger</button></div></div>
  <div class="tabs">${tabButton('overview','Overview')}${tabButton('projects',`Projects (${projects.length})`)}${tabButton('quotes',`Quotes (${quotes.length})`)}${tabButton('invoices',`Invoices (${invoices.length})`)}${tabButton('labor',`Labor (${labor.length})`)}${tabButton('ledger',`Ledger (${ledger.length})`)}</div>
  ${tabHtml[tab] || overviewHtml}`;
  const mobileTabCard = (tab, label, value) => `<button class="card client-mobile-tab-card ${state.clientDetailTab === tab ? 'active' : ''}" data-client-tab="${tab}" type="button"><span>${label}</span><strong>${value}</strong></button>`;
  root.querySelector('.detail-header')?.insertAdjacentHTML('afterend', `<div class="cards detail-cards client-mobile-tab-cards" aria-label="Client sections">
    ${mobileTabCard('projects', 'Projects', projects.length)}
    ${mobileTabCard('quotes', 'Quotes', quotes.length)}
    ${mobileTabCard('invoices', 'Invoices', invoices.length)}
    ${mobileTabCard('invoices', 'Outstanding', money(outstanding))}
    ${mobileTabCard('labor', 'Uninvoiced Labor', money(uninvoicedLabor))}
    ${mobileTabCard('ledger', 'Ledger Profit', money(revenue - expenses))}
  </div>`);
  backToClients.onclick = () => loadPage('clients');
  root.querySelectorAll('[data-client-tab]').forEach(btn => btn.addEventListener('click', () => renderClientDetail(clientId, btn.dataset.clientTab)));
  root.querySelectorAll('[data-quick-page]').forEach(btn => btn.addEventListener('click', () => openClientQuickModal(clientId, btn.dataset.quickPage)));
  attachRowActions();
}

async function renderClientDetail(clientId, tab=state.clientDetailTab || 'overview') {
  state.page = 'clients';
  state.clientDetailId = clientId;
  state.projectDetailId = null;
  state.clientDetailTab = tab;
  state.editing = null;
  await preloadLookups();
  const client = state.clients.find(c => Number(c.id) === Number(clientId)) || await api(`/api/clients/${clientId}`);
  const [projectsData, quotesData, invoicesData, laborData, ledgerData, receiptsData] = await Promise.all([
    api(`/api/projects?client_id=${clientId}&page_size=100`),
    api(`/api/quotes?client_id=${clientId}&page_size=100`),
    api(`/api/invoices?client_id=${clientId}&page_size=100`),
    api(`/api/labor?client_id=${clientId}&page_size=100`),
    api('/api/ledger?page_size=100'),
    api('/api/receipts?page_size=100'),
  ]);
  const projects = projectsData.items || [];
  const quotes = quotesData.items || [];
  const invoices = invoicesData.items || [];
  const labor = laborData.items || [];
  const ledger = (ledgerData.items || []).filter(entry => Number(entry.client_id) === Number(clientId) || (entry.project_id && projects.some(project => Number(project.id) === Number(entry.project_id))));
  const receipts = clientRelatedReceipts(clientId, receiptsData.items || [], ledger);
  const outstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0);
  const uninvoicedLabor = labor.filter(entry => !entry.is_invoiced).reduce((sum, entry) => sum + Number(entry.line_total || 0), 0);
  const revenue = ledger.filter(entry => ['revenue','income'].includes(entry.kind)).reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);
  const expenses = ledger.filter(entry => ['expense','cogs'].includes(entry.kind) && !TAX_PAYMENT_CATEGORIES.has(entry.category || '')).reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);

  const projectRows = projects.map(project => ({attrs:`role="button" tabindex="0" data-related-type="project" data-related-id="${project.id}"`, cells:[`<div class="record-primary"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.site_address || 'No site address')}</span></div>`,`<span class="status">${statusLabel(project.status)}</span>`,shortDate(project.start_date),rowActions('project', project.id)]}));
  const quoteRows = quotes.map(quote => ({attrs:`role="button" tabindex="0" data-related-type="quote" data-related-id="${quote.id}"`, cells:[`<div class="record-primary"><strong>${escapeHtml(quote.quote_number)}</strong><span>${escapeHtml(quote.title)}</span></div>`,escapeHtml(projectName(quote.project_id) || 'No project'),`<span class="status">${statusLabel(quote.status)}</span>`,money(quote.total_amount),quoteRowActions(quote.id)]}));
  const invoiceRows = invoices.map(invoice => ({attrs:`role="button" tabindex="0" data-related-type="invoice" data-related-id="${invoice.id}"`, cells:[`<div class="record-primary"><strong>${escapeHtml(invoice.invoice_number)}</strong><span>${escapeHtml(invoice.title)}</span></div>`,escapeHtml(projectName(invoice.project_id) || 'No project'),`<span class="status">${statusLabel(invoice.status)}</span>`,money(invoice.balance_due),rowActions('invoice', invoice.id)]}));
  const laborRows = labor.map(entry => ({attrs:`role="button" tabindex="0" data-related-type="labor" data-related-id="${entry.id}"`, cells:[shortDate(entry.work_date),`<div class="record-primary"><strong>${escapeHtml(entry.service_type)}</strong><span>${escapeHtml(projectName(entry.project_id) || 'No project')}</span></div>`,`${escapeHtml(entry.hours)} hr`,money(entry.line_total),entry.is_invoiced ? '<span class="status">Invoiced</span>' : '<span class="status attention-status">Uninvoiced</span>',rowActions('labor', entry.id)]}));
  const ledgerRows = ledger.map(entry => ({attrs:`role="button" tabindex="0" data-related-type="ledger" data-related-id="${entry.id}"`, cells:[shortDate(entry.entry_date),`<div class="record-primary"><strong>${escapeHtml(ledgerKindLabel(entry.kind))}</strong><span>${escapeHtml(entry.category)}</span></div>`,escapeHtml(projectName(entry.project_id) || 'No project'),money(entry.amount),entry.receipt_id ? receiptPreviewButton(entry.receipt_id) : '—',rowActions('ledger', entry.id)]}));
  const receiptRows = receipts.slice(0, 5).map(receipt => ({attrs:`role="button" tabindex="0" data-related-type="receipt" data-related-id="${receipt.id}"`, cells:[`<div class="record-primary"><strong>${escapeHtml(receipt.original_filename)}</strong><span>${escapeHtml(receipt.vendor_name || 'No vendor')}</span></div>`,shortDate(receipt.receipt_date),money(receipt.total_amount),receiptPreviewButton(receipt.id),rowActions('receipt', receipt.id)]}));
  const recent = [
    ...invoices.map(i => ({sort:i.invoice_date, type:'invoice', id:i.id, cells:['Invoice',`<strong>${escapeHtml(i.invoice_number)}</strong>`,escapeHtml(projectName(i.project_id) || 'No project'),statusLabel(i.status),money(i.balance_due)]})),
    ...quotes.map(q => ({sort:q.quote_date, type:'quote', id:q.id, cells:['Quote',`<strong>${escapeHtml(q.quote_number)}</strong>`,escapeHtml(projectName(q.project_id) || 'No project'),statusLabel(q.status),money(q.total_amount)]})),
    ...labor.map(l => ({sort:l.work_date, type:'labor', id:l.id, cells:['Labor',`<strong>${escapeHtml(l.service_type)}</strong>`,escapeHtml(projectName(l.project_id) || 'No project'),shortDate(l.work_date),money(l.line_total)]})),
  ].sort((a, b) => String(b.sort || '').localeCompare(String(a.sort || ''))).slice(0, 6).map(item => ({attrs:`role="button" tabindex="0" data-related-type="${item.type}" data-related-id="${item.id}"`, cells:item.cells}));

  document.querySelector('#pageTitle').textContent = client.name;
  document.querySelector('#pageSubtitle').textContent = 'Client hub for work, documents, labor, and ledger activity.';
  updateActiveNavigation('clients');
  document.querySelector('#mobilePageTitle').textContent = client.name;

  const overviewHtml = `<div class="cards hub-summary-cards"><div class="card"><span>Projects</span><strong>${projects.length}</strong></div><div class="card"><span>Outstanding</span><strong>${money(outstanding)}</strong></div><div class="card"><span>Uninvoiced Labor</span><strong>${money(uninvoicedLabor)}</strong></div><div class="card"><span>Ledger Balance</span><strong>${money(revenue - expenses)}</strong></div></div>
    <section class="panel detail-info-panel"><div class="panel-heading"><h2>Client details</h2><span class="status ${client.is_active ? '' : 'muted-status'}">${client.is_active ? 'Active' : 'Inactive'}</span></div><div class="info-grid"><div><strong>Primary contact</strong><span>${escapeHtml(client.contact_name || '—')}</span></div><div><strong>Email</strong><span>${contactEmail(client.email)}</span></div><div><strong>Phone</strong><span>${contactPhone(client.phone)}</span></div><div class="wide"><strong>Primary site</strong><span>${escapeHtml(client.site_address || '—')}</span></div><div class="wide"><strong>Billing address</strong><span>${escapeHtml(client.billing_address || '—')}</span></div>${client.notes ? `<div class="wide"><strong>Notes</strong><span>${escapeHtml(client.notes)}</span></div>` : ''}</div></section>
    <section class="panel"><div class="panel-heading"><h2>Recent activity</h2></div>${adaptiveRecordList(['Type','Record','Project','Status / Date','Amount'], recent, 'No activity for this client yet.', 'client-related-list')}</section>
    <section class="panel"><div class="panel-heading"><h2>Recent receipts</h2><span class="muted">${receipts.length} related</span></div>${adaptiveRecordList(['Receipt','Date','Total','File','Actions'], receiptRows, 'No receipts are related to this client yet.', 'client-related-list')}</section>`;
  const tabs = {
    overview: overviewHtml,
    projects: `<section class="panel"><div class="panel-heading"><h2>Projects</h2><span class="result-count">${projects.length}</span></div>${adaptiveRecordList(['Project','Status','Start','Actions'], projectRows, 'No projects for this client yet.', 'client-related-list')}</section>`,
    quotes: `<section class="panel"><div class="panel-heading"><h2>Quotes</h2><span class="result-count">${quotes.length}</span></div>${adaptiveRecordList(['Quote','Project','Status','Total','Actions'], quoteRows, 'No quotes for this client yet.', 'client-related-list')}</section>`,
    invoices: `<section class="panel"><div class="panel-heading"><h2>Invoices</h2><strong>Outstanding ${money(outstanding)}</strong></div>${adaptiveRecordList(['Invoice','Project','Status','Balance','Actions'], invoiceRows, 'No invoices for this client yet.', 'client-related-list')}</section>`,
    labor: `<section class="panel"><div class="panel-heading"><h2>Labor</h2><strong>Uninvoiced ${money(uninvoicedLabor)}</strong></div>${adaptiveRecordList(['Date','Service','Hours','Value','Billing','Actions'], laborRows, 'No labor for this client yet.', 'client-related-list')}</section>`,
    ledger: `<section class="panel"><div class="panel-heading"><h2>Ledger</h2><strong>Balance ${money(revenue - expenses)}</strong></div>${adaptiveRecordList(['Date','Entry','Project','Amount','Receipt','Actions'], ledgerRows, 'No ledger entries for this client yet.', 'client-related-list')}</section>`,
  };

  root.innerHTML = `<div class="detail-header hub-header"><button class="ghost" id="backToClients" type="button">← Clients</button><div class="detail-title"><div class="hub-title-line"><h2>${escapeHtml(client.name)}</h2><span class="status ${client.is_active ? '' : 'muted-status'}">${client.is_active ? 'Active' : 'Inactive'}</span></div><div class="hub-contact-line"><span>${escapeHtml(client.contact_name || 'No primary contact')}</span>${client.email ? contactEmail(client.email) : ''}${client.phone ? contactPhone(client.phone) : ''}</div><p>${escapeHtml(client.site_address || 'No primary site address')}</p></div><div class="hub-header-actions"><button class="ghost packet-header-action" id="printClientAdminPacket" type="button">Print Admin Packet</button><button class="ghost" id="editClientDetail" type="button">Edit</button><button class="primary" id="addClientDetail" type="button">+ Add</button></div></div>
    <div class="tabs hub-tabs detail-tab-grid client-detail-tabs" role="tablist" aria-label="Client sections">${detailTabButton('client', tab, 'overview','Overview')}${detailTabButton('client', tab, 'projects',`Projects (${projects.length})`)}${detailTabButton('client', tab, 'quotes',`Quotes (${quotes.length})`)}${detailTabButton('client', tab, 'invoices',`Invoices (${invoices.length})`)}${detailTabButton('client', tab, 'labor',`Labor (${labor.length})`)}${detailTabButton('client', tab, 'ledger',`Ledger (${ledger.length})`)}</div>${tabs[tab] || overviewHtml}`;

  backToClients.onclick = () => loadPage('clients');
  root.querySelector('#printClientAdminPacket').onclick = () => printClientAdminPacket(clientId);
  editClientDetail.onclick = () => renderClients(clientId, clientId);
  addClientDetail.onclick = () => openScopedActionSheet({title:`Add to ${client.name}`, subtitle:'The client is already selected in each form.', actions:[
    {label:'New Project', description:'Create a project for this client.', run:() => openClientQuickModal(clientId, 'projects')},
    {label:'New Quote', description:'Start a client-scoped quote.', run:() => openClientQuickModal(clientId, 'quotes')},
    {label:'New Invoice', description:'Start a client-scoped invoice.', run:() => openClientQuickModal(clientId, 'invoices')},
    {label:'Add Labor', description:'Log billable work.', run:() => openClientQuickModal(clientId, 'labor')},
    {label:'Add Expense', description:'Add a client expense.', run:() => openClientQuickModal(clientId, 'ledger', null, {ledgerKind:'expense'})},
    {label:'Ledger Entry', description:'Add income, COGS, or an expense.', run:() => openClientQuickModal(clientId, 'ledger')},
    {label:'Print Admin Packet', description:'Print the complete internal Client history.', run:() => printClientAdminPacket(clientId)},
  ]});
  root.querySelectorAll('[data-client-tab]').forEach(button => button.addEventListener('click', () => renderClientDetail(clientId, button.dataset.clientTab)));
  attachRecordOpen('.client-related-list [data-related-type][data-related-id]', row => {
    const type = row.dataset.relatedType;
    const id = Number(row.dataset.relatedId);
    if (type === 'project') return renderProjectDetail(id);
    return editRecord(type, id);
  });
  attachRowActions();
  attachQuoteInvoiceActions();
}

async function renderProjects(editId=null, returnProjectId=null) {
  const data = await api('/api/projects?page_size=100');
  const editing = editId ? data.items.find(p => p.id === editId) : null;
  const currentClientId = editing?.client_id || '';
  const addresses = await ensureAddresses(currentClientId);
  const finishedStatuses = new Set(['completed', 'closed', 'canceled']);
  const projectStatusFilterValue = state.projectStatusFilter || 'all';
  const projectClientFilterValue = state.projectClientFilter || 'all';
  const sortedProjects = [...(data.items || [])].sort((a, b) => {
    const aFinished = finishedStatuses.has(String(a.status || '').toLowerCase());
    const bFinished = finishedStatuses.has(String(b.status || '').toLowerCase());
    return Number(aFinished) - Number(bFinished) || String(a.name || '').localeCompare(String(b.name || ''), undefined, {sensitivity:'base'});
  });
  const visibleProjects = sortedProjects.filter(p => {
    const status = String(p.status || '').toLowerCase();
    const matchesStatus = projectStatusFilterValue === 'all' || (projectStatusFilterValue === 'finished' ? finishedStatuses.has(status) : !finishedStatuses.has(status));
    const matchesClient = projectClientFilterValue === 'all' || String(p.client_id) === String(projectClientFilterValue);
    return matchesStatus && matchesClient;
  });
  const rows = visibleProjects.map(p => ({attrs:`role="button" tabindex="0" data-project-id="${Number(p.id)}" data-search="${escapeHtml([p.name,clientName(p.client_id),p.status,p.site_address,p.start_date,p.completed_date].join(' ').toLowerCase())}"`, cells:[`<div class="record-primary"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.site_address || 'No site address')}</span></div>`,escapeHtml(clientName(p.client_id)),`<span class="status">${statusLabel(p.status)}</span>`,shortDate(p.start_date),shortDate(p.completed_date),rowActions('project', p.id)]}));
  root.innerHTML = `<div class="page-actions record-page-actions"><div class="record-controls"><label class="search-field compact-search">Search Projects<input id="projectSearch" type="search" placeholder="Project, client, address, or status"></label><label class="filter-field">Status<select id="projectStatusFilter"><option value="all">All projects</option><option value="active">Current / Open</option><option value="finished">Completed / Canceled</option></select></label><label class="filter-field">Client<select id="projectClientFilter"><option value="all">All clients</option>${state.clients.map(client => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join('')}</select></label><button class="ghost reset-filters" id="resetProjectFilters" type="button">Reset</button><span class="result-count" id="projectResultCount" aria-live="polite">${visibleProjects.length} of ${sortedProjects.length} projects</span></div><button class="primary" id="openProjectModal" type="button">+ Add Project</button></div>
  <section class="panel list-panel record-list-panel" aria-label="Projects">${adaptiveRecordList(['Project','Client','Status','Start','Completed','Actions'], rows, 'No projects yet. Add your first project to get started.', 'project-record-list')}</section>
  <div id="projectModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="projectModalTitle"><div class="modal-card"><div class="modal-header"><div><h2 id="projectModalTitle">${editing ? 'Edit Project' : 'Add Project'}</h2><p>${editing ? 'Update this project.' : 'Create a project and attach it to a client.'}</p></div><button class="ghost modal-close" id="closeProjectModal" type="button" aria-label="Close project form">×</button></div><form id="projectForm" class="form-grid">
    <fieldset class="form-section full"><legend>Project basics</legend><div class="form-section-grid"><label class="project-field">Client<select name="client_id" id="projectClient" required>${clientOptions(currentClientId)}</select></label><label class="project-field">Project Name<input name="name" required value="${escapeHtml(editing?.name)}" placeholder="Project name"></label><label class="project-field">Status<select name="status"><option value="lead">Lead</option><option value="quoted">Quoted</option><option value="approved">Approved</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label></div></fieldset>
    <fieldset class="form-section full"><legend>Schedule &amp; location</legend><div class="form-section-grid"><label class="project-field">Start Date<input name="start_date" type="date" value="${escapeHtml(editing?.start_date)}"></label><label class="project-field">End Date<input name="completed_date" type="date" value="${escapeHtml(editing?.completed_date)}"></label><label class="project-field full">Site Address<select id="siteAddressSelect">${addressOptions(addresses, editing?.site_address)}</select><input type="hidden" name="site_address" id="projectSiteAddress" value="${escapeHtml(editing?.site_address)}"></label><label id="newAddressWrap" class="full project-field project-address-field hidden">New Site Address<textarea id="projectNewSiteAddress" rows="2" placeholder="Enter the new site address"></textarea><span class="project-subfield-label">Address Label</span><input id="newAddressLabel" value="Site"></label></div></fieldset>
    <fieldset class="form-section full"><legend>Internal details</legend><div class="form-section-grid"><label class="full project-field project-notes-field">Notes<textarea name="notes" rows="3" placeholder="Internal project notes">${escapeHtml(editing?.notes)}</textarea></label></div></fieldset>
    <p class="form-error hidden full" data-form-error role="alert" tabindex="-1"></p>
    <div class="form-actions project-modal-actions"><button class="ghost" type="button" id="cancelProjectModal">Cancel</button><button class="primary" type="submit">${editing ? 'Update Project' : 'Save Project'}</button></div>
  </form></div></div>`;
  projectStatusFilter.value = state.projectStatusFilter || 'all';
  projectClientFilter.value = state.projectClientFilter || 'all';
  projectStatusFilter.onchange = () => { state.projectStatusFilter = projectStatusFilter.value; renderProjects(); };
  projectClientFilter.onchange = () => { state.projectClientFilter = projectClientFilter.value; renderProjects(); };
  resetProjectFilters.onclick = () => { state.projectStatusFilter = 'all'; state.projectClientFilter = 'all'; renderProjects(); };
  projectForm.status.value = editing?.status || 'lead';
  projectClient.onchange = async () => { state.addressesByClient[projectClient.value] = null; const list = await ensureAddresses(projectClient.value); siteAddressSelect.innerHTML = addressOptions(list); projectSiteAddress.value = ''; projectNewSiteAddress.value = ''; newAddressWrap.classList.add('hidden'); };
  siteAddressSelect.onchange = () => { if (siteAddressSelect.value === '__new__') { newAddressWrap.classList.remove('hidden'); projectSiteAddress.value = ''; projectNewSiteAddress.focus(); } else { newAddressWrap.classList.add('hidden'); projectNewSiteAddress.value = ''; projectSiteAddress.value = siteAddressSelect.value; } };
  projectForm.onsubmit = async e => {
    e.preventDefault();
    if (siteAddressSelect.value === '__new__') projectSiteAddress.value = projectNewSiteAddress.value;
    const payload = clean(formData(projectForm)); payload.client_id = Number(payload.client_id);
    try {
      if (siteAddressSelect.value === '__new__' && payload.site_address) {
        await api(`/api/clients/${payload.client_id}/addresses`, { method:'POST', body: JSON.stringify({client_id: payload.client_id, label: newAddressLabel.value || 'Site', address: payload.site_address, is_default: false}) });
        delete state.addressesByClient[payload.client_id];
      }
      if (editing) await api(`/api/projects/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)});
      else await api('/api/projects', {method:'POST', body: JSON.stringify(payload)});
      show(editing ? 'Project updated' : 'Project saved');
      await preloadLookups();
      if (returnProjectId) await renderProjectDetail(returnProjectId); else await renderProjects();
    } catch (err) { setInlineFormError(projectForm, err); }
  };
  setupModal('projectModal','openProjectModal','closeProjectModal','cancelProjectModal',editing,() => returnProjectId ? renderProjectDetail(returnProjectId) : renderProjects(),'select[name="client_id"]');
  projectSearch.addEventListener('input', () => {
    const query = projectSearch.value.trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll('.project-record-list .record-row').forEach(row => {
      const visible = !query || row.dataset.search.includes(query);
      row.classList.toggle('hidden', !visible);
      if (visible) shown += 1;
    });
    projectResultCount.textContent = `${shown} of ${sortedProjects.length} project${sortedProjects.length === 1 ? '' : 's'}`;
  });
  attachRowActions();
  attachProjectRowClicks();
}

function projectRelatedReceipts(projectId, receipts, quotes, invoices, ledger) {
  const quoteIds = new Set(quotes.map(item => Number(item.id)));
  const invoiceIds = new Set(invoices.map(item => Number(item.id)));
  const ledgerIds = new Set(ledger.map(item => Number(item.id)));
  return receipts.filter(receipt => {
    const linkedId = Number(receipt.linked_id);
    return (receipt.linked_type === 'project' && linkedId === Number(projectId))
      || (receipt.linked_type === 'quote' && quoteIds.has(linkedId))
      || (receipt.linked_type === 'invoice' && invoiceIds.has(linkedId))
      || (receipt.linked_type === 'ledger_entry' && ledgerIds.has(linkedId));
  });
}

async function renderProjectDetail(projectId, tab=state.projectDetailTab || 'overview') {
  state.page = 'projects';
  state.projectDetailId = projectId;
  state.clientDetailId = null;
  state.projectDetailTab = tab;
  state.editing = null;
  await preloadLookups();
  const project = state.projects.find(item => Number(item.id) === Number(projectId)) || await api(`/api/projects/${projectId}`);
  const client = state.clients.find(item => Number(item.id) === Number(project.client_id));
  const [quotesData, invoicesData, laborData, ledgerData, receiptsData] = await Promise.all([
    api(`/api/quotes?project_id=${projectId}&page_size=100`),
    api(`/api/invoices?project_id=${projectId}&page_size=100`),
    api(`/api/labor?project_id=${projectId}&page_size=100`),
    api(`/api/ledger?project_id=${projectId}&page_size=100`),
    api('/api/receipts?page_size=100'),
  ]);
  const quotes = quotesData.items || [];
  const invoices = invoicesData.items || [];
  const labor = laborData.items || [];
  const ledger = ledgerData.items || [];
  const receipts = projectRelatedReceipts(projectId, receiptsData.items || [], quotes, invoices, ledger);
  const outstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0);
  const uninvoicedLabor = labor.filter(entry => !entry.is_invoiced).reduce((sum, entry) => sum + Number(entry.line_total || 0), 0);
  const revenue = ledger.filter(entry => ['revenue','income'].includes(entry.kind)).reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);
  const expenses = ledger.filter(entry => ['expense','cogs'].includes(entry.kind) && !TAX_PAYMENT_CATEGORIES.has(entry.category || '')).reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);

  const quoteRows = quotes.map(quote => ({attrs:`role="button" tabindex="0" data-related-type="quote" data-related-id="${quote.id}"`, cells:[`<div class="record-primary"><strong>${escapeHtml(quote.quote_number)}</strong><span>${escapeHtml(quote.title)}</span></div>`,`<span class="status">${statusLabel(quote.status)}</span>`,shortDate(quote.quote_date),money(quote.total_amount),quoteRowActions(quote.id)]}));
  const invoiceRows = invoices.map(invoice => ({attrs:`role="button" tabindex="0" data-related-type="invoice" data-related-id="${invoice.id}"`, cells:[`<div class="record-primary"><strong>${escapeHtml(invoice.invoice_number)}</strong><span>${escapeHtml(invoice.title)}</span></div>`,`<span class="status">${statusLabel(invoice.status)}</span>`,shortDate(invoice.due_date),money(invoice.balance_due),rowActions('invoice', invoice.id)]}));
  const laborRows = labor.map(entry => ({attrs:`role="button" tabindex="0" data-related-type="labor" data-related-id="${entry.id}"`, cells:[shortDate(entry.work_date),`<div class="record-primary"><strong>${escapeHtml(entry.service_type)}</strong><span>${escapeHtml(entry.notes || 'No notes')}</span></div>`,`${escapeHtml(entry.hours)} hr`,money(entry.line_total),entry.is_invoiced ? '<span class="status">Invoiced</span>' : '<span class="status attention-status">Uninvoiced</span>',rowActions('labor', entry.id)]}));
  const ledgerRows = ledger.map(entry => ({attrs:`role="button" tabindex="0" data-related-type="ledger" data-related-id="${entry.id}"`, cells:[shortDate(entry.entry_date),`<div class="record-primary"><strong>${escapeHtml(ledgerKindLabel(entry.kind))}</strong><span>${escapeHtml(entry.category)}</span></div>`,money(entry.amount),entry.receipt_id ? receiptPreviewButton(entry.receipt_id) : '—',rowActions('ledger', entry.id)]}));
  const receiptRows = receipts.slice(0, 5).map(receipt => ({attrs:`role="button" tabindex="0" data-related-type="receipt" data-related-id="${receipt.id}"`, cells:[`<div class="record-primary"><strong>${escapeHtml(receipt.original_filename)}</strong><span>${escapeHtml(receipt.vendor_name || 'No vendor')}</span></div>`,shortDate(receipt.receipt_date),money(receipt.total_amount),receiptPreviewButton(receipt.id),rowActions('receipt', receipt.id)]}));
  const recent = [
    ...invoices.map(i => ({sort:i.invoice_date, type:'invoice', id:i.id, cells:['Invoice',`<strong>${escapeHtml(i.invoice_number)}</strong>`,statusLabel(i.status),money(i.balance_due)]})),
    ...quotes.map(q => ({sort:q.quote_date, type:'quote', id:q.id, cells:['Quote',`<strong>${escapeHtml(q.quote_number)}</strong>`,statusLabel(q.status),money(q.total_amount)]})),
    ...labor.map(l => ({sort:l.work_date, type:'labor', id:l.id, cells:['Labor',`<strong>${escapeHtml(l.service_type)}</strong>`,shortDate(l.work_date),money(l.line_total)]})),
  ].sort((a, b) => String(b.sort || '').localeCompare(String(a.sort || ''))).slice(0, 6).map(item => ({attrs:`role="button" tabindex="0" data-related-type="${item.type}" data-related-id="${item.id}"`, cells:item.cells}));

  document.querySelector('#pageTitle').textContent = project.name;
  document.querySelector('#pageSubtitle').textContent = 'Project hub for quotes, invoices, labor, expenses, and related documents.';
  updateActiveNavigation('projects');
  document.querySelector('#mobilePageTitle').textContent = project.name;

  const overviewHtml = `<div class="cards hub-summary-cards"><div class="card"><span>Quotes</span><strong>${quotes.length}</strong></div><div class="card"><span>Outstanding</span><strong>${money(outstanding)}</strong></div><div class="card"><span>Uninvoiced Labor</span><strong>${money(uninvoicedLabor)}</strong></div><div class="card"><span>Ledger Balance</span><strong>${money(revenue - expenses)}</strong></div></div>
    <section class="panel detail-info-panel"><div class="panel-heading"><h2>Project details</h2><span class="status">${statusLabel(project.status)}</span></div><div class="info-grid"><div><strong>Client</strong><span><button class="link-button" id="openProjectClient" type="button">${escapeHtml(client?.name || `Client #${project.client_id}`)}</button></span></div><div><strong>Start date</strong><span>${shortDate(project.start_date)}</span></div><div><strong>Completed date</strong><span>${shortDate(project.completed_date)}</span></div><div class="wide"><strong>Site address</strong><span>${escapeHtml(project.site_address || '—')}</span></div>${project.notes ? `<div class="wide"><strong>Notes</strong><span>${escapeHtml(project.notes)}</span></div>` : ''}</div></section>
    <section class="panel"><div class="panel-heading"><h2>Recent activity</h2></div>${adaptiveRecordList(['Type','Record','Status / Date','Amount'], recent, 'No activity for this project yet.', 'project-related-list')}</section>
    <section class="panel"><div class="panel-heading"><h2>Recent receipts</h2><span class="muted">${receipts.length} related</span></div>${adaptiveRecordList(['Receipt','Date','Total','File','Actions'], receiptRows, 'No receipts are related to this project yet.', 'project-related-list')}</section>`;
  const tabs = {
    overview: overviewHtml,
    quotes: `<section class="panel"><div class="panel-heading"><h2>Quotes</h2><span class="result-count">${quotes.length}</span></div>${adaptiveRecordList(['Quote','Status','Date','Total','Actions'], quoteRows, 'No quotes for this project yet.', 'project-related-list')}</section>`,
    invoices: `<section class="panel"><div class="panel-heading"><h2>Invoices</h2><strong>Outstanding ${money(outstanding)}</strong></div>${adaptiveRecordList(['Invoice','Status','Due','Balance','Actions'], invoiceRows, 'No invoices for this project yet.', 'project-related-list')}</section>`,
    labor: `<section class="panel"><div class="panel-heading"><h2>Labor</h2><strong>Uninvoiced ${money(uninvoicedLabor)}</strong></div>${adaptiveRecordList(['Date','Service','Hours','Value','Billing','Actions'], laborRows, 'No labor for this project yet.', 'project-related-list')}</section>`,
    ledger: `<section class="panel"><div class="panel-heading"><h2>Ledger</h2><strong>Balance ${money(revenue - expenses)}</strong></div>${adaptiveRecordList(['Date','Entry','Amount','Receipt','Actions'], ledgerRows, 'No ledger entries for this project yet.', 'project-related-list')}</section>`,
  };

  root.innerHTML = `<div class="detail-header hub-header"><button class="ghost" id="backToProjects" type="button">← Projects</button><div class="detail-title"><div class="hub-title-line"><h2>${escapeHtml(project.name)}</h2><span class="status">${statusLabel(project.status)}</span></div><p><button class="link-button hub-client-link" id="projectClientLink" type="button">${escapeHtml(client?.name || `Client #${project.client_id}`)}</button>${project.site_address ? ` · ${escapeHtml(project.site_address)}` : ''}</p><div class="hub-meta-line"><span>Start ${shortDate(project.start_date)}</span>${project.completed_date ? `<span>Completed ${shortDate(project.completed_date)}</span>` : ''}</div></div><div class="hub-header-actions"><button class="ghost packet-header-action" id="printProjectPacket" type="button">Print Project Packet</button><button class="ghost" id="editProjectDetail" type="button">Edit</button><button class="primary" id="addProjectDetail" type="button">+ Add</button></div></div>
    <div class="tabs hub-tabs detail-tab-grid project-detail-tabs" role="tablist" aria-label="Project sections">${detailTabButton('project', tab, 'overview','Overview')}${detailTabButton('project', tab, 'quotes',`Quotes (${quotes.length})`)}${detailTabButton('project', tab, 'invoices',`Invoices (${invoices.length})`)}${detailTabButton('project', tab, 'labor',`Labor (${labor.length})`)}${detailTabButton('project', tab, 'ledger',`Ledger (${ledger.length})`)}</div>${tabs[tab] || overviewHtml}`;

  backToProjects.onclick = () => loadPage('projects');
  projectClientLink.onclick = () => renderClientDetail(project.client_id);
  root.querySelector('#openProjectClient')?.addEventListener('click', () => renderClientDetail(project.client_id));
  root.querySelector('#printProjectPacket').onclick = () => openProjectPacketMenu(project);
  editProjectDetail.onclick = () => renderProjects(projectId, projectId);
  addProjectDetail.onclick = () => openScopedActionSheet({title:`Add to ${project.name}`, subtitle:'The client and project are already selected.', actions:[
    {label:'Add Labor', description:'Log work against this project.', run:() => openClientQuickModal(project.client_id, 'labor', null, {projectId, returnToProject:true})},
    {label:'Add Expense', description:'Add a project expense.', run:() => openClientQuickModal(project.client_id, 'ledger', null, {projectId, returnToProject:true, ledgerKind:'expense'})},
    {label:'New Quote', description:'Create a quote for this project.', run:() => openClientQuickModal(project.client_id, 'quotes', null, {projectId, returnToProject:true})},
    {label:'New Invoice', description:'Create an invoice for this project.', run:() => openClientQuickModal(project.client_id, 'invoices', null, {projectId, returnToProject:true})},
    {label:'Print Client Copy', description:'Print Quotes and Invoices for the Client.', run:() => printProjectClientPacket(projectId)},
    {label:'Print Admin Copy', description:'Print the complete internal Project record.', run:() => printProjectAdminPacket(projectId)},
  ]});
  root.querySelectorAll('[data-project-tab]').forEach(button => button.addEventListener('click', () => renderProjectDetail(projectId, button.dataset.projectTab)));
  attachRecordOpen('.project-related-list [data-related-type][data-related-id]', row => {
    const typeMap = {quote:'quotes', invoice:'invoices', labor:'labor', ledger:'ledger', receipt:'receipts'};
    return openClientQuickModal(project.client_id, typeMap[row.dataset.relatedType], Number(row.dataset.relatedId), {projectId, returnToProject:true});
  });
  attachRowActions();
  attachQuoteInvoiceActions();
}

async function renderQuotes(editId=null) {
  setQuoteEditorPageState(false);
  const data = await api('/api/quotes?page_size=100');
  const settingsResponse = await api('/api/admin/settings');
  const settings = settingsResponse.settings || {};
  state.quotes = data.items;
  const editing = editId ? data.items.find(q => q.id === editId) : null;
  const existingItems = editing ? (await api(`/api/quotes/${editing.id}/line-items`)).items : [];
  const generatedQuoteNumber = editing?.quote_number || await nextQuoteNumber();
  const quoteNumberAttrs = editing ? '' : ' readonly aria-readonly="true" title="Generated automatically to prevent duplicate quote numbers"';
  const quoteStatusFilterValue = state.quoteStatusFilter || 'all';
  const quoteClientFilterValue = state.quoteClientFilter || 'all';
  const visibleQuotes = data.items.filter(q => {
    const matchesStatus = quoteStatusFilterValue === 'all' || String(q.status || '') === quoteStatusFilterValue;
    const matchesClient = quoteClientFilterValue === 'all' || String(q.client_id || '') === String(quoteClientFilterValue);
    return matchesStatus && matchesClient;
  });
  const quoteClientOptions = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const quoteRows = visibleQuotes.map(q => [escapeHtml(q.quote_number),escapeHtml(q.title),escapeHtml(clientName(q.client_id)),escapeHtml(projectName(q.project_id)),`<span class="status">${statusLabel(q.status)}</span>`,q.quote_date,q.valid_until,money(q.total_amount),quoteRowActions(q.id)]);
  const quoteRowAttrs = visibleQuotes.map(q => `class="quote-record-row" role="button" tabindex="0" data-quote-id="${Number(q.id)}"`);
  const activeFilterCount = Number(quoteStatusFilterValue !== 'all') + Number(quoteClientFilterValue !== 'all');
  const listHtml = data.items.length === 0
    ? quoteListEmptyHtml()
    : visibleQuotes.length === 0
      ? quoteListEmptyHtml({filtered:true})
      : `<div class="quote-desktop-list">${table(['Quote #','Title','Client','Project','Status','Date','Valid Until','Total','Actions'], quoteRows, 'quotes-table', quoteRowAttrs)}</div><div class="quote-mobile-list" aria-label="Quotes">${visibleQuotes.map(quoteCardHtml).join('')}</div>${quoteListEmptyHtml({search:true})}`;
  root.innerHTML = `<div class="quote-list-controls panel"><div class="quote-list-primary"><label class="search-field compact-search">Search Quotes<input id="quoteSearch" type="search" placeholder="Quote number, title, client, or project"></label><button class="primary" id="openQuoteModal" type="button">Add Quote</button></div><div class="quote-filter-row"><label class="filter-field">Status<select id="quoteStatusFilter"><option value="all">All Statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="expired">Expired</option></select></label><label class="filter-field">Client<select id="quoteClientFilter"><option value="all">All Clients</option>${quoteClientOptions}</select></label><button class="ghost" id="resetQuoteFilters" type="button">Reset Filters</button><span class="quote-filter-indicator ${activeFilterCount ? '' : 'hidden'}">${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}</span><span class="quote-result-count" id="quoteResultCount">${visibleQuotes.length} quote${visibleQuotes.length === 1 ? '' : 's'}</span></div></div>
    <div class="quote-list-results">${listHtml}</div>
    <div id="quoteModal" class="modal-backdrop quote-editor-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="quoteFormTitle">${quoteEditorFormHtml({editing, generatedQuoteNumber, quoteNumberAttrs, settings, existingItems, termsTemplates:state.termsTemplates, formId:'quoteForm', clientSelectId:'quoteClient', projectSelectId:'quoteProject', closeButtonId:'closeQuoteModal', cancelButtonId:'cancelQuoteModal'})}</div>`;
  const statusFilter = root.querySelector('#quoteStatusFilter');
  const clientFilter = root.querySelector('#quoteClientFilter');
  const searchInput = root.querySelector('#quoteSearch');
  const form = root.querySelector('#quoteForm');
  const clientSelect = root.querySelector('#quoteClient');
  const projectSelect = root.querySelector('#quoteProject');
  statusFilter.value = state.quoteStatusFilter || 'all';
  clientFilter.value = state.quoteClientFilter || 'all';
  statusFilter.onchange = () => { state.quoteStatusFilter = statusFilter.value; renderQuotes(); };
  clientFilter.onchange = () => { state.quoteClientFilter = clientFilter.value; renderQuotes(); };
  const resetFilters = () => { state.quoteStatusFilter = 'all'; state.quoteClientFilter = 'all'; if (searchInput) searchInput.value = ''; renderQuotes(); };
  root.querySelector('#resetQuoteFilters').onclick = resetFilters;
  root.querySelectorAll('[data-reset-quote-filters]').forEach(button => { button.onclick = resetFilters; });
  root.querySelector('#emptyAddQuote')?.addEventListener('click', () => root.querySelector('#openQuoteModal')?.click());
  form.status.value = editing?.status || 'draft';
  if (clientSelect) clientSelect.onchange = () => { projectSelect.innerHTML = projectOptions('', clientSelect.value); };
  wireQuoteLineEditor(root);
  wireTermsTemplateApply(root, 'quoteForm', state.termsTemplates);
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      const result = await persistQuoteEditor(form, root, editing);
      if (!result) return;
      show(editing ? 'Quote updated' : 'Quote saved'); await preloadLookups(); await renderQuotes();
    } catch (err) { await showForgeOpsError(err); }
  };
  setupQuoteModal({editing, rerender:renderQuotes});
  attachQuoteSearch(visibleQuotes.length);
  attachRowActions();
  attachQuoteInvoiceActions();
  attachQuoteRowClicks();
}

async function renderInvoices(editId=null, handoff={}) {
  setInvoiceEditorPageState(false);
  const data = await api('/api/invoices?page_size=100');
  state.invoices = data.items;
  const settingsResponse = await api('/api/admin/settings');
  const settings = settingsResponse.settings || {};
  const editing = editId ? data.items.find(i => i.id === editId) : null;
  const generatedInvoiceNumber = editing?.invoice_number || await nextInvoiceNumber();
  const invoiceNumberAttrs = editing ? '' : ' readonly aria-readonly="true" title="Generated automatically to prevent duplicate invoice numbers"';
  const invoiceStatusFilterValue = state.invoiceStatusFilter || 'all';
  const invoiceClientFilterValue = state.invoiceClientFilter || 'all';
  const visibleInvoices = data.items.filter(invoice => {
    const matchesStatus = invoiceStatusFilterValue === 'all' || String(invoice.status || '') === invoiceStatusFilterValue;
    const matchesClient = invoiceClientFilterValue === 'all' || String(invoice.client_id || '') === String(invoiceClientFilterValue);
    return matchesStatus && matchesClient;
  });
  const invoiceClientOptions = state.clients.map(client => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join('');
  const invoiceRows = visibleInvoices.map(invoice => {
    const project = projectName(invoice.project_id);
    const relatedQuote = quoteName(invoice.quote_id);
    return [
      `<div class="invoice-list-primary"><strong>${escapeHtml(invoice.invoice_number)}</strong><span>${escapeHtml(invoice.title)}</span>${relatedQuote ? `<small>Related: ${escapeHtml(relatedQuote)}</small>` : ''}</div>`,
      `<div class="invoice-list-context"><strong>${escapeHtml(clientName(invoice.client_id))}</strong><span>${escapeHtml(project || 'No project')}</span></div>`,
      `<span class="status">${statusLabel(invoice.status)}</span>`,
      shortDate(invoice.invoice_date),
      invoice.due_date ? shortDate(invoice.due_date) : '—',
      money(invoice.total_amount),
      `<strong class="invoice-balance-value">${money(invoice.balance_due)}</strong>`,
      rowActions('invoice', invoice.id),
    ];
  });
  const invoiceRowAttrs = visibleInvoices.map(invoice => `class="invoice-record-row" role="button" tabindex="0" data-invoice-id="${Number(invoice.id)}"`);
  const activeFilterCount = Number(invoiceStatusFilterValue !== 'all') + Number(invoiceClientFilterValue !== 'all');
  const listHtml = data.items.length === 0
    ? invoiceListEmptyHtml()
    : visibleInvoices.length === 0
      ? invoiceListEmptyHtml({filtered:true})
      : `<div class="invoice-desktop-list">${table(['Invoice','Client / Project','Status','Issued','Due','Total','Balance','Actions'], invoiceRows, 'invoices-table', invoiceRowAttrs)}</div><div class="invoice-mobile-list" aria-label="Invoices">${visibleInvoices.map(invoiceCardHtml).join('')}</div>${invoiceListEmptyHtml({search:true})}`;
  root.innerHTML = `<div class="invoice-list-controls panel"><div class="invoice-list-primary-controls"><label class="search-field compact-search">Search Invoices<input id="invoiceSearch" type="search" placeholder="Invoice number, title, client, project, or status"></label><button class="primary" id="openInvoiceModal" type="button">Add Invoice</button></div><div class="invoice-filter-row"><label class="filter-field">Status<select id="invoiceStatusFilter"><option value="all">All Statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="partially_paid">Partially Paid</option><option value="paid">Paid</option><option value="void">Void</option><option value="overdue">Overdue</option></select></label><label class="filter-field">Client<select id="invoiceClientFilter"><option value="all">All Clients</option>${invoiceClientOptions}</select></label><button class="ghost" id="resetInvoiceFilters" type="button">Reset Filters</button><span class="invoice-filter-indicator ${activeFilterCount ? '' : 'hidden'}">${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}</span><span class="invoice-result-count" id="invoiceResultCount">${visibleInvoices.length} invoice${visibleInvoices.length === 1 ? '' : 's'}</span></div></div>
    <div class="invoice-list-results">${listHtml}</div>
    <div id="invoiceModal" class="modal-backdrop invoice-editor-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="invoiceFormTitle">${invoiceEditorShellHtml({editing, generatedInvoiceNumber, invoiceNumberAttrs, presetClientId: handoff.clientId || '', scopedProjectId: handoff.projectId || '', scopedQuoteId: handoff.quoteId || '', settings, termsTemplates:state.termsTemplates, formId:'invoiceForm', clientSelectId:'invoiceClient', projectSelectId:'invoiceProject', quoteSelectId:'invoiceQuote', closeButtonId:'closeInvoiceModal'})}</div>`;
  const statusFilter = root.querySelector('#invoiceStatusFilter');
  const clientFilter = root.querySelector('#invoiceClientFilter');
  const searchInput = root.querySelector('#invoiceSearch');
  statusFilter.value = state.invoiceStatusFilter || 'all';
  clientFilter.value = state.invoiceClientFilter || 'all';
  statusFilter.onchange = () => { state.invoiceStatusFilter = statusFilter.value; renderInvoices(); };
  clientFilter.onchange = () => { state.invoiceClientFilter = clientFilter.value; renderInvoices(); };
  const resetFilters = () => { state.invoiceStatusFilter = 'all'; state.invoiceClientFilter = 'all'; if (searchInput) searchInput.value = ''; renderInvoices(); };
  root.querySelector('#resetInvoiceFilters').onclick = resetFilters;
  root.querySelectorAll('[data-reset-invoice-filters]').forEach(button => { button.onclick = resetFilters; });
  root.querySelector('#emptyAddInvoice')?.addEventListener('click', () => root.querySelector('#openInvoiceModal')?.click());
  await wireInvoiceInternalForm(root, {formId:'invoiceForm', clientSelectId:'invoiceClient', projectSelectId:'invoiceProject', quoteSelectId:'invoiceQuote', editing, onSave: async payload => { try { if (editing) await api(`/api/invoices/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/invoices', {method:'POST', body: JSON.stringify(payload)}); show(editing ? 'Invoice updated' : 'Invoice saved'); await preloadLookups(); await renderInvoices(); } catch (err) { await showForgeOpsError(err); } }});
  setupInvoiceModal({editing, autoOpen:Boolean(handoff.autoOpen), rerender:renderInvoices});
  attachInvoiceSearch(visibleInvoices.length);
  attachRowActions();
  attachInvoiceRowClicks();
}

function ledgerKindChip(kind) {
  const normalized = normalizeLedgerKind(kind);
  return `<span class="ledger-chip ledger-kind-${normalized}">${escapeHtml(ledgerKindLabel(normalized))}</span>`;
}

function ledgerLinkedRecord(entry) {
  return [quoteName(entry.quote_id), invoiceName(entry.invoice_id)].filter(Boolean).join(' / ');
}

function ledgerLinkedRecordHtml(entry) {
  const quote = quoteName(entry.quote_id);
  const invoice = invoiceName(entry.invoice_id);
  const fullReference = [quote, invoice].filter(Boolean).join(' / ');
  if (!fullReference) return '<span class="ledger-empty-link">No linked record</span>';
  const linkedRow = (label, value) => value
    ? `<span class="ledger-linked-record"><b>${label}</b><span>${escapeHtml(value)}</span></span>`
    : '';
  return `<span class="ledger-linked-record-cell" title="${escapeHtml(fullReference)}">${linkedRow('Quote', quote)}${linkedRow('Invoice', invoice)}</span>`;
}

function ledgerSalesTaxPeriodHtml(entry) {
  if (entry.category !== SALES_TAX_PERIOD_CATEGORY) return '';
  if (!entry.sales_tax_period) return '<span class="ledger-tax-period ledger-tax-period-unassigned">Tax period unassigned</span>';
  return `<span class="ledger-tax-period">Applies to ${escapeHtml(salesTaxPeriodLabel(entry.sales_tax_period))}</span>`;
}

function ledgerSearchValue(entry) {
  const taxPeriod = entry.category === SALES_TAX_PERIOD_CATEGORY ? (entry.sales_tax_period ? `applies to ${salesTaxPeriodLabel(entry.sales_tax_period)}` : 'tax period unassigned') : '';
  return [entry.entry_date, ledgerKindLabel(entry.kind), entry.category, taxPeriod, entry.description, entry.business_type, clientName(entry.client_id), projectName(entry.project_id), quoteName(entry.quote_id), invoiceName(entry.invoice_id), entry.receipt_id ? 'receipt attached' : 'no receipt'].filter(Boolean).join(' ').toLowerCase();
}

function ledgerRecordAttributes(entry, extraClass='') {
  return `class="${extraClass}" data-ledger-record data-ledger-id="${Number(entry.id)}" data-ledger-kind="${escapeHtml(normalizeLedgerKind(entry.kind))}" data-ledger-category="${escapeHtml(entry.category || '')}" data-ledger-client="${entry.client_id ? Number(entry.client_id) : ''}" data-ledger-year="${escapeHtml(String(entry.entry_date || '').slice(0, 4))}" data-ledger-search="${escapeHtml(ledgerSearchValue(entry))}"`;
}

function ledgerCardHtml(entry) {
  const project = projectName(entry.project_id);
  const linked = ledgerLinkedRecord(entry);
  const context = entry.business_type === 'admin' ? 'Administrative entry' : (clientName(entry.client_id) || 'No client');
  const receiptState = entry.receipt_id ? 'Receipt attached' : 'No receipt attached';
  return `<article ${ledgerRecordAttributes(entry, 'ledger-record-card')}>
    <button class="ledger-card-open" type="button" data-ledger-id="${Number(entry.id)}" aria-label="Open ${escapeHtml(ledgerKindLabel(entry.kind))} ledger entry for ${escapeHtml(entry.category)}">
      <span class="ledger-card-top"><strong>${shortDate(entry.entry_date)}</strong>${ledgerKindChip(entry.kind)}</span>
      <span class="ledger-card-category"><strong>${escapeHtml(entry.category)}</strong>${ledgerSalesTaxPeriodHtml(entry)}${entry.description ? `<span>${escapeHtml(entry.description)}</span>` : '<span>No description</span>'}</span>
      <span class="ledger-card-amount ledger-amount-${escapeHtml(normalizeLedgerKind(entry.kind))}">${money(entry.amount)}</span>
      <span class="ledger-card-context"><b>${escapeHtml(context)}</b>${project ? `<span>${escapeHtml(project)}</span>` : ''}${linked ? `<span>${escapeHtml(linked)}</span>` : ''}<small>${receiptState}</small></span>
    </button>
    <div class="ledger-card-actions">${entry.receipt_id ? `<div class="ledger-card-document">${receiptPreviewButton(entry.receipt_id, 'Preview Receipt')}</div>` : ''}${rowActions('ledger', entry.id)}</div>
  </article>`;
}

function ledgerListEmptyHtml({filtered=false}={}) {
  if (filtered) return `<section class="panel ledger-list-empty hidden" id="ledgerFilterEmpty"><strong>No Ledger entries match these filters.</strong><span>Try another search or reset the filters.</span><button class="ghost" type="button" data-reset-ledger-filters>Reset Filters</button></section>`;
  return `<section class="panel ledger-list-empty"><strong>No Ledger entries yet.</strong><span>Add income, cost of goods sold, or an expense to start the bookkeeping record.</span><button class="primary" id="emptyAddLedger" type="button">Add Ledger Entry</button></section>`;
}

function ledgerEditorShellHtml({editing=null, formId='ledgerForm', scopedClientId='', scopedProjectId='', clientLabel='', presetKind='', closeButtonId='', cancelButtonId=''}) {
  const isEdit = Boolean(editing);
  const clientId = editing?.client_id || scopedClientId || '';
  const projectId = editing?.project_id || scopedProjectId || '';
  const kind = normalizeLedgerKind(presetKind || editing?.kind || 'income');
  const businessType = editing?.business_type || 'client';
  const taxPeriod = parseSalesTaxPeriod(editing?.sales_tax_period);
  const taxYear = taxPeriod.year || salesTaxYearFromDate(editing?.entry_date || todayIso());
  const taxPeriodHelp = editing?.category === SALES_TAX_PERIOD_CATEGORY && !editing?.sales_tax_period
    ? 'Tax Period: Unassigned. Select the quarter this payment covered before saving.'
    : 'The transaction date stays unchanged; these controls determine which NY sales-tax reserve is reduced.';
  const closeId = closeButtonId ? ` id="${closeButtonId}"` : '';
  const cancelId = cancelButtonId ? ` id="${cancelButtonId}"` : '';
  const clientField = scopedClientId
    ? `<input type="hidden" name="client_id" value="${Number(scopedClientId)}"><label class="ledger-field" data-ledger-client-wrap><span>Client</span><input value="${clientLabel}" disabled aria-label="Client"></label>`
    : `<label class="ledger-field" data-ledger-client-wrap><span>Client</span><select name="client_id" id="${formId}Client">${clientOptions(clientId)}</select></label>`;
  return `<div class="modal-card wide-modal ledger-editor-shell"><header class="modal-header ledger-editor-header"><div><p class="ledger-editor-eyebrow">Bookkeeping workflow</p><h2 id="${formId}Title">${isEdit ? 'Edit Ledger Entry' : 'Add Ledger Entry'}</h2><p>${isEdit ? 'Review the entry details, business context, and documentation.' : 'Record income, cost of goods sold, or an expense.'}</p></div><button class="ghost modal-close"${closeId} type="button" aria-label="Close ledger form">×</button></header>
    <form id="${formId}" class="ledger-editor-form" enctype="multipart/form-data">
      <div class="ledger-editor-scroll">
        <section class="ledger-editor-section" aria-labelledby="${formId}DetailsHeading"><div class="ledger-editor-section-head"><span>1</span><div><h3 id="${formId}DetailsHeading">Entry Details</h3><p>Record the date, account type, category, amount, and purpose.</p></div><span class="ledger-kind-preview">${ledgerKindChip(kind)}</span></div><div class="ledger-editor-grid ledger-details-grid">
          <label class="ledger-field"><span>Date</span><input name="entry_date" type="date" required value="${escapeHtml(editing?.entry_date || todayIso())}"></label>
          <label class="ledger-field"><span>Account Type</span><select name="kind"><option value="income">Income</option><option value="cogs">Cost of Goods Sold</option><option value="expense">Expenses</option></select></label>
          <label class="ledger-field"><span>Category</span><select name="category" required><option value="">Select category...</option></select></label>
          <label class="ledger-field"><span>Amount</span><input name="amount" type="number" step="0.01" min="0" inputmode="decimal" required value="${escapeHtml(editing?.amount ?? '')}"></label>
          <div class="ledger-sales-tax-period-fields hidden" data-ledger-sales-tax-period-wrap>
            <label class="ledger-field ledger-sales-tax-quarter-field"><span>NY Sales Tax Quarter</span><select name="sales_tax_quarter" disabled><option value="">Select quarter...</option>${salesTaxQuarterOptions(taxPeriod.quarter)}</select></label>
            <label class="ledger-field ledger-sales-tax-year-field"><span>Tax Year</span><input name="sales_tax_year" type="number" min="2000" max="2100" step="1" inputmode="numeric" disabled value="${escapeHtml(taxYear)}"></label>
            <input name="sales_tax_period" type="hidden" value="${escapeHtml(editing?.sales_tax_period || '')}">
            <small class="ledger-sales-tax-period-help">${escapeHtml(taxPeriodHelp)}</small>
          </div>
          <label class="ledger-field ledger-description-field"><span>Description</span><textarea name="description" rows="4" placeholder="What was this transaction for?">${escapeHtml(editing?.description)}</textarea></label>
        </div></section>
        <section class="ledger-editor-section" aria-labelledby="${formId}ContextHeading"><div class="ledger-editor-section-head"><span>2</span><div><h3 id="${formId}ContextHeading">Business Context</h3><p>Classify administrative activity or connect client work to its records.</p></div></div><div class="ledger-editor-grid ledger-context-grid">
          <label class="ledger-field"><span>Business Type</span><select name="business_type"><option value="client">Client</option><option value="admin">Admin</option></select></label>
          ${clientField}
          <label class="ledger-field" data-ledger-project-wrap><span>Project</span><select name="project_id" id="${formId}Project">${projectOptions(projectId, clientId)}</select></label>
          <label class="ledger-field" data-ledger-quote-wrap><span>Quote</span><select name="quote_id">${quoteOptions(editing?.quote_id, clientId, projectId)}</select></label>
          <label class="ledger-field" data-ledger-invoice-wrap><span>Invoice</span><select name="invoice_id">${invoiceOptions(editing?.invoice_id, clientId, projectId)}</select></label>
          <div class="ledger-context-summary" aria-live="polite"><small>Current context</small><strong data-ledger-context-title>${businessType === 'admin' ? 'Administrative entry' : (clientName(clientId) || clientLabel || 'Client entry')}</strong><span data-ledger-context-detail>${projectName(projectId) || 'No linked Project, Quote, or Invoice'}</span></div>
        </div></section>
        <section class="ledger-editor-section" aria-labelledby="${formId}ReceiptHeading"><div class="ledger-editor-section-head"><span>3</span><div><h3 id="${formId}ReceiptHeading">Receipt / Documentation</h3><p>Attach a receipt image or PDF, or review the existing document.</p></div></div><div class="ledger-receipt-panel">
          <label class="ledger-file-field"><span>Receipt Photo or PDF</span><input name="receipt_file" type="file" accept="image/*,application/pdf"><small data-ledger-file-name>${isEdit ? 'Choose a new file to attach to this entry.' : 'No file selected.'}</small></label>
          ${editing?.receipt_id ? `<div class="ledger-attached-receipt"><span><strong>Receipt attached</strong><small>Available for preview and the Ledger Entry Packet.</small></span>${receiptPreviewButton(editing.receipt_id, 'Preview Receipt')}</div>` : '<div class="ledger-no-receipt"><strong>No receipt attached</strong><span>You can save this entry without a document.</span></div>'}
        </div></section>
      </div>
      <footer class="ledger-editor-actions"><button class="ghost ${cancelButtonId ? '' : 'quick-cancel'}" type="button"${cancelId}>Cancel</button>${isEdit ? `<button class="ghost" type="button" data-action="print" data-type="ledger" data-id="${Number(editing.id)}">Print Packet</button>` : ''}<button class="primary" type="submit">${isEdit ? 'Update Ledger Entry' : 'Save Ledger Entry'}</button></footer>
    </form></div>`;
}

function wireLedgerEditor(container, {formId='ledgerForm', editing=null, clientId='', presetKind='', onSave}) {
  const form = container.querySelector(`#${formId}`);
  if (!form) return;
  form.elements.kind.value = normalizeLedgerKind(presetKind || editing?.kind || 'income');
  form.elements.business_type.value = editing?.business_type || 'client';
  configureLedgerForm(form, {selectedCategory: editing?.category || '', clientId});
  const kindPreview = container.querySelector('.ledger-kind-preview');
  const contextTitle = container.querySelector('[data-ledger-context-title]');
  const contextDetail = container.querySelector('[data-ledger-context-detail]');
  const fileName = container.querySelector('[data-ledger-file-name]');
  const fileInput = form.elements.receipt_file;
  const updateKindPreview = () => { if (kindPreview) kindPreview.innerHTML = ledgerKindChip(form.elements.kind.value); };
  const updateContext = () => {
    const isAdmin = form.elements.business_type.value === 'admin';
    const scopedClient = state.clients.find(item => Number(item.id) === Number(clientId));
    const clientText = clientId ? (scopedClient?.name || `Client #${clientId}`) : (form.elements.client_id?.value ? form.elements.client_id.selectedOptions?.[0]?.textContent?.trim() : '');
    const projectText = form.elements.project_id?.value ? form.elements.project_id.selectedOptions?.[0]?.textContent?.trim() : '';
    const quoteText = form.elements.quote_id?.value ? form.elements.quote_id.selectedOptions?.[0]?.textContent?.trim() : '';
    const invoiceText = form.elements.invoice_id?.value ? form.elements.invoice_id.selectedOptions?.[0]?.textContent?.trim() : '';
    if (contextTitle) contextTitle.textContent = isAdmin ? 'Administrative entry' : (clientText || 'Client entry');
    if (contextDetail) contextDetail.textContent = isAdmin ? 'No Client, Project, Quote, or Invoice links' : ([projectText, quoteText, invoiceText].filter(Boolean).join(' / ') || 'No linked Project, Quote, or Invoice');
  };
  form.elements.kind.addEventListener('change', updateKindPreview);
  [form.elements.business_type, form.elements.client_id, form.elements.project_id, form.elements.quote_id, form.elements.invoice_id].forEach(control => control?.addEventListener('change', updateContext));
  fileInput?.addEventListener('change', () => { if (fileName) fileName.textContent = fileInput.files?.[0]?.name || 'No file selected.'; });
  updateKindPreview();
  updateContext();
  form.onsubmit = async event => {
    event.preventDefault();
    const payload = normalizeLedgerPayload(clean(formData(form)));
    delete payload.receipt_file;
    if (clientId && payload.business_type === 'client') payload.client_id = Number(clientId);
    await onSave(payload, form);
  };
}

function attachLedgerListControls(totalCount) {
  const search = root.querySelector('#ledgerSearch');
  const kind = root.querySelector('#ledgerKindFilter');
  const category = root.querySelector('#ledgerCategoryFilter');
  const client = root.querySelector('#ledgerClientFilter');
  const year = root.querySelector('#ledgerYearFilter');
  const tableRows = [...root.querySelectorAll('.ledger-table [data-ledger-record]')];
  const cards = [...root.querySelectorAll('.ledger-mobile-list [data-ledger-record]')];
  const empty = root.querySelector('#ledgerFilterEmpty');
  const resultCount = root.querySelector('#ledgerResultCount');
  const indicator = root.querySelector('#ledgerFilterIndicator');
  const desktopList = root.querySelector('.ledger-desktop-list');
  const mobileList = root.querySelector('.ledger-mobile-list');
  const matches = record => {
    const query = search.value.trim().toLowerCase();
    return (!query || record.dataset.ledgerSearch.includes(query))
      && (kind.value === 'all' || record.dataset.ledgerKind === kind.value)
      && (category.value === 'all' || record.dataset.ledgerCategory === category.value)
      && (client.value === 'all' || record.dataset.ledgerClient === client.value)
      && (year.value === 'all' || record.dataset.ledgerYear === year.value);
  };
  const apply = () => {
    state.ledgerKindFilter = kind.value;
    state.ledgerCategoryFilter = category.value;
    state.ledgerClientFilter = client.value;
    state.ledgerYearFilter = year.value;
    let shown = 0;
    cards.forEach(card => { const visible = matches(card); card.classList.toggle('hidden', !visible); if (visible) shown += 1; });
    tableRows.forEach(row => row.classList.toggle('hidden', !matches(row)));
    const controls = [kind, category, client, year];
    const hasQueryOrFilter = Boolean(search.value.trim()) || controls.some(control => control.value !== 'all');
    empty?.classList.toggle('hidden', shown > 0 || !hasQueryOrFilter);
    desktopList?.classList.toggle('ledger-no-matches', shown === 0 && hasQueryOrFilter);
    mobileList?.classList.toggle('ledger-no-matches', shown === 0 && hasQueryOrFilter);
    if (resultCount) resultCount.textContent = hasQueryOrFilter ? `${shown} of ${totalCount} ledger entr${totalCount === 1 ? 'y' : 'ies'}` : `${totalCount} ledger entr${totalCount === 1 ? 'y' : 'ies'}`;
    const activeFilters = controls.filter(control => control.value !== 'all').length;
    if (indicator) {
      indicator.textContent = `${activeFilters} active filter${activeFilters === 1 ? '' : 's'}`;
      indicator.classList.toggle('hidden', activeFilters === 0);
    }
  };
  [search, kind, category, client, year].forEach(control => control?.addEventListener(control === search ? 'input' : 'change', apply));
  root.querySelectorAll('[data-reset-ledger-filters]').forEach(button => button.addEventListener('click', () => {
    search.value = '';
    kind.value = 'all'; category.value = 'all'; client.value = 'all'; year.value = 'all';
    apply();
    search.focus();
  }));
  apply();
}

async function renderLedger(editId=null) {
  setLedgerEditorPageState(false);
  const data = await api('/api/ledger?page_size=100');
  const editing = editId ? data.items.find(item => Number(item.id) === Number(editId)) : null;
  const categories = [...new Set(data.items.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const years = [...new Set(data.items.map(item => String(item.entry_date || '').slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const clientFilterOptions = state.clients.map(item => `<option value="${Number(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  const categoryFilterOptions = categories.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  const yearFilterOptions = years.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  const ledgerRows = data.items.map(entry => {
    const project = projectName(entry.project_id);
    const client = entry.business_type === 'admin' ? 'Administrative' : (clientName(entry.client_id) || 'No client');
    return [shortDate(entry.entry_date), ledgerKindChip(entry.kind), `<div class="ledger-category-cell"><strong>${escapeHtml(entry.category)}</strong>${ledgerSalesTaxPeriodHtml(entry)}${entry.description ? `<span>${escapeHtml(entry.description)}</span>` : '<span>No description</span>'}</div>`, `<div class="ledger-context-cell"><strong>${escapeHtml(client)}</strong>${project ? `<span>${escapeHtml(project)}</span>` : ''}</div>`, ledgerLinkedRecordHtml(entry), `<strong class="ledger-amount ledger-amount-${escapeHtml(normalizeLedgerKind(entry.kind))}">${money(entry.amount)}</strong>`, entry.receipt_id ? receiptPreviewButton(entry.receipt_id, 'Preview') : '<span class="ledger-empty-link">None</span>', rowActions('ledger', entry.id)];
  });
  const rowAttributes = data.items.map(entry => `${ledgerRecordAttributes(entry, 'ledger-record-row')} role="button" tabindex="0"`);
  const listHtml = data.items.length
    ? `<div class="ledger-desktop-list">${table(['Date','Account Type','Category / Description','Client / Project','Linked Record','Amount','Receipt','Actions'], ledgerRows, 'ledger-table', rowAttributes)}</div><div class="ledger-mobile-list" aria-label="Ledger entries">${data.items.map(ledgerCardHtml).join('')}</div>${ledgerListEmptyHtml({filtered:true})}`
    : ledgerListEmptyHtml();
  root.innerHTML = `<section class="ledger-list-controls panel"><div class="ledger-list-primary"><label class="search-field compact-search">Search Ledger<input id="ledgerSearch" type="search" placeholder="Description, category, Client, Project, Quote, or Invoice"></label><button class="primary" id="openLedgerModal" type="button">Add Ledger Entry</button></div><div class="ledger-filter-row"><label class="filter-field">Account Type<select id="ledgerKindFilter"><option value="all">All Account Types</option><option value="income">Income</option><option value="cogs">Cost of Goods Sold</option><option value="expense">Expenses</option></select></label><label class="filter-field">Category<select id="ledgerCategoryFilter"><option value="all">All Categories</option>${categoryFilterOptions}</select></label><label class="filter-field">Client<select id="ledgerClientFilter"><option value="all">All Clients</option>${clientFilterOptions}</select></label><label class="filter-field">Year<select id="ledgerYearFilter"><option value="all">All Years</option>${yearFilterOptions}</select></label><button class="ghost" type="button" data-reset-ledger-filters>Reset Filters</button><span class="ledger-filter-indicator hidden" id="ledgerFilterIndicator"></span><span class="ledger-result-count" id="ledgerResultCount">${data.items.length} ledger entr${data.items.length === 1 ? 'y' : 'ies'}</span></div></section>
    ${listHtml}
    <div id="ledgerModal" class="modal-backdrop ledger-editor-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="ledgerFormTitle">${ledgerEditorShellHtml({editing, closeButtonId:'closeLedgerModal', cancelButtonId:'cancelLedgerModal'})}</div>`;
  [
    ['#ledgerKindFilter', state.ledgerKindFilter],
    ['#ledgerCategoryFilter', state.ledgerCategoryFilter],
    ['#ledgerClientFilter', state.ledgerClientFilter],
    ['#ledgerYearFilter', state.ledgerYearFilter],
  ].forEach(([selector, value]) => {
    const control = root.querySelector(selector);
    if (!control) return;
    control.value = value;
    if (!control.value) control.value = 'all';
  });
  wireLedgerEditor(root, {editing, onSave: async (payload, form) => {
    try {
      await saveLedgerEntryWithReceipt(form, payload, editing);
      show(editing ? 'Ledger entry updated' : 'Ledger entry saved');
      await root.querySelector('#ledgerModal')._closeLedgerEditor();
    } catch (err) { await showForgeOpsError(err); }
  }});
  setupLedgerModal({editing, rerender: renderLedger});
  root.querySelector('#emptyAddLedger')?.addEventListener('click', () => root.querySelector('#openLedgerModal')?.click());
  if (data.items.length) attachLedgerListControls(data.items.length);
  attachRowActions();
  attachLedgerRowClicks();
}

function laborStatusChip(status) {
  const normalized = ['planned', 'completed', 'invoiced', 'paid', 'canceled'].includes(status) ? status : 'planned';
  return `<span class="labor-chip labor-status-${normalized}">${statusLabel(status)}</span>`;
}

function laborBillingChip(entry) {
  return entry.is_invoiced
    ? '<span class="labor-chip labor-billing-invoiced">Invoiced</span>'
    : '<span class="labor-chip labor-billing-available">Available / Uninvoiced</span>';
}

function laborInvoiceContext(entry) {
  return invoiceName(entry.invoice_id) || entry.invoice_number || '';
}

function laborSearchValue(entry) {
  return [entry.work_date, clientName(entry.client_id), projectName(entry.project_id), entry.service_type, entry.notes, statusLabel(entry.status), laborInvoiceContext(entry), entry.is_invoiced ? 'invoiced billed' : 'available uninvoiced'].filter(Boolean).join(' ').toLowerCase();
}

function laborRecordAttributes(entry, extraClass='') {
  return `class="${extraClass}" data-labor-record data-labor-id="${Number(entry.id)}" data-labor-client="${Number(entry.client_id)}" data-labor-project="${entry.project_id ? Number(entry.project_id) : ''}" data-labor-status="${escapeHtml(entry.status)}" data-labor-invoiced="${entry.is_invoiced ? 'true' : 'false'}" data-labor-search="${escapeHtml(laborSearchValue(entry))}"`;
}

function laborCardHtml(entry) {
  const project = projectName(entry.project_id);
  const invoice = laborInvoiceContext(entry);
  return `<article ${laborRecordAttributes(entry, 'labor-record-card')}>
    <button class="labor-card-open" type="button" data-labor-id="${Number(entry.id)}" aria-label="Open labor entry for ${escapeHtml(entry.service_type)}">
      <span class="labor-card-top"><strong>${shortDate(entry.work_date)}</strong>${laborStatusChip(entry.status)}</span>
      <span class="labor-card-context"><b>${escapeHtml(clientName(entry.client_id))}</b>${project ? `<span>${escapeHtml(project)}</span>` : '<span>No project</span>'}</span>
      <span class="labor-card-service"><strong>${escapeHtml(entry.service_type)}</strong>${entry.notes ? `<span>${escapeHtml(entry.notes)}</span>` : ''}</span>
      <span class="labor-card-values"><span><small>Hours</small><b>${escapeHtml(entry.hours)}</b></span><span><small>Rate</small><b>${money(entry.hourly_rate)}</b></span><span><small>Total</small><strong>${money(entry.line_total)}</strong></span></span>
      <span class="labor-card-billing">${laborBillingChip(entry)}${invoice ? `<small>${escapeHtml(invoice)}</small>` : ''}</span>
    </button>
    <div class="labor-card-actions">${rowActions('labor', entry.id)}</div>
  </article>`;
}

function laborListEmptyHtml({filtered=false}={}) {
  if (filtered) return `<section class="panel labor-list-empty hidden" id="laborFilterEmpty"><strong>No Labor matches these filters.</strong><span>Try another search or reset the filters.</span><button class="ghost" type="button" data-reset-labor-filters>Reset Filters</button></section>`;
  return `<section class="panel labor-list-empty"><strong>No Labor yet.</strong><span>Log completed or planned work for a Client or Project.</span><button class="primary" id="emptyAddLabor" type="button">Add Labor</button></section>`;
}

function laborServiceOptions(selected='') {
  const options = state.dropdowns.service_type || [];
  const hasSelected = options.some(option => String(option.label) === String(selected));
  const current = selected && !hasSelected ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>` : '';
  return `${current}${optionList(options, selected)}`;
}

function laborEditorShellHtml({editing=null, settings={}, formId='laborForm', scopedClientId='', scopedProjectId='', clientLabel='', clientSelectId='laborClient', projectSelectId='laborProject', invoiceSelectId='laborInvoice', closeButtonId='', cancelButtonId=''}) {
  const isEdit = Boolean(editing);
  const clientId = editing?.client_id || scopedClientId || '';
  const projectId = editing?.project_id || scopedProjectId || '';
  const defaultRate = settings.default_labor_rate || '100.00';
  const closeId = closeButtonId ? ` id="${closeButtonId}"` : '';
  const cancelId = cancelButtonId ? ` id="${cancelButtonId}"` : '';
  const clientField = scopedClientId
    ? `<input type="hidden" name="client_id" value="${Number(scopedClientId)}"><label class="labor-field"><span>Client</span><input value="${clientLabel}" disabled aria-label="Client"></label>`
    : `<label class="labor-field"><span>Client</span><select name="client_id" id="${clientSelectId}" required>${clientOptions(clientId)}</select></label>`;
  return `<div class="modal-card wide-modal labor-editor-shell"><header class="modal-header labor-editor-header"><div><p class="labor-editor-eyebrow">Labor workflow</p><h2 id="${formId}Title">${isEdit ? 'Edit Labor' : 'Add Labor'}</h2><p>${isEdit ? 'Review the work details, current status, and billing state.' : 'Log work for a Client or Project.'}</p></div><button class="ghost modal-close"${closeId} type="button" aria-label="Close labor form">×</button></header>
    <form id="${formId}" class="labor-editor-form">
      <div class="labor-editor-scroll">
        <section class="labor-editor-section" aria-labelledby="${formId}ContextHeading"><div class="labor-editor-section-head"><span>1</span><div><h3 id="${formId}ContextHeading">Work Context</h3><p>Connect this work to the correct Client and Project.</p></div></div><div class="labor-editor-grid">${clientField}<label class="labor-field"><span>Project</span><select name="project_id" id="${projectSelectId}">${projectOptions(projectId, clientId)}</select></label></div></section>
        <section class="labor-editor-section" aria-labelledby="${formId}DetailsHeading"><div class="labor-editor-section-head"><span>2</span><div><h3 id="${formId}DetailsHeading">Work Details</h3><p>Record what was done, when, and its current status.</p></div><span class="labor-status-preview">${laborStatusChip(editing?.status || 'completed')}</span></div><div class="labor-editor-grid labor-work-grid">
          <label class="labor-field"><span>Work Date</span><input name="work_date" type="date" required value="${escapeHtml(editing?.work_date || todayIso())}"></label>
          <label class="labor-field"><span>Status</span><select name="status"><option value="planned">Planned</option><option value="completed">Completed</option><option value="invoiced">Invoiced</option><option value="paid">Paid</option><option value="canceled">Canceled</option></select></label>
          <label class="labor-field labor-service-field"><span>Service / Description</span><select name="service_type" required><option value="">Select service...</option>${laborServiceOptions(editing?.service_type || '')}</select></label>
          <label class="labor-field"><span>Hours</span><input name="hours" type="number" step="0.25" min="0" inputmode="decimal" required value="${escapeHtml(editing?.hours ?? '')}"></label>
          <label class="labor-field"><span>Hourly Rate</span><input name="hourly_rate" type="number" step="0.01" min="0.01" inputmode="decimal" required value="${escapeHtml(editing?.hourly_rate || defaultRate)}"></label>
          <div class="labor-value-summary"><small>Labor Value</small><strong data-labor-total>${money(editing?.line_total || 0)}</strong><span>Hours × hourly rate</span></div>
          <label class="labor-field labor-notes-field"><span>Notes</span><textarea name="notes" rows="4" placeholder="Internal labor notes">${escapeHtml(editing?.notes)}</textarea></label>
        </div></section>
        <section class="labor-editor-section" aria-labelledby="${formId}BillingHeading"><div class="labor-editor-section-head"><span>3</span><div><h3 id="${formId}BillingHeading">Billing State</h3><p>Review whether this work is available for billing or already invoiced.</p></div></div>
          <div class="labor-billing-summary" aria-live="polite"><div><small>Current billing state</small><strong data-labor-billing-label>${editing?.is_invoiced ? 'Invoiced' : 'Available / Uninvoiced'}</strong><span data-labor-billing-context>${laborInvoiceContext(editing || {}) ? escapeHtml(laborInvoiceContext(editing)) : 'No linked Invoice'}</span></div>${laborBillingChip(editing || {})}</div>
          <div class="labor-editor-grid labor-billing-controls"><label class="labor-field"><span>Linked Invoice</span><select name="invoice_id" id="${invoiceSelectId}">${invoiceOptions(editing?.invoice_id, clientId, projectId)}</select></label><label class="labor-field"><span>Invoice Number</span><input name="invoice_number" value="${escapeHtml(editing?.invoice_number)}" placeholder="Optional manual invoice #"></label><label class="labor-invoiced-toggle"><input name="is_invoiced" type="checkbox" ${editing?.is_invoiced ? 'checked' : ''}><span><strong>Marked as invoiced</strong><small>Preserves the existing manual billing-state control.</small></span></label></div>
        </section>
      </div>
      <footer class="labor-editor-actions"><button class="ghost ${cancelButtonId ? '' : 'quick-cancel'}" type="button"${cancelId}>Cancel</button><button class="primary" type="submit">${isEdit ? 'Update Labor' : 'Save Labor'}</button></footer>
    </form></div>`;
}

function wireLaborEditor(container, {formId='laborForm', editing=null, clientId='', projectSelectId='laborProject', invoiceSelectId='laborInvoice', onSave}) {
  const form = container.querySelector(`#${formId}`);
  if (!form) return;
  const clientSelect = form.elements.client_id;
  const projectSelect = container.querySelector(`#${projectSelectId}`);
  const invoiceSelect = container.querySelector(`#${invoiceSelectId}`);
  const statusSelect = form.elements.status;
  const invoicedToggle = form.elements.is_invoiced;
  const invoiceNumber = form.elements.invoice_number;
  const total = container.querySelector('[data-labor-total]');
  const billingLabel = container.querySelector('[data-labor-billing-label]');
  const billingContext = container.querySelector('[data-labor-billing-context]');
  const billingChip = container.querySelector('.labor-billing-summary > .labor-chip');
  const statusPreview = container.querySelector('.labor-status-preview');
  statusSelect.value = editing?.status || 'completed';
  const currentClientId = () => clientId || clientSelect?.value || '';
  const updateInvoiceOptions = (selected='') => {
    if (invoiceSelect) invoiceSelect.innerHTML = invoiceOptions(selected, currentClientId(), projectSelect?.value || '');
  };
  clientSelect?.addEventListener('change', () => {
    if (projectSelect) projectSelect.innerHTML = projectOptions('', clientSelect.value);
    updateInvoiceOptions('');
    updateBillingSummary();
  });
  projectSelect?.addEventListener('change', () => { updateInvoiceOptions(''); updateBillingSummary(); });
  const updateTotal = () => {
    const value = Number(form.elements.hours.value || 0) * Number(form.elements.hourly_rate.value || 0);
    if (total) total.textContent = money(value);
  };
  const updateStatusPreview = () => { if (statusPreview) statusPreview.innerHTML = laborStatusChip(statusSelect.value); };
  function updateBillingSummary() {
    const isInvoiced = Boolean(invoicedToggle?.checked);
    const selectedInvoice = invoiceSelect?.selectedOptions?.[0]?.textContent?.trim();
    const manualNumber = invoiceNumber?.value.trim();
    if (billingLabel) billingLabel.textContent = isInvoiced ? 'Invoiced' : 'Available / Uninvoiced';
    if (billingContext) billingContext.textContent = selectedInvoice && invoiceSelect.value ? selectedInvoice : (manualNumber || 'No linked Invoice');
    if (billingChip) {
      billingChip.className = `labor-chip ${isInvoiced ? 'labor-billing-invoiced' : 'labor-billing-available'}`;
      billingChip.textContent = isInvoiced ? 'Invoiced' : 'Available / Uninvoiced';
    }
  }
  form.elements.hours.addEventListener('input', updateTotal);
  form.elements.hourly_rate.addEventListener('input', updateTotal);
  statusSelect.addEventListener('change', updateStatusPreview);
  invoiceSelect?.addEventListener('change', updateBillingSummary);
  invoiceNumber?.addEventListener('input', updateBillingSummary);
  invoicedToggle?.addEventListener('change', updateBillingSummary);
  updateTotal();
  updateStatusPreview();
  updateBillingSummary();
  form.onsubmit = async event => {
    event.preventDefault();
    const payload = clean(formData(form));
    payload.client_id = Number(payload.client_id);
    numOrDelete(payload, 'project_id');
    numOrDelete(payload, 'invoice_id');
    payload.hours = Number(payload.hours);
    payload.hourly_rate = Number(payload.hourly_rate);
    payload.is_invoiced = formBool(form, 'is_invoiced');
    await onSave(payload);
  };
}

function attachLaborListControls(totalCount) {
  const search = root.querySelector('#laborSearch');
  const status = root.querySelector('#laborStatusFilter');
  const client = root.querySelector('#laborClientFilter');
  const project = root.querySelector('#laborProjectFilter');
  const billing = root.querySelector('#laborBillingFilter');
  const tableRows = [...root.querySelectorAll('.labor-table [data-labor-record]')];
  const cards = [...root.querySelectorAll('.labor-mobile-list [data-labor-record]')];
  const empty = root.querySelector('#laborFilterEmpty');
  const resultCount = root.querySelector('#laborResultCount');
  const indicator = root.querySelector('#laborFilterIndicator');
  const desktopList = root.querySelector('.labor-desktop-list');
  const mobileList = root.querySelector('.labor-mobile-list');
  const matches = record => {
    const query = search.value.trim().toLowerCase();
    return (!query || record.dataset.laborSearch.includes(query))
      && (status.value === 'all' || record.dataset.laborStatus === status.value)
      && (client.value === 'all' || record.dataset.laborClient === client.value)
      && (project.value === 'all' || record.dataset.laborProject === project.value)
      && (billing.value === 'all' || record.dataset.laborInvoiced === billing.value);
  };
  const apply = () => {
    state.laborStatusFilter = status.value;
    state.laborClientFilter = client.value;
    state.laborProjectFilter = project.value;
    state.laborBillingFilter = billing.value;
    let shown = 0;
    cards.forEach(card => { const visible = matches(card); card.classList.toggle('hidden', !visible); if (visible) shown += 1; });
    tableRows.forEach(row => row.classList.toggle('hidden', !matches(row)));
    const hasQueryOrFilter = Boolean(search.value.trim()) || [status, client, project, billing].some(control => control.value !== 'all');
    empty?.classList.toggle('hidden', shown > 0 || !hasQueryOrFilter);
    desktopList?.classList.toggle('labor-no-matches', shown === 0 && hasQueryOrFilter);
    mobileList?.classList.toggle('labor-no-matches', shown === 0 && hasQueryOrFilter);
    if (resultCount) resultCount.textContent = hasQueryOrFilter ? `${shown} of ${totalCount} labor entr${totalCount === 1 ? 'y' : 'ies'}` : `${totalCount} labor entr${totalCount === 1 ? 'y' : 'ies'}`;
    const activeFilters = [status, client, project, billing].filter(control => control.value !== 'all').length;
    if (indicator) {
      indicator.textContent = `${activeFilters} active filter${activeFilters === 1 ? '' : 's'}`;
      indicator.classList.toggle('hidden', activeFilters === 0);
    }
  };
  [search, status, client, project, billing].forEach(control => control?.addEventListener(control === search ? 'input' : 'change', apply));
  root.querySelectorAll('[data-reset-labor-filters]').forEach(button => button.addEventListener('click', () => {
    search.value = '';
    status.value = 'all'; client.value = 'all'; project.value = 'all'; billing.value = 'all';
    apply();
    search.focus();
  }));
  apply();
}

async function renderLabor(editId=null) {
  setLaborEditorPageState(false);
  const [data, settingsResponse] = await Promise.all([api('/api/labor?page_size=100'), api('/api/admin/settings')]);
  const settings = settingsResponse.settings || {};
  const editing = editId ? data.items.find(item => Number(item.id) === Number(editId)) : null;
  const clientFilterOptions = state.clients.map(item => `<option value="${Number(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  const projectFilterOptions = state.projects.map(item => `<option value="${Number(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  const laborRows = data.items.map(entry => {
    const project = projectName(entry.project_id);
    const invoice = laborInvoiceContext(entry);
    return [shortDate(entry.work_date), `<div class="labor-context-cell"><strong>${escapeHtml(clientName(entry.client_id))}</strong><span>${project ? escapeHtml(project) : 'No project'}</span></div>`, `<div class="labor-service-cell"><strong>${escapeHtml(entry.service_type)}</strong>${entry.notes ? `<span>${escapeHtml(entry.notes)}</span>` : ''}</div>`, laborStatusChip(entry.status), escapeHtml(entry.hours), money(entry.hourly_rate), `<strong>${money(entry.line_total)}</strong>`, `<div class="labor-billing-cell">${laborBillingChip(entry)}${invoice ? `<span>${escapeHtml(invoice)}</span>` : ''}</div>`, rowActions('labor', entry.id)];
  });
  const rowAttributes = data.items.map(entry => `${laborRecordAttributes(entry, 'labor-record-row')} role="button" tabindex="0"`);
  const listHtml = data.items.length
    ? `<div class="labor-desktop-list">${table(['Date','Client / Project','Service / Description','Status','Hours','Rate','Total','Billing State','Actions'], laborRows, 'labor-table', rowAttributes)}</div><div class="labor-mobile-list" aria-label="Labor entries">${data.items.map(laborCardHtml).join('')}</div>${laborListEmptyHtml({filtered:true})}`
    : laborListEmptyHtml();
  root.innerHTML = `<section class="labor-list-controls panel"><div class="labor-list-primary"><label class="search-field compact-search">Search Labor<input id="laborSearch" type="search" placeholder="Service, Client, Project, notes, or status"></label><button class="primary" id="openLaborModal" type="button">Add Labor</button></div><div class="labor-filter-row"><label class="filter-field">Status<select id="laborStatusFilter"><option value="all">All Statuses</option><option value="planned">Planned</option><option value="completed">Completed</option><option value="invoiced">Invoiced</option><option value="paid">Paid</option><option value="canceled">Canceled</option></select></label><label class="filter-field">Client<select id="laborClientFilter"><option value="all">All Clients</option>${clientFilterOptions}</select></label><label class="filter-field">Project<select id="laborProjectFilter"><option value="all">All Projects</option>${projectFilterOptions}</select></label><label class="filter-field">Billing<select id="laborBillingFilter"><option value="all">All Billing States</option><option value="false">Available / Uninvoiced</option><option value="true">Invoiced</option></select></label><button class="ghost" type="button" data-reset-labor-filters>Reset Filters</button><span class="labor-filter-indicator hidden" id="laborFilterIndicator"></span><span class="labor-result-count" id="laborResultCount">${data.items.length} labor entr${data.items.length === 1 ? 'y' : 'ies'}</span></div></section>
    ${listHtml}
    <div id="laborModal" class="modal-backdrop labor-editor-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="laborFormTitle">${laborEditorShellHtml({editing, settings, closeButtonId:'closeLaborModal', cancelButtonId:'cancelLaborModal'})}</div>`;
  [
    ['#laborStatusFilter', state.laborStatusFilter],
    ['#laborClientFilter', state.laborClientFilter],
    ['#laborProjectFilter', state.laborProjectFilter],
    ['#laborBillingFilter', state.laborBillingFilter],
  ].forEach(([selector, value]) => {
    const control = root.querySelector(selector);
    control.value = value;
    if (!control.value) control.value = 'all';
  });
  wireLaborEditor(root, {editing, onSave: async payload => {
    try {
      if (editing) await api(`/api/labor/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)});
      else await api('/api/labor', {method:'POST', body: JSON.stringify(payload)});
      show(editing ? 'Labor entry updated' : 'Labor entry saved');
      await root.querySelector('#laborModal')._closeLaborEditor();
    } catch (err) { await showForgeOpsError(err); }
  }});
  setupLaborModal({editing, rerender: renderLabor});
  root.querySelector('#emptyAddLabor')?.addEventListener('click', () => root.querySelector('#openLaborModal')?.click());
  if (data.items.length) attachLaborListControls(data.items.length);
  attachRowActions();
  attachLaborRowClicks();
}

async function renderReceipts(editId=null) {
  const data = await api('/api/receipts?page_size=100');
  const editing = editId ? data.items.find(r => r.id === editId) : null;
  root.innerHTML = `<div class="page-actions"><div><h2>Receipts</h2><p class="muted">Global reference view. Primary work happens inside each client.</p></div><label class="search-field compact-search">Search<input id="receiptSearch" type="search" placeholder="Search receipts..."></label></div><div class="panel"><h2>Upload Receipt</h2><form id="receiptUploadForm" class="form-grid" enctype="multipart/form-data"><label class="full">Receipt Photo/PDF<input name="file" type="file" accept="image/*,application/pdf" required></label><button class="primary" type="submit">Upload Receipt</button></form></div>
  ${editing ? `<div class="panel"><h2>Edit Receipt Metadata</h2><form id="receiptEditForm" class="form-grid">
    <label>Vendor<input name="vendor_name" value="${escapeHtml(editing.vendor_name)}"></label><label>Receipt Date<input name="receipt_date" type="date" value="${escapeHtml(editing.receipt_date)}"></label>
    <label>Total Amount<input name="total_amount" type="number" step="0.01" min="0.01" value="${escapeHtml(editing.total_amount)}"></label><label>Tax Amount<input name="tax_amount" type="number" step="0.01" min="0" value="${escapeHtml(editing.tax_amount)}"></label>
    <label>Category<input name="category" value="${escapeHtml(editing.category)}"></label><label>Status<select name="status"><option value="needs_review">Needs Review</option><option value="uploaded">Uploaded</option><option value="reviewed">Reviewed</option><option value="attached">Attached</option><option value="archived">Archived</option></select></label>
    <label>Linked Type<select name="linked_type"><option value="">Unassigned</option><option value="client">Client</option><option value="admin_expense">Admin Expense</option><option value="project">Project</option><option value="quote">Quote</option><option value="invoice">Invoice</option><option value="ledger_entry">Ledger Entry</option></select></label><label>Linked ID<input name="linked_id" type="number" min="1" value="${escapeHtml(editing.linked_id)}"></label>
    <label class="full">Notes<textarea name="notes">${escapeHtml(editing.notes)}</textarea></label><div class="form-actions"><button class="primary" type="submit">Update Receipt</button><button class="ghost" type="button" id="cancelEdit">Cancel</button>${receiptPreviewButton(editing.id, 'Preview File')}</div>
  </form></div>` : ''}
  ${table(['File','Vendor','Date','Amount','Status','Linked','Open','Actions'], data.items.map(r => [escapeHtml(r.original_filename),escapeHtml(r.vendor_name),r.receipt_date,money(r.total_amount),`<span class="status">${statusLabel(r.status)}</span>`,r.linked_type?`${escapeHtml(r.linked_type)} #${r.linked_id||''}`:'Unassigned',receiptPreviewButton(r.id),rowActions('receipt', r.id)]))}`;
  receiptUploadForm.onsubmit = async e => { e.preventDefault(); const fd = new FormData(receiptUploadForm); try { await api('/api/receipts', {method:'POST', body:fd}); show('Receipt uploaded'); await renderReceipts(); } catch (err) { await showForgeOpsError(err); } };
  if (editing) {
    receiptEditForm.status.value = editing.status || 'needs_review'; receiptEditForm.linked_type.value = editing.linked_type || '';
    receiptEditForm.onsubmit = async e => { e.preventDefault(); const payload = clean(formData(receiptEditForm)); numOrDelete(payload, 'linked_id'); if (payload.total_amount) payload.total_amount = Number(payload.total_amount); if (payload.tax_amount) payload.tax_amount = Number(payload.tax_amount); try { await api(`/api/receipts/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); show('Receipt updated'); await renderReceipts(); } catch (err) { await showForgeOpsError(err); } };
    cancelEdit.onclick = () => renderReceipts();
  }
  attachPageSearch('receiptSearch');
  attachRowActions();
}


function closeClientQuickModal() {
  const modal = document.querySelector('#clientQuickModal');
  if (!modal) return;
  if (modal._quoteEscapeHandler) document.removeEventListener('keydown', modal._quoteEscapeHandler);
  if (modal._invoiceEscapeHandler) document.removeEventListener('keydown', modal._invoiceEscapeHandler);
  if (modal._laborEscapeHandler) document.removeEventListener('keydown', modal._laborEscapeHandler);
  if (modal._ledgerEscapeHandler) document.removeEventListener('keydown', modal._ledgerEscapeHandler);
  const closesQuoteEditor = modal.classList.contains('quote-editor-backdrop');
  const closesInvoiceEditor = modal.classList.contains('invoice-editor-backdrop');
  const closesLaborEditor = modal.classList.contains('labor-editor-backdrop');
  const closesLedgerEditor = modal.classList.contains('ledger-editor-backdrop');
  if (closesQuoteEditor || closesInvoiceEditor || closesLaborEditor || closesLedgerEditor) [...root.children].forEach(child => { child.inert = false; });
  if (closesQuoteEditor) setQuoteEditorPageState(false);
  if (closesInvoiceEditor) setInvoiceEditorPageState(false);
  if (closesLaborEditor) setLaborEditorPageState(false);
  if (closesLedgerEditor) setLedgerEditorPageState(false);
  const returnFocus = modal._quoteReturnFocus;
  modal.remove();
  setTimeout(() => returnFocus?.isConnected && returnFocus.focus?.(), 0);
}

async function findRecordForModal(type, id) {
  if (!id) return null;
  const paths = {
    projects: '/api/projects?page_size=100',
    quotes: '/api/quotes?page_size=100',
    invoices: '/api/invoices?page_size=100',
    labor: '/api/labor?page_size=100',
    ledger: '/api/ledger?page_size=100',
    receipts: '/api/receipts?page_size=100',
  };
  const data = await api(paths[type]);
  return (data.items || []).find(i => Number(i.id) === Number(id)) || null;
}

function clientScopeLabel(clientId) {
  const client = state.clients.find(c => Number(c.id) === Number(clientId));
  return client ? escapeHtml(client.name) : `Client #${clientId}`;
}

async function openClientQuickModal(clientId, type, editId=null, opts={}) {
  const returnFocus = document.activeElement;
  closeClientQuickModal();
  await preloadLookups();
  const editing = await findRecordForModal(type, editId);
  if (editId && !editing) throw new Error('Could not find that record to edit. Refresh and try again.');
  const isEdit = Boolean(editing);
  const scopedProjectId = editing?.project_id || opts.projectId || '';
  const scopedQuoteId = editing?.quote_id || opts.quoteId || '';
  const clientLabel = clientScopeLabel(clientId);
  const clientHidden = `<input type="hidden" name="client_id" value="${clientId}"><label>Client<input value="${clientLabel}" disabled></label>`;
  const wrapper = document.createElement('div');
  wrapper.id = 'clientQuickModal';
  wrapper.className = 'modal-backdrop';
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');

  const closeAfter = async (tab, message) => {
    closeClientQuickModal();
    show(message);
    await preloadLookups();
    if (opts.returnToProject && opts.projectId) {
      await renderProjectDetail(Number(opts.projectId), tab === 'projects' ? 'overview' : tab);
      return;
    }
    if (opts.returnToDashboard) {
      await renderDashboard();
      return;
    }
    await renderClientDetail(clientId, tab);
  };

  if (type === 'projects') {
    const addresses = await ensureAddresses(clientId);
    wrapper.innerHTML = `<div class="modal-card"><div class="modal-header"><div><h2>${isEdit ? 'Edit Project' : 'Add Project'}</h2><p>${isEdit ? 'Update this project without leaving the client.' : `Create a project for ${clientLabel}.`}</p></div><button class="ghost modal-close" type="button" aria-label="Close project form">×</button></div><form id="clientProjectForm" class="form-grid">
      ${clientHidden}<label>Project Name<input name="name" required value="${escapeHtml(editing?.name)}"></label>
      <label>Status<select name="status"><option value="lead">Lead</option><option value="quoted">Quoted</option><option value="approved">Approved</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label>
      <label>Start Date<input name="start_date" type="date" value="${escapeHtml(editing?.start_date)}"></label><label>End Date<input name="completed_date" type="date" value="${escapeHtml(editing?.completed_date)}"></label>
      <label>Site Address<select id="quickProjectAddressSelect">${addressOptions(addresses, editing?.site_address)}</select></label>
      <label id="quickNewAddressWrap" class="hidden">New Address Label<input id="quickNewAddressLabel" value="Site"></label>
      <label class="full">Selected/New Site Address<textarea name="site_address" id="quickProjectSiteAddress" placeholder="Pick a saved address or add a new one">${escapeHtml(editing?.site_address)}</textarea></label>
      <label class="full">Notes<textarea name="notes">${escapeHtml(editing?.notes)}</textarea></label>
      <div class="form-actions"><button class="primary" type="submit">${isEdit ? 'Update Project' : 'Save Project'}</button><button class="ghost quick-cancel" type="button">Cancel</button></div>
    </form></div>`;
    root.appendChild(wrapper);
    const form = wrapper.querySelector('#clientProjectForm');
    form.status.value = editing?.status || 'lead';
    const addrSelect = wrapper.querySelector('#quickProjectAddressSelect');
    const newWrap = wrapper.querySelector('#quickNewAddressWrap');
    const siteText = wrapper.querySelector('#quickProjectSiteAddress');
    addrSelect.onchange = () => { if (addrSelect.value === '__new__') { newWrap.classList.remove('hidden'); siteText.value = ''; siteText.focus(); } else { newWrap.classList.add('hidden'); siteText.value = addrSelect.value; } };
    form.onsubmit = async e => {
      e.preventDefault();
      const payload = clean(formData(form)); payload.client_id = Number(clientId);
      try {
        if (addrSelect.value === '__new__' && payload.site_address) {
          await api(`/api/clients/${clientId}/addresses`, { method:'POST', body: JSON.stringify({client_id: Number(clientId), label: wrapper.querySelector('#quickNewAddressLabel').value || 'Site', address: payload.site_address, is_default: false}) });
          delete state.addressesByClient[clientId];
        }
        if (isEdit) await api(`/api/projects/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)});
        else await api('/api/projects', {method:'POST', body: JSON.stringify(payload)});
        await closeAfter('projects', isEdit ? 'Project updated' : 'Project saved');
      } catch(err) { await showForgeOpsError(err); }
    };
  }

  if (type === 'quotes') {
    const settingsResponse = await api('/api/admin/settings');
    const settings = settingsResponse.settings || {};
    const existingItems = isEdit ? (await api(`/api/quotes/${editing.id}/line-items`)).items : [];
    const generatedQuoteNumber = editing?.quote_number || await nextQuoteNumber();
    const quoteNumberAttrs = isEdit ? '' : ' readonly aria-readonly="true" title="Generated automatically to prevent duplicate quote numbers"';
    wrapper.classList.add('quote-editor-backdrop');
    wrapper.setAttribute('aria-labelledby', 'clientQuoteFormTitle');
    wrapper.innerHTML = quoteEditorFormHtml({editing, generatedQuoteNumber, quoteNumberAttrs, settings, existingItems, termsTemplates:state.termsTemplates, formId:'clientQuoteForm', projectSelectId:'clientQuoteProject', scopedClientId:clientId, scopedProjectId, clientLabel, scoped:true});
    root.appendChild(wrapper);
    wrapper._quoteReturnFocus = returnFocus;
    [...root.children].filter(child => child !== wrapper).forEach(child => { child.inert = true; });
    setQuoteEditorPageState(true);
    wrapper._quoteEscapeHandler = event => { if (event.key === 'Escape') closeClientQuickModal(); };
    document.addEventListener('keydown', wrapper._quoteEscapeHandler);
    const form = wrapper.querySelector('#clientQuoteForm');
    form.status.value = editing?.status || 'draft';
    wireQuoteLineEditor(wrapper);
    wireTermsTemplateApply(wrapper, 'clientQuoteForm', state.termsTemplates);
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        const result = await persistQuoteEditor(form, wrapper, editing, clientId);
        if (!result) return;
        await closeAfter('quotes', isEdit ? 'Quote updated' : 'Quote saved');
      } catch(err) { await showForgeOpsError(err); }
    };
  }

  if (type === 'invoices') {
    const settingsResponse = await api('/api/admin/settings');
    const settings = settingsResponse.settings || {};
    const generatedInvoiceNumber = editing?.invoice_number || await nextInvoiceNumber();
    const invoiceNumberAttrs = isEdit ? '' : ' readonly aria-readonly="true" title="Generated automatically to prevent duplicate invoice numbers"';
    wrapper.classList.add('invoice-editor-backdrop');
    wrapper.setAttribute('aria-labelledby', 'clientInvoiceFormTitle');
    wrapper.innerHTML = invoiceEditorShellHtml({editing, generatedInvoiceNumber, invoiceNumberAttrs, scopedClientId: clientId, scopedProjectId, scopedQuoteId, clientLabel, settings, termsTemplates:state.termsTemplates, formId:'clientInvoiceForm', projectSelectId:'clientInvoiceProject', quoteSelectId:'clientInvoiceQuote'});
    root.appendChild(wrapper);
    wrapper._quoteReturnFocus = returnFocus;
    [...root.children].filter(child => child !== wrapper).forEach(child => { child.inert = true; });
    setInvoiceEditorPageState(true);
    wrapper._invoiceEscapeHandler = event => { if (event.key === 'Escape') closeClientQuickModal(); };
    document.addEventListener('keydown', wrapper._invoiceEscapeHandler);
    await wireInvoiceInternalForm(wrapper, {formId:'clientInvoiceForm', projectSelectId:'clientInvoiceProject', quoteSelectId:'clientInvoiceQuote', editing, scopedClientId: clientId, onSave: async payload => { try { if (isEdit) await api(`/api/invoices/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/invoices', {method:'POST', body: JSON.stringify(payload)}); await closeAfter('invoices', isEdit ? 'Invoice updated' : 'Invoice saved'); } catch(err) { await showForgeOpsError(err); } }});
  }

  if (type === 'labor') {
    const settingsResponse = await api('/api/admin/settings');
    const settings = settingsResponse.settings || {};
    wrapper.classList.add('labor-editor-backdrop');
    wrapper.setAttribute('aria-labelledby', 'clientLaborFormTitle');
    wrapper.innerHTML = laborEditorShellHtml({editing, settings, formId:'clientLaborForm', scopedClientId:clientId, scopedProjectId, clientLabel, projectSelectId:'clientLaborProject', invoiceSelectId:'clientLaborInvoice'});
    root.appendChild(wrapper);
    wrapper._quoteReturnFocus = returnFocus;
    [...root.children].filter(child => child !== wrapper).forEach(child => { child.inert = true; });
    setLaborEditorPageState(true);
    wrapper._laborEscapeHandler = event => { if (event.key === 'Escape') closeClientQuickModal(); };
    document.addEventListener('keydown', wrapper._laborEscapeHandler);
    wireLaborEditor(wrapper, {formId:'clientLaborForm', editing, clientId, projectSelectId:'clientLaborProject', invoiceSelectId:'clientLaborInvoice', onSave: async payload => {
      try {
        if (isEdit) await api(`/api/labor/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)});
        else await api('/api/labor', {method:'POST', body: JSON.stringify(payload)});
        await closeAfter('labor', isEdit ? 'Labor entry updated' : 'Labor entry saved');
      } catch(err) { await showForgeOpsError(err); }
    }});
  }

  if (type === 'ledger') {
    wrapper.classList.add('ledger-editor-backdrop');
    wrapper.setAttribute('aria-labelledby', 'clientLedgerFormTitle');
    wrapper.innerHTML = ledgerEditorShellHtml({editing, formId:'clientLedgerForm', scopedClientId:clientId, scopedProjectId, clientLabel, presetKind:opts.ledgerKind || '', closeButtonId:'closeClientLedgerModal'});
    root.appendChild(wrapper);
    wrapper._quoteReturnFocus = returnFocus;
    [...root.children].filter(child => child !== wrapper).forEach(child => { child.inert = true; });
    setLedgerEditorPageState(true);
    wrapper._ledgerEscapeHandler = event => { if (event.key === 'Escape') closeClientQuickModal(); };
    document.addEventListener('keydown', wrapper._ledgerEscapeHandler);
    wireLedgerEditor(wrapper, {formId:'clientLedgerForm', editing, clientId, presetKind:opts.ledgerKind || '', onSave: async (payload, form) => {
      try {
        await saveLedgerEntryWithReceipt(form, payload, isEdit ? editing : null);
        await closeAfter('ledger', isEdit ? 'Ledger entry updated' : 'Ledger entry saved');
      } catch(err) { await showForgeOpsError(err); }
    }});
  }

  if (type === 'receipts') {
    wrapper.innerHTML = `<div class="modal-card"><div class="modal-header"><div><h2>${isEdit ? 'Edit Receipt' : 'Upload Receipt'}</h2><p>${isEdit ? 'Update this receipt without leaving the client.' : `Upload a receipt and attach it to ${clientLabel}.`}</p></div><button class="ghost modal-close" type="button" aria-label="Close receipt form">×</button></div><form id="clientReceiptForm" class="form-grid" enctype="multipart/form-data">
      ${isEdit ? `<div class="full muted">File: ${escapeHtml(editing.original_filename || '')} ${receiptPreviewButton(editing.id, 'Preview file')}</div>` : `<label class="full">Receipt Photo/PDF<input name="file" type="file" accept="image/*,application/pdf" required></label>`}
      <label>Vendor<input name="vendor_name" value="${escapeHtml(editing?.vendor_name)}"></label><label>Receipt Date<input name="receipt_date" type="date" value="${escapeHtml(editing?.receipt_date)}"></label>
      <label>Total Amount<input name="total_amount" type="number" step="0.01" min="0" value="${escapeHtml(editing?.total_amount ?? '')}"></label><label>Tax Amount<input name="tax_amount" type="number" step="0.01" min="0" value="${escapeHtml(editing?.tax_amount ?? '')}"></label>
      <label>Category<input name="category" value="${escapeHtml(editing?.category)}"></label><label>Status<select name="status"><option value="attached">Attached</option><option value="needs_review">Needs Review</option><option value="uploaded">Uploaded</option><option value="reviewed">Reviewed</option><option value="archived">Archived</option></select></label>
      <label>Linked Type<select name="linked_type"><option value="client">Client</option><option value="project">Project</option><option value="quote">Quote</option><option value="invoice">Invoice</option><option value="ledger_entry">Ledger Entry</option><option value="admin_expense">Admin Expense</option></select></label><label>Linked ID<input name="linked_id" type="number" min="1" value="${escapeHtml(editing?.linked_id || clientId)}"></label>
      <label class="full">Notes<textarea name="notes">${escapeHtml(editing?.notes)}</textarea></label>
      <div class="form-actions"><button class="primary" type="submit">${isEdit ? 'Update Receipt' : 'Upload Receipt'}</button><button class="ghost quick-cancel" type="button">Cancel</button></div>
    </form></div>`;
    root.appendChild(wrapper);
    const form = wrapper.querySelector('#clientReceiptForm');
    form.status.value = editing?.status || 'attached';
    form.linked_type.value = editing?.linked_type || 'client';
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        if (isEdit) {
          const payload = clean(formData(form));
          numOrDelete(payload, 'linked_id');
          if (payload.total_amount) payload.total_amount = Number(payload.total_amount);
          if (payload.tax_amount) payload.tax_amount = Number(payload.tax_amount);
          await api(`/api/receipts/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)});
          await closeAfter('receipts', 'Receipt updated');
          return;
        }
        const fd = new FormData(form);
        const metadata = clean(Object.fromEntries(fd.entries()));
        fd.delete('vendor_name'); fd.delete('receipt_date'); fd.delete('total_amount'); fd.delete('tax_amount'); fd.delete('category'); fd.delete('status'); fd.delete('notes'); fd.delete('linked_type'); fd.delete('linked_id');
        const created = await api('/api/receipts', {method:'POST', body:fd});
        const payload = { linked_type: metadata.linked_type || 'client', linked_id: Number(metadata.linked_id || clientId), status: metadata.status || 'attached' };
        ['vendor_name','receipt_date','category','notes'].forEach(k => { if (metadata[k]) payload[k] = metadata[k]; });
        if (metadata.total_amount) payload.total_amount = Number(metadata.total_amount);
        if (metadata.tax_amount) payload.tax_amount = Number(metadata.tax_amount);
        await api(`/api/receipts/${created.id}`, {method:'PATCH', body: JSON.stringify(payload)});
        await closeAfter('receipts', 'Receipt uploaded');
      } catch(err) { await showForgeOpsError(err); }
    };
  }

  attachPrintActions(wrapper);
  attachQuoteInvoiceActions(wrapper);
  wrapper.querySelector('.modal-close')?.addEventListener('click', closeClientQuickModal);
  wrapper.querySelector('.quick-cancel')?.addEventListener('click', closeClientQuickModal);
  wrapper.addEventListener('click', e => { if (e.target === wrapper) closeClientQuickModal(); });
  setTimeout(() => wrapper.querySelector('input,select,textarea')?.focus(), 0);
}


function shortDate(value) { return value ? escapeHtml(value) : '—'; }
function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function lastDayOfMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }
function reportRangeFromControls() {
  const mode = document.querySelector('#reportMode')?.value || 'year';
  const year = Number(document.querySelector('#reportYear')?.value || new Date().getFullYear());
  if (mode === 'year') return { start: `${year}-01-01`, end: `${year}-12-31`, label: `${year}` };
  if (mode === 'month') {
    const month = Number(document.querySelector('#reportMonth')?.value || 1);
    return { start: `${year}-${String(month).padStart(2,'0')}-01`, end: `${year}-${String(month).padStart(2,'0')}-${String(lastDayOfMonth(year, month - 1)).padStart(2,'0')}`, label: `${year}-${String(month).padStart(2,'0')}` };
  }
  if (mode === 'ny-quarter') {
    const quarter = Number(document.querySelector('#reportQuarter')?.value || 1);
    const key = `${year}-Q${quarter}`;
    const period = salesTaxPeriodByKey(key);
    if (!period) throw new Error('NY sales-tax period options are unavailable. Refresh and try again.');
    return { start: period.start_date, end: period.end_date, label: period.report_label, salesTaxPeriod: key };
  }
  const start = document.querySelector('#reportStart')?.value || `${year}-01-01`;
  const end = document.querySelector('#reportEnd')?.value || `${year}-12-31`;
  return { start, end, label: `${start} to ${end}` };
}
function statusRows(statuses) {
  return Object.entries(statuses || {}).map(([name, count]) => [statusLabel(name), count]);
}

function dashboardWorkRows(data) {
  const rows = [
    ...(data.open_projects || []).slice(0, 2).map(item => ({type:'project', id:item.id, cells:['Project',`<div class="record-primary"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.client)}</span></div>`,`<span class="status">${statusLabel(item.status)}</span>`,shortDate(item.start_date)]})),
    ...(data.open_quotes || []).slice(0, 2).map(item => ({type:'quote', id:item.id, cells:['Quote',`<div class="record-primary"><strong>${escapeHtml(item.quote_number)}</strong><span>${escapeHtml(item.client)}</span></div>`,`<span class="status">${statusLabel(item.status)}</span>`,money(item.total_amount)]})),
    ...(data.open_invoices || []).slice(0, 2).map(item => ({type:'invoice', id:item.id, cells:['Invoice',`<div class="record-primary"><strong>${escapeHtml(item.invoice_number)}</strong><span>${escapeHtml(item.client)}</span></div>`,`<span class="status">${statusLabel(item.status)}</span>`,money(item.balance_due)]})),
  ].slice(0, 5);
  return rows.map((row, index) => ({className:`dashboard-work-item dashboard-work-item-${index + 1}`, attrs:`role="button" tabindex="0" data-dashboard-type="${row.type}" data-dashboard-id="${row.id}"`, cells:row.cells}));
}

async function renderDashboard() {
  const now = new Date();
  const monthStart = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const [dashboardResult, reportResult] = await Promise.allSettled([
    api('/api/dashboard'),
    api(`/api/reports/money-flow?start_date=${monthStart}&end_date=${monthEnd}`),
  ]);
  if (dashboardResult.status !== 'fulfilled') throw dashboardResult.reason;
  const data = dashboardResult.value;
  const cards = data.cards || {};
  const reportCards = reportResult.status === 'fulfilled' ? reportResult.value.cards : null;
  const today = todayIso();
  const overdueInvoices = (data.open_invoices || []).filter(invoice => invoice.status === 'overdue' || (invoice.due_date && invoice.due_date < today));
  const overdueIds = new Set(overdueInvoices.map(invoice => Number(invoice.id)));
  const unpaidInvoices = (data.open_invoices || []).filter(invoice => !overdueIds.has(Number(invoice.id)));
  const attentionItems = [
    overdueInvoices.length ? {label:'Overdue invoices', detail:`${overdueInvoices.length} need follow-up`, value:money(overdueInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0)), page:'invoices', level:'urgent'} : null,
    unpaidInvoices.length ? {label:'Open unpaid invoices', detail:`${unpaidInvoices.length} awaiting payment`, value:money(unpaidInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0)), page:'invoices', level:'warning'} : null,
    Number(cards.uninvoiced_labor || 0) ? {label:'Uninvoiced labor', detail:`${cards.uninvoiced_labor} ${Number(cards.uninvoiced_labor) === 1 ? 'entry' : 'entries'} ready to review`, value:money(cards.uninvoiced_labor_value), page:'labor', level:'warning'} : null,
    Number(cards.open_quotes || 0) ? {label:'Open quotes', detail:`${cards.open_quotes} ${Number(cards.open_quotes) === 1 ? 'quote' : 'quotes'} in progress`, value:'Review', page:'quotes', level:'neutral'} : null,
    Number(cards.open_projects || 0) ? {label:'Open projects', detail:`${cards.open_projects} active ${Number(cards.open_projects) === 1 ? 'project' : 'projects'}`, value:'Review', page:'projects', level:'neutral'} : null,
  ].filter(Boolean);
  const attentionHtml = attentionItems.length ? `<div class="attention-list">${attentionItems.map(item => `<button class="attention-row attention-${item.level}" type="button" data-view-page="${item.page}"><span class="attention-marker" aria-hidden="true"></span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span><b>${escapeHtml(item.value)}</b><span aria-hidden="true">→</span></button>`).join('')}</div>` : '<div class="record-empty compact-empty"><strong>You are caught up.</strong><span>No invoices, labor, quotes, or projects need attention.</span></div>';
  const monthHtml = reportCards ? `<div class="cards month-summary-cards"><div class="card"><span>Revenue</span><strong>${money(reportCards.ledger_revenue)}</strong></div><div class="card"><span>Total Expenses</span><strong>${money(reportCards.ledger_expenses)}</strong></div><div class="card"><span>Estimated Take-Home</span><strong>${money(reportCards.owner_pay)}</strong></div><div class="card"><span>Sales Tax Safety Hold</span><strong>${money(reportCards.estimated_sales_tax)}</strong></div></div>` : '<div class="inline-unavailable" role="status"><strong>Monthly summary unavailable.</strong><span>Open work is still shown below. Refresh to try the report again.</span></div>';
  const workRows = dashboardWorkRows(data);
  const laborRows = (data.uninvoiced_labor_items || []).slice(0, 5).map((entry, index) => ({className:`dashboard-work-item dashboard-work-item-${index + 1}`, attrs:`role="button" tabindex="0" data-dashboard-type="labor" data-dashboard-id="${entry.id}"`, cells:[shortDate(entry.work_date),`<div class="record-primary"><strong>${escapeHtml(entry.service_type)}</strong><span>${escapeHtml(entry.client)}</span></div>`,escapeHtml(entry.project || 'No project'),money(entry.line_total)]}));
  root.innerHTML = `<div class="dashboard-view phase2-dashboard">
    <section class="panel dashboard-panel month-panel"><div class="panel-heading"><div><p class="section-eyebrow">Current month</p><h2>This Month</h2></div><span class="muted">${escapeHtml(monthStart)} – ${escapeHtml(monthEnd)}</span></div>${monthHtml}</section>
    <section class="panel dashboard-panel attention-panel"><div class="panel-heading"><div><p class="section-eyebrow">Priority queue</p><h2>Needs Attention</h2></div></div>${attentionHtml}</section>
    <section class="panel dashboard-panel"><div class="panel-heading"><div><p class="section-eyebrow">Active records</p><h2>Open Work</h2></div><div class="view-all-group"><button class="mini" type="button" data-view-page="projects">Projects</button><button class="mini" type="button" data-view-page="quotes">Quotes</button><button class="mini" type="button" data-view-page="invoices">Invoices</button></div></div>${adaptiveRecordList(['Type','Record','Status','Date / Value'], workRows, 'No open projects, quotes, or invoices.', 'dashboard-record-list')}</section>
    <section class="panel dashboard-panel"><div class="panel-heading"><div><p class="section-eyebrow">Ready to bill</p><h2>Uninvoiced Labor</h2></div><button class="mini" type="button" data-view-page="labor">View All</button></div>${adaptiveRecordList(['Date','Service','Project','Value'], laborRows, 'No uninvoiced labor.', 'dashboard-record-list')}</section></div>`;
  attachDashboardActions();
}

async function openDashboardRecord(type, id) {
  if (type === 'project') return renderProjectDetail(id);
  const typeMap = { project: 'projects', quote: 'quotes', invoice: 'invoices', labor: 'labor', ledger: 'ledger' };
  const quickType = typeMap[type];
  if (!quickType) throw new Error(`Unknown dashboard record type: ${type}`);
  const record = await findRecordForModal(quickType, id);
  if (!record) throw new Error('Could not find that record. Refresh and try again.');
  if (!record.client_id) throw new Error('This dashboard record is not attached to a client.');
  await openClientQuickModal(Number(record.client_id), quickType, id, { returnToDashboard: true });
}

function attachDashboardActions() {
  root.querySelectorAll('[data-view-page]').forEach(button => {
    button.addEventListener('click', () => loadPage(button.dataset.viewPage));
  });
  root.querySelectorAll('[data-dashboard-type][data-dashboard-id]').forEach(row => {
    const open = () => openDashboardRecord(row.dataset.dashboardType, Number(row.dataset.dashboardId));
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      open().catch(err => showForgeOpsError(err, 'Unable to open record.'));
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      open().catch(err => showForgeOpsError(err, 'Unable to open record.'));
    });
  });
}

function reportMetricHtml(label, value, helper='', modifier='') {
  const tone = Number(value) < 0 ? ' report-metric-negative' : '';
  return `<article class="report-metric ${modifier}${tone}"><span>${escapeHtml(label)}</span><strong>${money(value)}</strong>${helper ? `<small>${escapeHtml(helper)}</small>` : ''}</article>`;
}

function reportHasFinancialActivity(data) {
  const c = data.cards || {};
  return (data.account_type_breakdown || []).length > 0
    || (data.by_category || []).length > 0
    || Number(c.invoice_total || 0) !== 0
    || Number(c.uninvoiced_labor || 0) !== 0;
}

function renderReportResults(data, range) {
  const c = data.cards;
  const hasFinancialActivity = reportHasFinancialActivity(data);
  const noActivity = hasFinancialActivity ? '' : `<div class="report-empty-state" role="status"><strong>No financial activity in this period</strong><span>The summary remains at $0.00 so the selected range is still clear. Try another period to see recorded activity.</span></div>`;
  const accountRows = (data.account_type_breakdown || []).map(r => [escapeHtml(r.account_type), escapeHtml(r.category), money(r.total)]);
  const categoryRows = (data.by_category || []).map(r => [escapeHtml(r.name), money(r.revenue), money(r.expenses), money(r.net)]);
  const clientRows = (data.by_client || []).map(r => [escapeHtml(r.name), money(r.revenue), money(r.expenses), money(r.net)]);
  const projectRows = (data.by_project || []).map(r => [escapeHtml(r.name), money(r.revenue), money(r.expenses), money(r.net)]);
  const clientReportRows = (data.client_report || []).map(r => [escapeHtml(r.client), r.projects, r.quotes, r.invoices, r.labor_entries, money(r.ledger_net), money(r.invoice_total), money(r.outstanding)]);
  const projectReportRows = (data.project_report || []).map(r => [escapeHtml(r.project), escapeHtml(r.client), statusLabel(r.status), r.quotes, r.invoices, r.labor_entries, money(r.ledger_net), money(r.invoice_total)]);
  const isNySalesTaxQuarter = Boolean(range.salesTaxPeriod);
  const salesTaxPaymentLabel = isNySalesTaxQuarter ? 'Applied Payments' : 'Paid';
  const taxPaymentHelper = isNySalesTaxQuarter
    ? `Sales tax payments applied to this quarter: ${money(c.sales_tax_paid)}. Income tax paid within the selected dates: ${money(c.income_tax_paid)}.`
    : `Total tax paid in the selected period: ${money(c.total_tax_paid)}`;

  return `<div class="report-workspace">
    <header class="report-period-banner">
      <div><p class="report-eyebrow">Selected period</p><h2>${escapeHtml(range.label)}</h2></div>
      <p><span>${escapeHtml(data.range.start_date)}</span><b>through</b><span>${escapeHtml(data.range.end_date)}</span></p>
    </header>
    ${noActivity}
    <section class="report-section report-summary-section" aria-labelledby="reportSummaryTitle">
      <div class="report-section-heading"><div><p class="report-eyebrow">Business result</p><h2 id="reportSummaryTitle">Financial Summary</h2></div><p>Revenue, spending, income, and the final amount remaining after tax holds.</p></div>
      <div class="report-primary-summary">
        ${reportMetricHtml('Revenue', c.ledger_revenue, 'Gross ledger revenue', 'report-metric-revenue')}
        ${reportMetricHtml('Total Expenses', c.ledger_expenses, 'Job and business expenses', 'report-metric-expenses')}
        ${reportMetricHtml('Net Income', c.net_income, 'Revenue minus total expenses', 'report-metric-income')}
        ${reportMetricHtml('Net Profit', c.ledger_net_profit, 'Net income minus remaining tax reserves', 'report-metric-profit')}
      </div>
      <div class="report-financial-identity" aria-label="Net income allocation">
        <span><small>Net Profit</small><strong>${money(c.ledger_net_profit)}</strong></span>
        <b>+</b>
        <span><small>Remaining Sales Tax</small><strong>${money(c.estimated_sales_tax)}</strong></span>
        <b>+</b>
        <span><small>Remaining Income Tax</small><strong>${money(c.estimated_income_tax)}</strong></span>
        <b>=</b>
        <span><small>Net Income</small><strong>${money(c.net_income)}</strong></span>
      </div>
    </section>

    <section class="report-section report-reserve-section" aria-labelledby="reportReserveTitle">
      <div class="report-section-heading"><div><p class="report-eyebrow">Held, paid, remaining</p><h2 id="reportReserveTitle">Tax Reserve Detail</h2></div><p>Safety holding amounts reduce spendable profit. Payments reduce only their matching hold.</p></div>
      <div class="report-reserve-grid">
        <article class="report-reserve-card report-reserve-sales">
          <div><span class="report-reserve-icon" aria-hidden="true">S</span><div><h3>Sales Tax</h3><p>Conservative 7% hold on gross revenue</p></div></div>
          <dl><div><dt>Estimated Hold</dt><dd>${money(c.gross_sales_tax_estimate)}</dd></div><div><dt>${salesTaxPaymentLabel}</dt><dd>${money(c.sales_tax_paid)}</dd></div><div class="report-reserve-remaining"><dt>Remaining</dt><dd>${money(c.estimated_sales_tax)}</dd></div></dl>
        </article>
        <article class="report-reserve-card report-reserve-income">
          <div><span class="report-reserve-icon" aria-hidden="true">I</span><div><h3>Income Tax</h3><p>Configured-rate hold on net income</p></div></div>
          <dl><div><dt>Estimated Hold</dt><dd>${money(c.gross_income_tax_estimate)}</dd></div><div><dt>Paid</dt><dd>${money(c.income_tax_paid)}</dd></div><div class="report-reserve-remaining"><dt>Remaining</dt><dd>${money(c.estimated_income_tax)}</dd></div></dl>
        </article>
      </div>
      <div class="report-reserve-total"><span>Total remaining tax reserve</span><strong>${money(c.estimated_tax_owed)}</strong><small>${escapeHtml(taxPaymentHelper)}</small></div>
    </section>

    <section class="report-section" aria-labelledby="reportBreakdownTitle">
      <div class="report-section-heading"><div><p class="report-eyebrow">Money in and out</p><h2 id="reportBreakdownTitle">Income & Expense Breakdown</h2></div><p>Ledger activity grouped without changing its account type or category.</p></div>
      <div class="report-breakdown-grid">
        <article class="report-subsection"><h3>By Account Type & Category</h3>${compactTable(['Account Type','Category','Total'], accountRows, 'No ledger activity for this period.', 'reports-table report-account-table')}</article>
        <article class="report-subsection"><h3>By Business Category</h3>${compactTable(['Category','Revenue','Expenses','Net'], categoryRows, 'No category activity for this period.', 'reports-table report-category-table')}</article>
      </div>
    </section>

    <section class="report-section" aria-labelledby="reportContributionTitle">
      <div class="report-section-heading"><div><p class="report-eyebrow">Sources and work</p><h2 id="reportContributionTitle">Client & Project Contribution</h2></div><p>Revenue and expenses attached to the selected period's ledger records.</p></div>
      <div class="report-contribution-grid">
        <article class="report-subsection"><h3>By Client</h3>${compactTable(['Client','Revenue','Expenses','Net'], clientRows, 'No client activity for this period.', 'reports-table report-client-table')}</article>
        <article class="report-subsection"><h3>By Project</h3>${compactTable(['Project','Revenue','Expenses','Net'], projectRows, 'No project activity for this period.', 'reports-table report-project-table')}</article>
      </div>
    </section>

    <section class="report-section report-record-section" aria-labelledby="reportRecordsTitle">
      <div class="report-section-heading"><div><p class="report-eyebrow">Operational context</p><h2 id="reportRecordsTitle">Invoices & Records</h2></div><p>Receivables and work counts remain separate from ledger revenue.</p></div>
      <div class="report-secondary-summary">
        ${reportMetricHtml('Job Expenses', c.job_expenses)}
        ${reportMetricHtml('Business Expenses', c.business_expenses)}
        ${reportMetricHtml('Invoice Total', c.invoice_total)}
        ${reportMetricHtml('Invoice Paid', c.invoice_paid)}
        ${reportMetricHtml('Outstanding', c.invoice_outstanding)}
        ${reportMetricHtml('Invoice Sales Tax', c.invoice_sales_tax)}
        ${reportMetricHtml('Uninvoiced Labor', c.uninvoiced_labor)}
      </div>
      <div class="report-status-grid">
        <article><h3>Projects</h3>${compactTable(['Status','Count'], statusRows(data.project_statuses), 'No projects.', 'reports-table report-status-table')}</article>
        <article><h3>Quotes</h3>${compactTable(['Status','Count'], statusRows(data.quote_statuses), 'No quotes.', 'reports-table report-status-table')}</article>
        <article><h3>Invoices</h3>${compactTable(['Status','Count'], statusRows(data.invoice_statuses), 'No invoices.', 'reports-table report-status-table')}</article>
      </div>
      <details class="report-detail-disclosure"><summary>Client record detail</summary>${compactTable(['Client','Projects','Quotes','Invoices','Labor','Ledger Net','Invoice Total','Outstanding'], clientReportRows, 'No client report rows for this period.', 'reports-table report-detail-table')}</details>
      <details class="report-detail-disclosure"><summary>Project record detail</summary>${compactTable(['Project','Client','Status','Quotes','Invoices','Labor','Ledger Net','Invoice Total'], projectReportRows, 'No project report rows for this period.', 'reports-table report-detail-table')}</details>
    </section>
  </div>`;
}

async function renderReports() {
  const now = new Date();
  const currentYear = now.getFullYear();
  state.reportYear ||= String(currentYear);
  state.reportMonth ||= String(now.getMonth() + 1);
  state.reportStart ||= formatLocalDate(new Date(currentYear, 0, 1));
  state.reportEnd ||= formatLocalDate(new Date(currentYear, 11, 31));
  const selected = (value, current) => String(value) === String(current) ? 'selected' : '';

  root.innerHTML = `<section class="panel report-period-panel" aria-labelledby="reportPeriodTitle">
    <div class="report-section-heading report-period-heading"><div><p class="report-eyebrow">Reporting period</p><h2 id="reportPeriodTitle">Choose a Time Range</h2></div><p>The active range is repeated above every result.</p></div>
    <form id="reportForm" class="report-period-controls">
      <label class="report-field"><span>View By</span><select id="reportMode" name="mode"><option value="year" ${selected('year', state.reportMode)}>Year</option><option value="month" ${selected('month', state.reportMode)}>Month</option><option value="ny-quarter" ${selected('ny-quarter', state.reportMode)}>New York Sales Tax Quarter</option><option value="range" ${selected('range', state.reportMode)}>Custom Date Range</option></select></label>
      <label class="report-field" id="reportYearWrap"><span>Year</span><input id="reportYear" name="year" type="number" min="2000" max="2100" step="1" value="${escapeHtml(state.reportYear)}" inputmode="numeric"></label>
      <label class="report-field" id="reportMonthWrap"><span>Month</span><select id="reportMonth" name="month">${Array.from({length:12}, (_,i)=>`<option value="${i+1}" ${selected(i + 1, state.reportMonth)}>${new Date(2000, i, 1).toLocaleString('default', {month:'long'})}</option>`).join('')}</select></label>
      <label class="report-field" id="reportQuarterWrap"><span>NY Quarter</span><select id="reportQuarter" name="quarter"><option value="1" ${selected('1', state.reportQuarter)}>Q1: Dec-Feb</option><option value="2" ${selected('2', state.reportQuarter)}>Q2: Mar-May</option><option value="3" ${selected('3', state.reportQuarter)}>Q3: Jun-Aug</option><option value="4" ${selected('4', state.reportQuarter)}>Q4: Sep-Nov</option></select></label>
      <label class="report-field" id="reportStartWrap"><span>From</span><input id="reportStart" name="start" type="date" value="${escapeHtml(state.reportStart)}"></label>
      <label class="report-field" id="reportEndWrap"><span>To</span><input id="reportEnd" name="end" type="date" value="${escapeHtml(state.reportEnd)}"></label>
      <button class="primary report-run-button" type="submit">Run Report</button>
    </form>
    <p id="reportError" class="report-error hidden" role="alert"></p>
  </section>
  <div id="reportResults" aria-live="polite"><div class="report-loading" role="status">Loading report...</div></div>`;

  const form = document.querySelector('#reportForm');
  const modeControl = document.querySelector('#reportMode');
  const yearWrap = document.querySelector('#reportYearWrap');
  const monthWrap = document.querySelector('#reportMonthWrap');
  const quarterWrap = document.querySelector('#reportQuarterWrap');
  const startWrap = document.querySelector('#reportStartWrap');
  const endWrap = document.querySelector('#reportEndWrap');
  const updateVisibility = () => {
    const mode = modeControl.value;
    yearWrap.classList.toggle('hidden', mode === 'range');
    monthWrap.classList.toggle('hidden', mode !== 'month');
    quarterWrap.classList.toggle('hidden', mode !== 'ny-quarter');
    startWrap.classList.toggle('hidden', mode !== 'range');
    endWrap.classList.toggle('hidden', mode !== 'range');
  };
  const saveControls = () => {
    state.reportMode = modeControl.value;
    state.reportYear = document.querySelector('#reportYear').value;
    state.reportMonth = document.querySelector('#reportMonth').value;
    state.reportQuarter = document.querySelector('#reportQuarter').value;
    state.reportStart = document.querySelector('#reportStart').value;
    state.reportEnd = document.querySelector('#reportEnd').value;
  };
  const run = async () => {
    saveControls();
    const error = document.querySelector('#reportError');
    const button = form.querySelector('.report-run-button');
    error.classList.add('hidden');
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Running...';
    try {
      const range = reportRangeFromControls();
      const params = new URLSearchParams({start_date: range.start, end_date: range.end});
      if (range.salesTaxPeriod) params.set('sales_tax_period', range.salesTaxPeriod);
      const data = await api(`/api/reports/money-flow?${params}`);
      document.querySelector('#reportResults').innerHTML = renderReportResults(data, range);
    } catch (err) {
      error.textContent = err.message || 'Unable to run this report.';
      error.classList.remove('hidden');
      return false;
    } finally {
      button.disabled = false;
      button.textContent = 'Run Report';
    }
  };
  modeControl.addEventListener('change', () => { saveControls(); updateVisibility(); });
  form.addEventListener('change', saveControls);
  form.onsubmit = async event => {
    event.preventDefault();
    await run();
  };
  updateVisibility();
  await run();
}

function settingsRatePercent(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  const percent = number <= 1 ? number * 100 : number;
  return String(Number(percent.toFixed(4)));
}

function settingsRatePayload(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error('Enter a percentage from 0 to 100.');
  return String(number <= 1 ? number : Number((number / 100).toFixed(6)));
}

function settingsRateMeaning(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) return 'Invalid percentage';
  return `${Number((number <= 1 ? number * 100 : number).toFixed(4))}%`;
}

function backupCreatedLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || 'Unknown') : date.toLocaleString();
}

function backupHistoryHtml(items) {
  if (!items.length) return `<div class="settings-empty-state"><strong>No backups created here yet.</strong><span>Create a backup to begin the local history.</span></div>`;
  return `<div class="settings-backup-history-list">${items.map((backup, index) => `<article class="settings-backup-record ${index === 0 ? 'settings-backup-latest' : ''}"><div><strong>${escapeHtml(backup.filename)}</strong><span>${escapeHtml(backupCreatedLabel(backup.created_at))}</span></div><div><span>${Math.max(1, Math.round(Number(backup.file_size_bytes || 0) / 1024))} KB</span>${index === 0 ? '<b>Latest</b>' : ''}</div></article>`).join('')}</div>`;
}

async function downloadSettingsBackup(button, status) {
  button.disabled = true;
  status.className = 'settings-action-status';
  status.textContent = 'Creating backup...';
  try {
    const response = await fetch('/api/admin/backups/download', {credentials:'same-origin'});
    if (!response.ok) {
      const payload = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
      throw new Error(payload?.detail || payload?.message || payload || 'Unable to create backup');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `fst-backup-${Date.now()}.zip`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status.className = 'settings-action-status settings-status-success';
    status.textContent = `${filename} is ready in your downloads.`;
    show('Backup created');
    const records = await api('/api/admin/backups');
    document.querySelector('#backupHistory').innerHTML = backupHistoryHtml(records.items || []);
  } catch (err) {
    status.className = 'settings-action-status settings-status-error';
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

function termsApplicabilityLabel(value) {
  return value === 'both' ? 'Quotes & Invoices' : value === 'quote' ? 'Quotes' : 'Invoices';
}

function termsLibraryListHtml(items=[]) {
  if (!items.length) return '<div class="settings-terms-empty">No saved terms yet. Document defaults still apply normally.</div>';
  return items.map(template => `<article class="settings-terms-card">
    <div><strong>${escapeHtml(template.name)}</strong><span>${escapeHtml(termsApplicabilityLabel(template.applies_to))}</span><p>${escapeHtml(template.content)}</p></div>
    <div class="row-actions"><button class="mini" type="button" data-terms-action="edit" data-id="${Number(template.id)}">Edit</button><button class="mini danger-mini" type="button" data-terms-action="delete" data-id="${Number(template.id)}">Delete</button></div>
  </article>`).join('');
}

async function renderAdmin() {
  const [records, dropdowns, settingsResponse, termsResponse] = await Promise.all([
    api('/api/admin/backups'),
    api('/api/admin/dropdowns?include_inactive=true&page_size=100'),
    api('/api/admin/settings'),
    api('/api/terms'),
  ]);
  const settings = settingsResponse.settings || {};
  const rows = dropdowns.items || [];
  const termsTemplates = termsResponse.items || [];
  const salesTaxPercent = settingsRatePercent(settings.sales_tax_rate, '7');
  const incomeTaxPercent = settingsRatePercent(settings.income_tax_reserve_rate, '30');
  root.innerHTML = `<div class="settings-workspace">
    <form id="businessSettingsForm" class="settings-form">
      <section class="settings-section settings-business-section" aria-labelledby="businessSettingsTitle">
        <div class="settings-section-heading"><div><p class="settings-eyebrow">Business identity</p><h2 id="businessSettingsTitle">Business Information</h2></div><p>Used as the business name on printable Quotes, Invoices, and record packets.</p></div>
        <div class="settings-field-grid">
          <label class="settings-field settings-field-wide"><span>Business Name</span><input name="company_name" required maxlength="160" value="${escapeHtml(settings.company_name || 'Forged Systems LLC')}"><small>Changing this updates new and reprinted business documents.</small></label>
        </div>
      </section>

      <section class="settings-section" aria-labelledby="financialSettingsTitle">
        <div class="settings-section-heading"><div><p class="settings-eyebrow">Rates and reserves</p><h2 id="financialSettingsTitle">Financial Settings</h2></div><p>These defaults feed existing Quote, Invoice, Labor, and Report calculations.</p></div>
        <div class="settings-field-grid settings-financial-grid">
          <label class="settings-field"><span>Default Labor Rate</span><span class="settings-input-affix"><b>$</b><input name="default_labor_rate" type="number" step="0.01" min="0" required value="${escapeHtml(settings.default_labor_rate || '100.00')}" inputmode="decimal"></span><small>Hourly rate suggested for new Labor entries.</small></label>
          <label class="settings-field"><span>Quote Markup</span><span class="settings-input-affix settings-input-suffix"><input name="quote_markup_percent" type="number" step="0.01" min="0" required value="${escapeHtml(settings.quote_markup_percent || '10')}" inputmode="decimal"><b>%</b></span><small>Existing Quote markup behavior is unchanged.</small></label>
          <label class="settings-field settings-rate-field"><span>Sales Tax Rate</span><span class="settings-input-affix settings-input-suffix"><input id="salesTaxRateSetting" name="sales_tax_rate" type="number" min="0" max="100" step="0.01" required value="${escapeHtml(salesTaxPercent)}" inputmode="decimal"><b>%</b></span><small>Enter 7 or 0.07 for 7%. Saved safely as the existing normalized rate.</small><output id="salesTaxMeaning" class="settings-rate-meaning">Interpreted as ${escapeHtml(settingsRateMeaning(salesTaxPercent))}</output></label>
          <label class="settings-field settings-rate-field"><span>Income Tax Reserve Rate</span><span class="settings-input-affix settings-input-suffix"><input id="incomeTaxRateSetting" name="income_tax_reserve_rate" type="number" min="0" max="100" step="0.01" required value="${escapeHtml(incomeTaxPercent)}" inputmode="decimal"><b>%</b></span><small>Enter 30 or 0.30 for 30%. Reports use this configured reserve rate.</small><output id="incomeTaxMeaning" class="settings-rate-meaning">Interpreted as ${escapeHtml(settingsRateMeaning(incomeTaxPercent))}</output></label>
        </div>
      </section>

      <section class="settings-section" aria-labelledby="documentDefaultsTitle">
        <div class="settings-section-heading"><div><p class="settings-eyebrow">Starting text</p><h2 id="documentDefaultsTitle">Document Defaults</h2></div><p>Applied when creating new documents. Existing Quote and Invoice text remains unchanged.</p></div>
        <div class="settings-document-grid">
          <label class="settings-field"><span>Default Quote Terms</span><textarea name="default_quote_terms" rows="9">${escapeHtml(quoteTermsValue(null, settings.default_quote_terms))}</textarea><small>Payment and validity text suggested for new Quotes.</small></label>
          <label class="settings-field"><span>Default Invoice Terms</span><textarea name="default_invoice_terms" rows="9">${escapeHtml(invoiceTermsValue(null, settings.default_invoice_terms))}</textarea><small>Payment text suggested for new Invoices.</small></label>
        </div>
      </section>

      <div class="settings-save-bar">
        <div><strong id="settingsSaveState">All settings are up to date.</strong><span id="settingsSaveStatus" role="status">Changes are saved only when you choose Save Settings.</span></div>
        <button id="saveBusinessSettings" class="primary" type="submit" disabled>Save Settings</button>
      </div>
    </form>

    <section class="settings-section settings-terms-section" aria-labelledby="termsLibraryTitle">
      <div class="settings-section-heading"><div><p class="settings-eyebrow">Reusable document text</p><h2 id="termsLibraryTitle">Terms Library</h2></div><p>Saved terms are copied into a Quote or Invoice when applied. Updating this library never changes an existing document.</p></div>
      <form id="termsLibraryForm" class="settings-terms-form">
        <input type="hidden" name="template_id">
        <label class="settings-field"><span>Template Name</span><input name="name" required maxlength="160" placeholder="Example: Equipment deposit required"></label>
        <label class="settings-field"><span>Available For</span><select name="applies_to" required><option value="both">Quotes & Invoices</option><option value="quote">Quotes only</option><option value="invoice">Invoices only</option></select></label>
        <label class="settings-field settings-terms-content"><span>Terms Text</span><textarea name="content" required maxlength="2000" rows="5" placeholder="Enter reusable payment or document terms..."></textarea></label>
        <div class="settings-terms-actions"><button id="saveTermsTemplate" class="primary" type="submit">Add Saved Terms</button><button id="cancelTermsEdit" class="ghost hidden" type="button">Cancel Edit</button><p id="termsLibraryStatus" class="settings-action-status" role="status"></p></div>
      </form>
      <div id="termsLibraryList" class="settings-terms-list">${termsLibraryListHtml(termsTemplates)}</div>
    </section>

    <section class="settings-section settings-backup-section" aria-labelledby="backupSettingsTitle">
      <div class="settings-section-heading"><div><p class="settings-eyebrow">Data protection</p><h2 id="backupSettingsTitle">Backup & Restore</h2></div><p>Backups include the SQLite database, uploaded files, and exports in the existing ForgeOps ZIP format.</p></div>
      <div class="settings-backup-grid">
        <article class="settings-backup-card settings-create-backup">
          <div><span class="settings-step">Safe action</span><h3>Create Backup</h3><p>Build and download a complete point-in-time copy of this ForgeOps workspace.</p></div>
          <button id="backupBtn" class="primary" type="button">Create Backup</button>
          <p id="backupStatus" class="settings-action-status" role="status">No automatic schedule or external destination is configured in this app.</p>
        </article>
        <article class="settings-backup-card settings-restore-backup">
          <div><span class="settings-step settings-step-danger">High-impact action</span><h3>Restore Backup</h3><p>Restore replaces the current database, uploads, and exports. ForgeOps creates a pre-restore backup first.</p></div>
          <form id="restoreForm" enctype="multipart/form-data">
            <label class="settings-file-field"><span>Select ForgeOps Backup ZIP</span><input id="restoreFile" name="file" type="file" accept=".zip,application/zip" required></label>
            <div id="restoreFileInfo" class="settings-file-info"><strong>No file selected</strong><span>Choose a ZIP, then check it before Restore is enabled.</span></div>
            <div class="settings-restore-actions"><button id="validateRestoreBtn" class="ghost" type="button" disabled>Check Backup</button><button id="restoreBtn" class="danger" type="submit" disabled>Restore Checked Backup</button></div>
            <p id="restoreStatus" class="settings-action-status" role="status">A file selection alone never starts a restore.</p>
          </form>
        </article>
      </div>
      <div class="settings-backup-history"><div class="settings-subheading"><h3>Backup History</h3><p>Backups created from this application instance.</p></div><div id="backupHistory">${backupHistoryHtml(records.items || [])}</div></div>
    </section>

    <section class="settings-section settings-list-section" aria-labelledby="listSettingsTitle">
      <div class="settings-section-heading"><div><p class="settings-eyebrow">Application choices</p><h2 id="listSettingsTitle">Dropdown Management</h2></div><p>Adjust the categories and service types offered by new records. Existing record text is preserved.</p></div>
      <form id="dropdownForm" class="settings-list-form">
        <label class="settings-field"><span>Dropdown Type</span><select name="kind"><option value="ledger_category">Ledger Category</option><option value="service_type">Service Type</option></select></label>
        <label class="settings-field"><span>Label</span><input name="label" required maxlength="120" placeholder="Example: Cable Runs"></label>
        <label class="settings-field"><span>Color / Tag</span><input name="color" maxlength="40" placeholder="Optional"></label>
        <label class="settings-field"><span>Sort Order</span><input name="sort_order" type="number" value="100" inputmode="numeric"></label>
        <label class="settings-active-field"><input name="is_active" type="checkbox" checked><span>Active</span></label>
        <button id="addDropdownOption" class="primary" type="submit">Add Option</button>
        <p id="dropdownStatus" class="settings-action-status" role="status"></p>
      </form>
      <div class="settings-list-table">${compactTable(['Type','Label','Color','Sort','Active','Actions'], rows.map(option => [statusLabel(option.kind), escapeHtml(option.label), escapeHtml(option.color || '—'), option.sort_order, option.is_active ? 'Yes' : 'No', `<div class="row-actions"><button class="mini" type="button" data-dd-action="toggle" data-id="${option.id}" data-active="${option.is_active}">${option.is_active ? 'Disable' : 'Enable'}</button><button class="mini danger-mini" type="button" data-dd-action="delete" data-id="${option.id}">Delete</button></div>`]), 'No dropdown options.', 'settings-dropdown-table')}</div>
    </section>
  </div>`;

  const settingsForm = document.querySelector('#businessSettingsForm');
  const settingsButton = document.querySelector('#saveBusinessSettings');
  const settingsSaveState = document.querySelector('#settingsSaveState');
  const settingsSaveStatus = document.querySelector('#settingsSaveStatus');
  const salesTaxInput = document.querySelector('#salesTaxRateSetting');
  const incomeTaxInput = document.querySelector('#incomeTaxRateSetting');
  const updateRateMeanings = () => {
    document.querySelector('#salesTaxMeaning').textContent = `Interpreted as ${settingsRateMeaning(salesTaxInput.value)}`;
    document.querySelector('#incomeTaxMeaning').textContent = `Interpreted as ${settingsRateMeaning(incomeTaxInput.value)}`;
  };
  settingsForm.addEventListener('input', () => {
    settingsButton.disabled = false;
    settingsSaveState.textContent = 'Unsaved changes';
    settingsSaveStatus.className = '';
    settingsSaveStatus.textContent = 'Review the values, then choose Save Settings.';
    updateRateMeanings();
  });
  settingsForm.onsubmit = async event => {
    event.preventDefault();
    if (!settingsForm.reportValidity()) return;
    const payload = clean(formData(settingsForm));
    settingsButton.disabled = true;
    settingsButton.textContent = 'Saving...';
    settingsSaveStatus.className = '';
    settingsSaveStatus.textContent = 'Saving settings...';
    try {
      payload.income_tax_reserve_rate = settingsRatePayload(payload.income_tax_reserve_rate);
      await api('/api/admin/settings', {method:'PUT', body:JSON.stringify(payload)});
      settingsSaveState.textContent = 'Settings saved';
      settingsSaveStatus.className = 'settings-status-success';
      settingsSaveStatus.textContent = 'Saved values are active for new work and reporting.';
      show('Settings saved');
    } catch (err) {
      settingsButton.disabled = false;
      settingsSaveState.textContent = 'Settings not saved';
      settingsSaveStatus.className = 'settings-status-error';
      settingsSaveStatus.textContent = err.message;
    } finally {
      settingsButton.textContent = 'Save Settings';
    }
  };

  const termsForm = document.querySelector('#termsLibraryForm');
  const termsStatus = document.querySelector('#termsLibraryStatus');
  const termsSaveButton = document.querySelector('#saveTermsTemplate');
  const termsCancelButton = document.querySelector('#cancelTermsEdit');
  const resetTermsForm = () => {
    termsForm.reset();
    termsForm.elements.template_id.value = '';
    termsSaveButton.textContent = 'Add Saved Terms';
    termsCancelButton.classList.add('hidden');
    termsStatus.textContent = '';
    termsForm.elements.name.focus();
  };
  termsCancelButton.onclick = resetTermsForm;
  termsForm.onsubmit = async event => {
    event.preventDefault();
    if (!termsForm.reportValidity()) return;
    const payload = clean(formData(termsForm));
    const templateId = payload.template_id;
    delete payload.template_id;
    termsSaveButton.disabled = true;
    termsStatus.className = 'settings-action-status';
    termsStatus.textContent = templateId ? 'Updating saved terms...' : 'Adding saved terms...';
    try {
      await api(templateId ? `/api/terms/${templateId}` : '/api/terms', {method:templateId ? 'PATCH' : 'POST', body:JSON.stringify(payload)});
      show(templateId ? 'Saved terms updated' : 'Saved terms added');
      await loadPage('admin');
    } catch (err) {
      termsSaveButton.disabled = false;
      termsStatus.className = 'settings-action-status settings-status-error';
      termsStatus.textContent = err.message;
    }
  };
  root.querySelectorAll('[data-terms-action="edit"]').forEach(button => button.addEventListener('click', () => {
    const template = termsTemplates.find(item => Number(item.id) === Number(button.dataset.id));
    if (!template) return;
    termsForm.elements.template_id.value = template.id;
    termsForm.elements.name.value = template.name;
    termsForm.elements.applies_to.value = template.applies_to;
    termsForm.elements.content.value = template.content;
    termsSaveButton.textContent = 'Update Saved Terms';
    termsCancelButton.classList.remove('hidden');
    termsStatus.textContent = `Editing ${template.name}.`;
    termsForm.scrollIntoView({behavior:'smooth', block:'center'});
    termsForm.elements.name.focus();
  }));
  root.querySelectorAll('[data-terms-action="delete"]').forEach(button => button.addEventListener('click', async () => {
    const template = termsTemplates.find(item => Number(item.id) === Number(button.dataset.id));
    if (!template) return;
    const shouldDelete = await askForgeOpsDialog({
      title: 'Delete Saved Terms?',
      message: `Delete saved terms "${template.name}"? Existing Quote and Invoice text will not change.`,
      kind: 'destructive',
      primaryButtonText: 'Delete Saved Terms',
      cancelButtonText: 'Cancel',
    });
    if (!shouldDelete) return;
    button.disabled = true;
    try {
      await api(`/api/terms/${template.id}`, {method:'DELETE'});
      show('Saved terms deleted');
      await loadPage('admin');
    } catch (err) {
      button.disabled = false;
      termsStatus.className = 'settings-action-status settings-status-error';
      termsStatus.textContent = err.message;
    }
  }));

  const backupButton = document.querySelector('#backupBtn');
  backupButton.onclick = () => downloadSettingsBackup(backupButton, document.querySelector('#backupStatus'));

  const restoreForm = document.querySelector('#restoreForm');
  const restoreFile = document.querySelector('#restoreFile');
  const restoreFileInfo = document.querySelector('#restoreFileInfo');
  const validateRestoreButton = document.querySelector('#validateRestoreBtn');
  const restoreButton = document.querySelector('#restoreBtn');
  const restoreStatus = document.querySelector('#restoreStatus');
  let checkedFileKey = '';
  restoreFile.addEventListener('change', () => {
    const file = restoreFile.files?.[0];
    checkedFileKey = '';
    restoreButton.disabled = true;
    validateRestoreButton.disabled = !file;
    restoreStatus.className = 'settings-action-status';
    restoreStatus.textContent = file ? 'Check this backup before restoring.' : 'A file selection alone never starts a restore.';
    restoreFileInfo.innerHTML = file
      ? `<strong>${escapeHtml(file.name)}</strong><span>${Math.max(1, Math.round(file.size / 1024))} KB selected — not yet checked.</span>`
      : '<strong>No file selected</strong><span>Choose a ZIP, then check it before Restore is enabled.</span>';
  });
  validateRestoreButton.onclick = async () => {
    const file = restoreFile.files?.[0];
    if (!file) return;
    validateRestoreButton.disabled = true;
    restoreStatus.className = 'settings-action-status';
    restoreStatus.textContent = 'Checking backup contents...';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const result = await api('/api/admin/backups/validate', {method:'POST', body:fd});
      const counts = result.record_counts || {};
      checkedFileKey = `${file.name}:${file.size}:${file.lastModified}`;
      restoreButton.disabled = false;
      restoreFileInfo.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>Valid ForgeOps backup — ${counts.clients ?? 0} Clients, ${counts.projects ?? 0} Projects, ${counts.quotes ?? 0} Quotes, ${counts.invoices ?? 0} Invoices.</span>`;
      restoreStatus.className = 'settings-action-status settings-status-success';
      restoreStatus.textContent = 'Backup check passed. Restore is now available.';
    } catch (err) {
      checkedFileKey = '';
      restoreButton.disabled = true;
      restoreStatus.className = 'settings-action-status settings-status-error';
      restoreStatus.textContent = err.message;
    } finally {
      validateRestoreButton.disabled = false;
    }
  };
  restoreForm.onsubmit = async event => {
    event.preventDefault();
    const file = restoreFile.files?.[0];
    const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : '';
    if (!file || fileKey !== checkedFileKey) {
      restoreStatus.className = 'settings-action-status settings-status-error';
      restoreStatus.textContent = 'Check the selected backup again before restoring.';
      restoreButton.disabled = true;
      return;
    }
    const shouldRestore = await askForgeOpsDialog({
      title: 'Restore Checked Backup?',
      message: `Restore ${file.name}? This replaces current application data. A pre-restore backup will be created first.`,
      kind: 'destructive',
      primaryButtonText: 'Restore Backup',
      cancelButtonText: 'Cancel',
    });
    if (!shouldRestore) return;
    const restorePayload = new FormData(restoreForm);
    restoreButton.disabled = true;
    validateRestoreButton.disabled = true;
    restoreFile.disabled = true;
    restoreStatus.className = 'settings-action-status';
    restoreStatus.textContent = 'Restoring checked backup... Keep this page open.';
    try {
      const result = await api('/api/admin/backups/restore', {method:'POST', body:restorePayload});
      const counts = result.restored_counts || {};
      restoreStatus.className = 'settings-action-status settings-status-success';
      restoreStatus.textContent = `Restore completed. Clients: ${counts.clients ?? 0}, Projects: ${counts.projects ?? 0}, Quotes: ${counts.quotes ?? 0}, Invoices: ${counts.invoices ?? 0}, Labor: ${counts.labor_entries ?? 0}, Ledger: ${counts.ledger_entries ?? 0}. Reloading...`;
      show('Restore completed');
      setTimeout(() => window.location.href = `/?restored=${Date.now()}`, 900);
    } catch (err) {
      restoreStatus.className = 'settings-action-status settings-status-error';
      restoreStatus.textContent = err.message;
      restoreButton.disabled = false;
      validateRestoreButton.disabled = false;
      restoreFile.disabled = false;
    }
  };

  const dropdownForm = document.querySelector('#dropdownForm');
  dropdownForm.onsubmit = async event => {
    event.preventDefault();
    const status = document.querySelector('#dropdownStatus');
    const button = document.querySelector('#addDropdownOption');
    const payload = clean(formData(dropdownForm));
    payload.sort_order = Number(payload.sort_order || 100);
    payload.is_active = formBool(dropdownForm, 'is_active');
    button.disabled = true;
    status.className = 'settings-action-status';
    status.textContent = 'Adding option...';
    try {
      await api('/api/admin/dropdowns', {method:'POST', body:JSON.stringify(payload)});
      show('Dropdown option added');
      await loadPage('admin');
    } catch (err) {
      button.disabled = false;
      status.className = 'settings-action-status settings-status-error';
      status.textContent = err.message;
    }
  };
  root.querySelectorAll('[data-dd-action="toggle"]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/admin/dropdowns/${button.dataset.id}`, {method:'PATCH', body:JSON.stringify({is_active:button.dataset.active !== 'true'})});
      await loadPage('admin');
    } catch (err) {
      button.disabled = false;
      document.querySelector('#dropdownStatus').className = 'settings-action-status settings-status-error';
      document.querySelector('#dropdownStatus').textContent = err.message;
    }
  }));
  root.querySelectorAll('[data-dd-action="delete"]').forEach(button => button.addEventListener('click', async () => {
    const shouldDelete = await askForgeOpsDialog({
      title: 'Delete Dropdown Option?',
      message: 'Delete this dropdown option? Existing records keep their current text, but new forms will no longer show it.',
      kind: 'destructive',
      primaryButtonText: 'Delete Option',
      cancelButtonText: 'Cancel',
    });
    if (!shouldDelete) return;
    button.disabled = true;
    try {
      await api(`/api/admin/dropdowns/${button.dataset.id}`, {method:'DELETE'});
      await loadPage('admin');
    } catch (err) {
      button.disabled = false;
      document.querySelector('#dropdownStatus').className = 'settings-action-status settings-status-error';
      document.querySelector('#dropdownStatus').textContent = err.message;
    }
  }));
}

document.querySelector('#loginForm').addEventListener('submit', login);
document.querySelector('#setupAccountForm').addEventListener('submit', createInitialAccount);
document.querySelector('#setupRestoreForm').addEventListener('submit', restoreInitialBackup);
document.querySelector('#showCreateSetup').addEventListener('click', () => showSetupPane('create'));
document.querySelector('#showRestoreSetup').addEventListener('click', () => showSetupPane('restore'));
document.querySelector('#userBtn').addEventListener('click', openUserModal);
document.querySelector('#logoutBtn').addEventListener('click', logout);
document.querySelector('#mobileUserBtn')?.addEventListener('click', () => {
  closeShellDialog('mobileToolsMenu', false);
  openUserModal();
});
document.querySelector('#mobileLogoutBtn')?.addEventListener('click', logout);
document.querySelector('#mobileToolsBtn')?.addEventListener('click', event => openShellDialog('mobileToolsMenu', event.currentTarget));
document.querySelector('#desktopCreateBtn')?.addEventListener('click', event => openShellDialog('quickCreateSheet', event.currentTarget));
document.querySelector('#mobileCreateBtn')?.addEventListener('click', event => openShellDialog('quickCreateSheet', event.currentTarget));
document.querySelectorAll('[data-close-shell]').forEach(control => {
  control.addEventListener('click', () => closeShellDialog(control.dataset.closeShell));
});
document.querySelectorAll('[data-theme-toggle]').forEach(control => control.addEventListener('click', toggleTheme));
document.querySelectorAll('[data-quick-create]').forEach(control => {
  control.addEventListener('click', () => runQuickCreate(control.dataset.quickCreate).catch(err => showForgeOpsError(err)));
});
document.addEventListener('click', event => {
  const btn = event.target.closest('[data-action="preview-receipt"]');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  openReceiptPreviewModal(Number(btn.dataset.id)).catch(err => showForgeOpsError(err, 'Unable to preview receipt.'));
});
document.addEventListener('keydown', trapShellDialogFocus);
document.querySelectorAll('.nav[data-page]').forEach(button => {
  button.addEventListener('click', () => navigateFromNavigation(button.dataset.page).catch(err => showForgeOpsError(err)));
});
applyTheme(document.documentElement.dataset.theme);
registerServiceWorker();
(async function boot(){
  try {
    const setup = await api('/api/setup/status');
    if (setup.needs_setup) {
      document.querySelector('#setupView').classList.remove('hidden');
      document.querySelector('#loginView').classList.add('hidden');
      document.querySelector('#appView').classList.add('hidden');
      return;
    }
  } catch {
    // If setup status fails, fall back to the login view.
  }
  try {
    await api('/api/dashboard');
    document.querySelector('#setupView').classList.add('hidden');
    document.querySelector('#loginView').classList.add('hidden');
    document.querySelector('#appView').classList.remove('hidden');
    await refreshCurrentUser();
    await loadPage('dashboard');
  } catch {
    document.querySelector('#setupView').classList.add('hidden');
    document.querySelector('#loginView').classList.remove('hidden');
    document.querySelector('#appView').classList.add('hidden');
  }
})();
