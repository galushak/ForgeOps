const state = { page: 'dashboard', clients: [], projects: [], quotes: [], invoices: [], addressesByClient: {}, dropdowns: { ledger_category: [], service_type: [] }, editing: null, clientDetailTab: 'overview', clientDetailId: null, projectStatusFilter: 'active', quoteStatusFilter: 'all', quoteClientFilter: 'all', user: null, lookupCacheAt: 0, lookupCachePromise: null };
const root = document.querySelector('#pageRoot');
const messages = document.querySelector('#messages');
const loginError = document.querySelector('#loginError');
const setupError = document.querySelector('#setupError');
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


const LEDGER_CATEGORIES_BY_TYPE = {
  income: ['Services', 'Installation', 'Sales of Product', 'Computer Parts & Accessories', 'Networking Parts & Accessories', 'Security Parts & Accessories'],
  cogs: ['Cost of Goods Sold', 'CGS Computer Parts & Accessories', 'CGS Networking Parts & Accessories', 'CGS Security Parts & Accessories', 'CGS Software & Apps'],
  expense: ['General Business Expense', 'Tools and Equipment', 'Office Supplies', 'Sales Tax Paid', 'Income Tax Paid'],
};
const TAX_PAYMENT_CATEGORIES = new Set(['Sales Tax Paid', 'Sales Tax', 'Income Tax Paid', 'Income Tax']);
function normalizeLedgerKind(value) { return value === 'revenue' ? 'income' : (value || 'income'); }
function ledgerCategoryOptions(kind, selected='') {
  const normalized = normalizeLedgerKind(kind);
  return (LEDGER_CATEGORIES_BY_TYPE[normalized] || []).map(label => `<option value="${escapeHtml(label)}" ${String(selected)===String(label)?'selected':''}>${escapeHtml(label)}</option>`).join('');
}
function ledgerKindLabel(kind) {
  const labels = {income: 'Income', revenue: 'Income', cogs: 'Cost of Goods Sold', expense: 'Expenses'};
  return labels[kind] || statusLabel(kind);
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
  kind?.addEventListener('change', () => refreshCategories(false));
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
  return payload;
}

const titles = {
  dashboard: ['Dashboard', 'Internal tracking overview for open work, invoices, and labor.'],
  clients: ['Clients', 'Client database, contact info, and site addresses.'],
  projects: ['Projects', 'Project-centered workflow for jobs and client work.'],
  quotes: ['Quotes', 'Create and track quotes attached to clients and projects.'],
  invoices: ['Invoices', 'Create and track invoices attached to clients, projects, quotes, and labor.'],
  ledger: ['Ledger', 'Revenue, expenses, reimbursements, and admin costs.'],
  labor: ['Labor', 'Track billable work against clients and projects.'],
  reports: ['Reports', 'Money flow, sales-tax periods, and client/project summaries.'],
  admin: ['Backup & Restore', 'Download and restore your full app data package.'],
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
function feeByName(items, needle) {
  return items.find(i => normalizeKind(i.kind) === 'fee' && String(i.name || '').toLowerCase().includes(needle.toLowerCase()));
}
function equipmentRowsFromItems(items) {
  return (items || []).filter(i => normalizeKind(i.kind) === 'equipment');
}
function laborRowsFromItems(items) {
  return (items || []).filter(i => normalizeKind(i.kind) === 'labor');
}
function quoteEquipmentRowHtml(item={}) {
  const qty = item.quantity ?? '1.00';
  const price = item.unit_price ?? '0.00';
  const total = item.line_total ?? (Number(qty || 0) * Number(price || 0)).toFixed(2);
  return `<div class="quote-sheet-row quote-line-row" data-kind="equipment">
    <input name="name" required value="${escapeHtml(item.name || '')}" placeholder="Item">
    <input name="description" value="${escapeHtml(item.description || '')}" placeholder="Description">
    <input name="quantity" type="number" min="0" step="0.01" value="${escapeHtml(qty)}" aria-label="Quantity">
    <input name="unit_price" type="number" min="0" step="0.01" value="${escapeHtml(price)}" aria-label="Unit price">
    <input name="line_total" type="number" min="0" step="0.01" value="${escapeHtml(total)}" aria-label="Line total">
    <label class="tiny-check"><input name="taxable" type="checkbox" ${item.taxable === false ? '' : 'checked'}> Tax</label>
    <button class="mini danger-mini quote-remove-line" type="button">Remove</button>
  </div>`;
}
function quoteLaborRowHtml(item={}) {
  const hours = item.quantity ?? '1.00';
  const rate = item.unit_price ?? '100.00';
  const total = item.line_total ?? (Number(hours || 0) * Number(rate || 0)).toFixed(2);
  return `<div class="quote-sheet-row quote-line-row labor-sheet-row" data-kind="labor">
    <input name="name" required value="${escapeHtml(item.name || '')}" placeholder="Service">
    <input name="description" value="${escapeHtml(item.description || '')}" placeholder="Description">
    <input name="quantity" type="number" min="0" step="0.01" value="${escapeHtml(hours)}" aria-label="Hours">
    <input name="unit_price" type="number" min="0" step="0.01" value="${escapeHtml(rate)}" aria-label="Rate">
    <input name="line_total" type="number" min="0" step="0.01" value="${escapeHtml(total)}" aria-label="Line total">
    <button class="mini danger-mini quote-remove-line" type="button">Remove</button>
  </div>`;
}
function quoteLineEditorHtml(items=[], settings={}) {
  const markupPercent = Number(settings.quote_markup_percent ?? '10');
  const salesTaxRate = percentSetting(settings.sales_tax_rate ?? '0.07', 0.07);
  const laborRate = settings.default_labor_rate || '100.00';
  const equipment = equipmentRowsFromItems(items);
  const labor = laborRowsFromItems(items);
  const shipping = feeByName(items, 'shipping')?.line_total || '0.00';
  const tariff = feeByName(items, 'tariff')?.line_total || '0.00';
  const markup = feeByName(items, 'coordination')?.line_total || '0.00';
  return `<div class="quote-builder quote-internal-sheet full" id="quoteLineEditor" data-markup-percent="${markupPercent}" data-sales-tax-rate="${salesTaxRate}">
    <div class="quote-sheet-note">Build the quote here just like the spreadsheet: equipment first, then shipping/tariff/tax/markup, then labor estimate and terms.</div>

    <section class="quote-sheet-section">
      <div class="quote-section-title">Equipment & Materials</div>
      <div class="quote-sheet-head equipment-head"><span>Item</span><span>Description</span><span>Qty</span><span>Unit Price</span><span>Line Total</span><span>Tax</span><span></span></div>
      <div id="quoteEquipmentRows">${(equipment.length ? equipment : [{kind:'equipment', name:'', description:'', quantity:'1.00', unit_price:'0.00', line_total:'0.00', taxable:true}]).map(quoteEquipmentRowHtml).join('')}</div>
      <div class="quote-toolbar sheet-toolbar"><button class="mini" type="button" id="addEquipmentLine">+ Equipment/Material Row</button></div>
      <div class="quote-sheet-totals">
        <label>Equipment Subtotal<input id="equipmentSubtotalDisplay" readonly value="$0.00"></label>
        <label>Shipping & Freight<input id="quoteShippingInput" type="number" min="0" step="0.01" value="${escapeHtml(shipping)}"></label>
        <label>Tariff Surcharge<input id="quoteTariffInput" type="number" min="0" step="0.01" value="${escapeHtml(tariff)}"></label>
        <label>Sales Tax<input id="quoteTaxDisplay" readonly value="$0.00"></label>
        <label>Markup / Project Coordination %<input id="quoteMarkupPercentInput" type="number" min="0" step="0.01" value="${escapeHtml(markupPercent)}"></label>
        <label>Project Coordination & Logistics<input id="quoteMarkupDisplay" readonly value="${escapeHtml(Number(markup || 0).toFixed(2))}"></label>
        <label class="strong-total">Total Equipment Cost<input id="quoteEquipmentTotalDisplay" readonly value="$0.00"></label>
      </div>
    </section>

    <section class="quote-sheet-section">
      <div class="quote-section-title">Labor – Installation & Configuration (Estimate)</div>
      <div class="quote-sheet-head labor-head"><span>Service</span><span>Description</span><span>Hours</span><span>Rate</span><span>Line Total</span><span></span></div>
      <div id="quoteLaborRows">${(labor.length ? labor : [{kind:'labor', name:'', description:'', quantity:'0.00', unit_price:laborRate, line_total:'0.00', taxable:false}]).map(quoteLaborRowHtml).join('')}</div>
      <div class="quote-toolbar sheet-toolbar"><button class="mini" type="button" id="addLaborLine">+ Labor Row</button></div>
      <div class="quote-sheet-totals labor-summary">
        <label>Estimated Labor Total<input id="quoteLaborTotalDisplay" readonly value="$0.00"></label>
        <label class="strong-total">Estimated Grand Total<input id="quoteGrandTotalDisplay" readonly value="$0.00"></label>
      </div>
    </section>

    <section class="quote-sheet-section quote-approval-preview">
      <div class="quote-section-title">Client Approval & Authorization</div>
      <p class="quote-sheet-note">By signing below, the client acknowledges and agrees to the scope, pricing, and payment terms outlined in this quote.</p>
      <div class="signature-grid"><span>Client Name: ________________________________</span><span>Signature: ________________________________</span><span>Date: ____________________</span></div>
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

  const shipping = numberValue(editor.querySelector('#quoteShippingInput')?.value, 0);
  const tariff = numberValue(editor.querySelector('#quoteTariffInput')?.value, 0);
  const markup = numberValue(editor.querySelector('#quoteMarkupDisplay')?.value, 0);
  const baseOrder = items.length * 10;
  if (shipping > 0) items.push({quote_id:Number(quoteId || 0), kind:'fee', name:'Shipping & Freight', description:'Shipping and freight for quoted equipment/materials.', quantity:'1.00', unit_price:decimalString(shipping), line_total:decimalString(shipping), taxable:true, sort_order:baseOrder + 10});
  if (tariff > 0) items.push({quote_id:Number(quoteId || 0), kind:'fee', name:'Tariff Surcharge', description:'Tariff or surcharge applied to quoted equipment/materials.', quantity:'1.00', unit_price:decimalString(tariff), line_total:decimalString(tariff), taxable:true, sort_order:baseOrder + 20});
  if (markup > 0) items.push({quote_id:Number(quoteId || 0), kind:'fee', name:'Project Coordination & Logistics', description:'Procurement, coordination, logistics, and handling.', quantity:'1.00', unit_price:decimalString(markup), line_total:decimalString(markup), taxable:false, sort_order:baseOrder + 30});
  return items;
}
function calculateQuoteTotals(items, salesTaxRate=0.07) {
  const equipmentSubtotal = items.filter(i => normalizeKind(i.kind) === 'equipment').reduce((sum, item) => sum + numberValue(item.line_total), 0);
  const laborTotal = items.filter(i => normalizeKind(i.kind) === 'labor').reduce((sum, item) => sum + numberValue(item.line_total), 0);
  const shipping = feeByName(items, 'shipping') ? numberValue(feeByName(items, 'shipping').line_total) : 0;
  const tariff = feeByName(items, 'tariff') ? numberValue(feeByName(items, 'tariff').line_total) : 0;
  const taxableBase = equipmentSubtotal + shipping + tariff;
  const tax = taxableBase * Number(salesTaxRate || 0);
  const existingMarkup = feeByName(items, 'coordination') ? numberValue(feeByName(items, 'coordination').line_total) : 0;
  const markup = existingMarkup;
  const subtotal = equipmentSubtotal + shipping + tariff + markup + laborTotal;
  const equipmentTotal = equipmentSubtotal + shipping + tariff + tax + markup;
  return { subtotal, tax, total: subtotal + tax, equipmentSubtotal, shipping, tariff, markup, equipmentTotal, laborTotal, taxableBase };
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
  const equipmentSubtotal = [...editor.querySelectorAll('.quote-line-row[data-kind="equipment"]')].reduce((sum, row) => sum + numberValue(row.querySelector('[name="line_total"]')?.value, 0), 0);
  const shipping = numberValue(editor.querySelector('#quoteShippingInput')?.value, 0);
  const tariff = numberValue(editor.querySelector('#quoteTariffInput')?.value, 0);
  const taxRate = Number(editor.dataset.salesTaxRate || 0);
  const tax = (equipmentSubtotal + shipping + tariff) * taxRate;
  const markupPercent = numberValue(editor.querySelector('#quoteMarkupPercentInput')?.value, numberValue(editor.dataset.markupPercent, 0));
  const markup = (equipmentSubtotal + shipping + tariff + tax) * (markupPercent / 100);
  const markupInput = editor.querySelector('#quoteMarkupDisplay');
  if (markupInput) markupInput.value = markup.toFixed(2);
  const items = collectQuoteLineItems(editor);
  const totals = calculateQuoteTotals(items, taxRate);
  const setTextInput = (selector, value, asMoney=true) => { const el = editor.querySelector(selector); if (el) el.value = asMoney ? money(value) : Number(value).toFixed(2); };
  setTextInput('#equipmentSubtotalDisplay', totals.equipmentSubtotal);
  setTextInput('#quoteTaxDisplay', totals.tax);
  setTextInput('#quoteEquipmentTotalDisplay', totals.equipmentTotal);
  setTextInput('#quoteLaborTotalDisplay', totals.laborTotal);
  setTextInput('#quoteGrandTotalDisplay', totals.total);
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
  const addEquipment = () => { equipmentRows.insertAdjacentHTML('beforeend', quoteEquipmentRowHtml({kind:'equipment', quantity:'1.00', unit_price:'0.00', line_total:'0.00', taxable:true})); wireQuoteLineEditor(container); recalcQuoteEditor(container); };
  const addLabor = () => { const rate = container.querySelector('[name="hourly_rate"]')?.value || '100.00'; laborRows.insertAdjacentHTML('beforeend', quoteLaborRowHtml({kind:'labor', quantity:'1.00', unit_price:rate, line_total:rate, taxable:false})); wireQuoteLineEditor(container); recalcQuoteEditor(container); };
  editor.querySelector('#addEquipmentLine')?.addEventListener('click', addEquipment, { once:true });
  editor.querySelector('#addLaborLine')?.addEventListener('click', addLabor, { once:true });
  editor.querySelectorAll('input,select,textarea').forEach(el => el.oninput = () => recalcQuoteEditor(container));
  editor.querySelectorAll('.quote-remove-line').forEach(btn => btn.onclick = () => { btn.closest('.quote-line-row')?.remove(); recalcQuoteEditor(container); });
  recalcQuoteEditor(container);
}

function invoiceLineItemsFor(editing, kind) {
  return (editing?.line_items || []).filter(item => String(item.kind) === kind);
}

function invoiceMaterialRowHtml(item={}) {
  const qty = item.quantity ?? '1.00';
  const price = item.unit_price ?? '0.00';
  const total = item.line_total ?? (Number(qty || 0) * Number(price || 0)).toFixed(2);
  return `<div class="invoice-material-row" data-kind="material">
    <input name="material_description" placeholder="Cable, keystone jacks, hardware..." value="${escapeHtml(item.description || '')}">
    <input name="material_quantity" type="number" min="0" step="0.01" value="${escapeHtml(qty)}">
    <input name="material_unit_price" type="number" min="0" step="0.01" value="${escapeHtml(price)}">
    <input name="material_line_total" readonly value="${money(total)}">
    <button class="mini danger invoice-remove-line" type="button">Remove</button>
  </div>`;
}

function invoiceCreditRowHtml(item={}) {
  const amount = item.line_total ?? item.unit_price ?? '0.00';
  const kind = ['credit','payment','adjustment'].includes(String(item.kind)) ? item.kind : 'payment';
  return `<div class="invoice-credit-row" data-kind="credit">
    <select name="credit_kind"><option value="payment" ${kind==='payment'?'selected':''}>Payment</option><option value="credit" ${kind==='credit'?'selected':''}>Credit</option><option value="adjustment" ${kind==='adjustment'?'selected':''}>Adjustment</option></select>
    <input name="credit_description" placeholder="Payment toward labor, cable credit..." value="${escapeHtml(item.description || '')}">
    <input name="credit_amount" type="number" min="0" step="0.01" value="${escapeHtml(amount)}">
    <button class="mini danger invoice-remove-line" type="button">Remove</button>
  </div>`;
}

function invoiceInternalSheetHtml({editing=null, generatedInvoiceNumber='', invoiceNumberAttrs='', scopedClientId='', clientLabel='', settings={}, formId='invoiceForm', clientSelectId='invoiceClient', projectSelectId='invoiceProject', quoteSelectId='invoiceQuote'}) {
  const companyName = settings.company_name || 'Forged Systems LLC';
  const salesTaxRate = percentSetting(settings.sales_tax_rate ?? '0.07', 0.07);
  const clientField = scopedClientId
    ? `<input type="hidden" name="client_id" value="${escapeHtml(scopedClientId)}"><label>Bill To<input readonly value="${escapeHtml(clientLabel)}"></label>`
    : `<label>Bill To<select name="client_id" id="${clientSelectId}" required>${clientOptions(editing?.client_id)}</select></label>`;
  const projectClientId = scopedClientId || editing?.client_id || '';
  const terms = invoiceTermsValue(editing?.terms, settings.default_invoice_terms);
  const materials = invoiceLineItemsFor(editing, 'material');
  const credits = (editing?.line_items || []).filter(item => ['credit','payment','adjustment'].includes(String(item.kind)));
  return `<form id="${formId}" class="invoice-internal-sheet full" data-sales-tax-rate="${salesTaxRate}">
    <div class="invoice-sheet-banner full">Invoice – Labor Services</div>
    <input type="hidden" name="subtotal" value="${escapeHtml(editing?.subtotal || '0.00')}">
    <input type="hidden" name="tax_amount" value="${escapeHtml(editing?.tax_amount || '0.00')}">
    <input type="hidden" name="total_amount" value="${escapeHtml(editing?.total_amount || '0.00')}">
    <input type="hidden" name="amount_paid" value="${escapeHtml(editing?.amount_paid || '0.00')}">
    <section class="invoice-sheet-section invoice-meta-section">
      <div class="invoice-meta-grid">
        <label>From<input readonly value="${escapeHtml(companyName)}"></label>
        <label>Invoice #<input name="invoice_number" required${invoiceNumberAttrs} value="${escapeHtml(generatedInvoiceNumber)}"></label>
        ${clientField}
        <label>Related Quote<select name="quote_id" id="${quoteSelectId}">${quoteOptions(editing?.quote_id, projectClientId, editing?.project_id)}</select></label>
        <label>Project<select name="project_id" id="${projectSelectId}">${projectOptions(editing?.project_id, projectClientId)}</select></label>
        <label>Status<select name="status"><option value="draft">Draft</option><option value="sent">Sent</option><option value="partially_paid">Partially Paid</option><option value="paid">Paid</option><option value="void">Void</option><option value="overdue">Overdue</option></select></label>
        <label>Invoice Date<input name="invoice_date" type="date" required value="${escapeHtml(editing?.invoice_date || todayIso())}"></label>
        <label>Due Date<input name="due_date" type="date" value="${escapeHtml(editing?.due_date)}"></label>
        <label class="full">Invoice Title<input name="title" required value="${escapeHtml(editing?.title || 'Labor Services')}"></label>
      </div>
    </section>

    <section class="invoice-sheet-section invoice-generator-section">
      <div class="invoice-section-title">Labor Summary <span>(Auto-pulls completed, uninvoiced entries)</span></div>
      <div class="invoice-labor-head"><span>Use</span><span>Date</span><span>Service</span><span>Hours</span><span>Rate</span><span>Line Total</span><span>Notes</span></div>
      <div class="invoice-labor-rows"><div class="invoice-empty-row">Select a client/project to load available labor.</div></div>
      <p class="invoice-sheet-note">Checked labor entries will be attached to this invoice and marked as invoiced when saved.</p>
      <div class="invoice-sheet-totals invoice-generator-totals">
        <label>Labor Total<input id="invoiceLaborTotalDisplay" readonly value="${money(editing?.subtotal || 0)}"></label>
      </div>
    </section>

    <section class="invoice-sheet-section invoice-generator-section">
      <div class="invoice-section-title">Additional Parts & Materials <span>(not reflected in the original quote)</span></div>
      <div class="invoice-material-head"><span>Description</span><span>Qty</span><span>Unit Price</span><span>Line Total</span><span></span></div>
      <div id="invoiceMaterialRows">${materials.length ? materials.map(invoiceMaterialRowHtml).join('') : ''}</div>
      <button class="mini" id="addInvoiceMaterialLine" type="button">+ Add Part / Material</button>
    </section>

    <section class="invoice-sheet-section invoice-generator-section">
      <div class="invoice-section-title">Credits / Payments Applied</div>
      <div class="invoice-credit-head"><span>Type</span><span>Description</span><span>Amount</span><span></span></div>
      <div id="invoiceCreditRows">${credits.length ? credits.map(invoiceCreditRowHtml).join('') : ''}</div>
      <button class="mini" id="addInvoiceCreditLine" type="button">+ Add Credit / Payment</button>
      <p class="invoice-sheet-note">Break out deposits, credits, and payments separately, such as payment toward labor and payment toward cable.</p>
    </section>

    <section class="invoice-sheet-section invoice-generator-section">
      <div class="invoice-section-title">Invoice Totals</div>
      <div class="invoice-sheet-totals invoice-generator-totals">
        <label>Labor Total<input id="invoiceLaborTotalDisplay2" readonly value="${money(0)}"></label>
        <label>Parts / Materials<input id="invoiceMaterialsTotalDisplay" readonly value="${money(0)}"></label>
        <label>Taxable Base<input id="invoiceTaxableBaseDisplay" readonly value="${money(0)}"></label>
        <label>Sales Tax<input id="invoiceTaxDisplay" readonly value="${money(editing?.tax_amount || 0)}"></label>
        <label class="strong-total">Invoice Total<input id="invoiceTotalDisplay" readonly value="${money(editing?.total_amount || 0)}"></label>
        <label>Credits / Payments Applied<input id="invoiceCreditsDisplay" readonly value="${money(editing?.amount_paid || 0)}"></label>
        <label class="strong-total">Balance Due<input id="invoiceBalanceDisplay" readonly value="${money((Number(editing?.total_amount || 0) - Number(editing?.amount_paid || 0)) || 0)}"></label>
      </div>
    </section>

    <section class="invoice-sheet-section invoice-generator-section">
      <div class="invoice-section-title">Payment Terms & Conditions</div>
      <label class="full"><textarea name="terms" rows="4">${escapeHtml(terms)}</textarea></label>
    </section>

    <section class="invoice-sheet-section invoice-generator-section">
      <div class="invoice-section-title">Client Approval & Acknowledgment</div>
      <p class="invoice-approval-text">By signing below, the client acknowledges the labor services, additional materials, credits/payments, and payment terms listed in this invoice.</p>
      <div class="invoice-signature-grid"><span>Client Name: _________________________________</span><span>Signature: ____________________________________</span><span>Date: _____________________</span></div>
      <label class="full">Internal Notes<textarea name="notes" rows="3">${escapeHtml(editing?.notes)}</textarea></label>
    </section>

    <div class="form-actions"><button class="primary" type="submit">${editing ? 'Update Invoice' : 'Save Invoice'}</button>${editing ? `<button class="ghost" type="button" data-action="print" data-type="invoice" data-id="${editing.id}">Print Invoice</button>` : ''}<button class="ghost invoice-cancel" type="button">Cancel</button></div>
  </form>`;
}

function invoiceLaborRowHtml(entry, currentInvoiceId=null) {
  const linkedToCurrent = currentInvoiceId && Number(entry.invoice_id) === Number(currentInvoiceId);
  const checked = linkedToCurrent || (!currentInvoiceId && !entry.is_invoiced);
  return `<div class="invoice-labor-row" data-labor-id="${entry.id}" data-line-total="${Number(entry.line_total || 0)}">
    <label class="tiny-check"><input class="invoice-labor-check" type="checkbox" ${checked ? 'checked' : ''}> Use</label>
    <span>${escapeHtml(entry.work_date || '')}</span>
    <span>${escapeHtml(entry.service_type || '')}</span>
    <span>${escapeHtml(entry.hours || '0.00')}</span>
    <span>${money(entry.hourly_rate || 0)}</span>
    <span>${money(entry.line_total || 0)}</span>
    <span class="invoice-notes-cell">${escapeHtml(entry.notes || '')}</span>
  </div>`;
}

function wireInvoiceLineEditor(container) {
  const form = container.querySelector('.invoice-internal-sheet');
  if (!form) return;
  const materialRows = form.querySelector('#invoiceMaterialRows');
  const creditRows = form.querySelector('#invoiceCreditRows');
  form.querySelector('#addInvoiceMaterialLine')?.addEventListener('click', () => {
    materialRows?.insertAdjacentHTML('beforeend', invoiceMaterialRowHtml({quantity:'1.00', unit_price:'0.00', line_total:'0.00'}));
    wireInvoiceLineEditor(container); recalcInvoiceEditor(container);
  }, { once: true });
  form.querySelector('#addInvoiceCreditLine')?.addEventListener('click', () => {
    creditRows?.insertAdjacentHTML('beforeend', invoiceCreditRowHtml({kind:'payment', line_total:'0.00'}));
    wireInvoiceLineEditor(container); recalcInvoiceEditor(container);
  }, { once: true });
  form.querySelectorAll('.invoice-remove-line').forEach(btn => btn.onclick = () => { btn.closest('.invoice-material-row,.invoice-credit-row')?.remove(); recalcInvoiceEditor(container); });
  form.querySelectorAll('#invoiceMaterialRows input,#invoiceMaterialRows select,#invoiceCreditRows input,#invoiceCreditRows select').forEach(el => el.oninput = () => recalcInvoiceEditor(container));
}

function recalcInvoiceEditor(container) {
  const form = container.querySelector('.invoice-internal-sheet');
  if (!form) return {subtotal:0,tax:0,total:0,paid:0,balance:0,laborIds:[],lineItems:[]};
  const selectedRows = [...form.querySelectorAll('.invoice-labor-row')].filter(row => row.querySelector('.invoice-labor-check')?.checked);
  const laborTotal = selectedRows.reduce((sum, row) => sum + Number(row.dataset.lineTotal || 0), 0);
  const lineItems = [];
  let materialsTotal = 0;
  [...form.querySelectorAll('.invoice-material-row')].forEach((row, index) => {
    const description = row.querySelector('[name="material_description"]')?.value?.trim() || '';
    const quantity = Number(row.querySelector('[name="material_quantity"]')?.value || 0);
    const unitPrice = Number(row.querySelector('[name="material_unit_price"]')?.value || 0);
    const lineTotal = quantity * unitPrice;
    const display = row.querySelector('[name="material_line_total"]');
    if (display) display.value = money(lineTotal);
    materialsTotal += lineTotal;
    if (description || lineTotal > 0) lineItems.push({kind:'material', description: description || 'Additional parts/materials', quantity: decimalString(quantity), unit_price: decimalString(unitPrice), line_total: decimalString(lineTotal), taxable: true, sort_order: (index + 1) * 10});
  });
  let paid = 0;
  [...form.querySelectorAll('.invoice-credit-row')].forEach((row, index) => {
    const kind = row.querySelector('[name="credit_kind"]')?.value || 'payment';
    const description = row.querySelector('[name="credit_description"]')?.value?.trim() || statusLabel(kind);
    const amount = Number(row.querySelector('[name="credit_amount"]')?.value || 0);
    paid += amount;
    if (description || amount > 0) lineItems.push({kind, description, quantity: '1.00', unit_price: decimalString(amount), line_total: decimalString(amount), taxable: false, sort_order: 1000 + ((index + 1) * 10)});
  });
  const subtotal = laborTotal + materialsTotal;
  const taxRate = percentSetting(form.dataset.salesTaxRate || '0.07', 0.07);
  const taxableBase = subtotal;
  const tax = taxableBase * taxRate;
  const total = subtotal + tax;
  const balance = total - paid;
  const laborIds = selectedRows.map(row => Number(row.dataset.laborId)).filter(Boolean);
  const setVal = (name, value) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.value = decimalString(value); };
  setVal('subtotal', subtotal); setVal('tax_amount', tax); setVal('total_amount', total); setVal('amount_paid', paid);
  const display = (selector, value) => { form.querySelectorAll(selector).forEach(el => el.value = money(value)); };
  display('#invoiceLaborTotalDisplay', laborTotal);
  display('#invoiceLaborTotalDisplay2', laborTotal);
  display('#invoiceMaterialsTotalDisplay', materialsTotal);
  display('#invoiceTaxableBaseDisplay', taxableBase);
  display('#invoiceTaxDisplay', tax);
  display('#invoiceTotalDisplay', total);
  display('#invoiceCreditsDisplay', paid);
  display('#invoiceBalanceDisplay', balance);
  return {subtotal, tax, total, paid, balance, laborIds, lineItems};
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
      : '<div class="invoice-empty-row">No completed uninvoiced labor found for this selection.</div>';
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

function setMobileNav(open) {
  document.body.classList.toggle('mobile-nav-open', open);
  const btn = document.querySelector('#mobileMenuBtn');
  if (btn) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    btn.textContent = open ? '×' : '☰';
  }
}

function closeMobileNav() {
  setMobileNav(false);
}

function toggleMobileNav() {
  setMobileNav(!document.body.classList.contains('mobile-nav-open'));
}

async function navigateFromSidebar(page) {
  closeMobileNav();
  if (state.page === page && root.innerHTML.trim()) return;
  await loadPage(page);
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
  if (!confirm('Restore this backup now? This only runs during initial setup.')) return;
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
    if (userBtn) userBtn.textContent = state.user?.full_name ? `User: ${state.user.full_name}` : 'User';
  } catch {
    state.user = null;
    const userBtn = document.querySelector('#userBtn');
    if (userBtn) userBtn.textContent = 'User';
  }
}

function closeUserModal() {
  document.querySelector('#userProfileModal')?.remove();
}

async function openUserModal() {
  await refreshCurrentUser();
  if (!state.user) { alert('Please sign in again.'); return; }
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
      alert(err.message);
    }
  });
  setTimeout(() => form.querySelector('input[name="full_name"]')?.focus(), 0);
}

async function preloadLookups(force=false) {
  const now = Date.now();
  if (!force && state.lookupCachePromise && now - state.lookupCacheAt < 30000) return state.lookupCachePromise;
  state.lookupCachePromise = (async () => {
    const [clients, projects, quotes, invoices, ledgerCategories, serviceTypes] = await Promise.allSettled([
      api('/api/clients?page_size=100'),
      api('/api/projects?page_size=100'),
      api('/api/quotes?page_size=100'),
      api('/api/invoices?page_size=100'),
      api('/api/dropdowns?kind=ledger_category&page_size=100'),
      api('/api/dropdowns?kind=service_type&page_size=100'),
    ]);
    state.clients = clients.status === 'fulfilled' ? clients.value.items : [];
    state.projects = projects.status === 'fulfilled' ? projects.value.items : [];
    state.quotes = quotes.status === 'fulfilled' ? quotes.value.items : [];
    state.invoices = invoices.status === 'fulfilled' ? invoices.value.items : [];
    state.dropdowns.ledger_category = ledgerCategories.status === 'fulfilled' ? ledgerCategories.value.items : [];
    state.dropdowns.service_type = serviceTypes.status === 'fulfilled' ? serviceTypes.value.items : [];
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
  state.page = page; state.editing = null; state.clientDetailId = null;
  root.innerHTML = '<div class="panel"><p class="muted">Loading...</p></div>';
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.page === page));
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


async function printRecord(type, id) {
  if (type === 'quote') return printQuote(id);
  if (type === 'invoice') return printInvoice(id);
  if (type === 'ledger') return printLedger(id);
}

function printWindow(title, bodyHtml) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><base href="${window.location.origin}/"><style>
    body{font-family:Arial, sans-serif;color:#111827;margin:32px;font-size:13px} h1,h2,h3{margin:0 0 8px}.muted{color:#52627a}.banner{background:#3f4a57;color:white;font-weight:700;padding:6px 8px;margin:18px 0 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:12px 0}.box{border:1px solid #d1d5db;padding:8px}.right{text-align:right}.total{font-weight:700;background:#eaf5fb}.print-section{break-inside:avoid;margin-top:18px}.page-break{break-before:page}table{width:100%;border-collapse:collapse;margin:0 0 14px}th{background:#4b5563;color:white;text-align:left}th,td{border:1px solid #d1d5db;padding:6px;vertical-align:top}.terms p{margin:6px 0}.signature-line{display:inline-block;border-bottom:1px solid #111827;min-width:260px;margin-left:8px}.receipt-print-page{display:block;width:100%;max-width:760px;height:auto;margin:14px auto;border:1px solid #d1d5db;box-shadow:0 1px 3px rgba(15,23,42,.12);background:white}.receipt-original-link{font-size:12px;color:#52627a;margin-top:8px}.no-print{margin-bottom:16px;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;background:#f8fafc;cursor:pointer}@media print{.no-print,.receipt-original-link{display:none}body{margin:18mm}.page-break{break-before:page}.receipt-print-page{max-width:100%;width:100%;break-inside:avoid;page-break-inside:avoid;box-shadow:none}.receipt-page-wrapper{break-before:auto}.receipt-page-wrapper + .receipt-page-wrapper{break-before:page}}
  </style></head><body><button id="printBtn" class="no-print" type="button">Print</button>${bodyHtml}</body></html>`;
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    alert('Popup blocked. Allow popups for Forged Systems Tracking to print.');
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
}


function defaultQuoteTerms(terms) {
  return quoteTermsValue(terms, DEFAULT_QUOTE_TERMS).split('\n').filter(Boolean);
}


async function receiptPrintSection(receiptId) {
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
    return `<section class="print-section page-break"><h2>Receipt</h2>${meta}${preview}<p class="receipt-original-link"><a href="${downloadUrl}">Download original receipt</a></p></section>`;
  } catch (err) {
    return `<section class="print-section"><h2>Receipt</h2><p>Unable to load attached receipt: ${escapeHtml(err.message || 'Unknown error')}</p></section>`;
  }
}

async function quotePrintSection(id, { pageBreak=false } = {}) {
  if (!id) return '';
  await preloadLookups();
  let quote = state.quotes.find(q => Number(q.id) === Number(id));
  if (!quote) quote = (await api('/api/quotes?page_size=100')).items.find(q => Number(q.id) === Number(id));
  if (!quote) return '<section class="print-section"><h2>Associated Quote</h2><p>Quote not found.</p></section>';
  const settings = (await api('/api/admin/settings')).settings || {};
  const items = (await api(`/api/quotes/${id}/line-items`)).items || [];
  const equipment = equipmentRowsFromItems(items);
  const labor = laborRowsFromItems(items);
  const totals = calculateQuoteTotals(items, percentSetting(settings.sales_tax_rate ?? '0.07', 0.07));
  const fee = n => feeByName(items, n) ? money(feeByName(items, n).line_total) : '$0.00';
  const equipmentRows = equipment.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.description)}</td><td class="right">${Number(i.quantity || 0).toFixed(2)}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.line_total)}</td></tr>`).join('') || '<tr><td colspan="5">No equipment/material lines.</td></tr>';
  const laborRows = labor.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.description)}</td><td class="right">${Number(i.quantity || 0).toFixed(2)}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.line_total)}</td></tr>`).join('') || '<tr><td colspan="5">No labor lines.</td></tr>';
  const terms = defaultQuoteTerms(quoteTermsValue(quote.terms, settings.default_quote_terms)).map(t => `<p>• ${escapeHtml(t.replace(/^[-•]\s*/, ''))}</p>`).join('');
  return `<section class="print-section ${pageBreak ? 'page-break' : ''}"><h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>Associated Quote</h2><div class="grid"><div class="box"><strong>Client</strong><br>${escapeHtml(clientName(quote.client_id))}<br>${escapeHtml(projectName(quote.project_id) || '')}</div><div class="box"><strong>Quote #:</strong> ${escapeHtml(quote.quote_number)}<br><strong>Date:</strong> ${escapeHtml(quote.quote_date || '')}<br><strong>Valid Through:</strong> ${escapeHtml(quote.valid_until || '')}<br><strong>Status:</strong> ${escapeHtml(statusLabel(quote.status))}</div></div><h2>${escapeHtml(quote.title || '')}</h2><div class="banner">Equipment & Materials</div><table><thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${equipmentRows}</tbody></table><table><tbody><tr><td>Equipment Subtotal</td><td class="right">${money(totals.equipmentSubtotal)}</td></tr><tr><td>Shipping & Freight</td><td class="right">${fee('shipping')}</td></tr><tr><td>Tariff Surcharge</td><td class="right">${fee('tariff')}</td></tr><tr><td>Sales Tax</td><td class="right">${money(totals.tax)}</td></tr><tr><td>Project Coordination & Logistics</td><td class="right">${fee('coordination')}</td></tr><tr class="total"><td>Total Equipment Cost</td><td class="right">${money(totals.equipmentTotal)}</td></tr></tbody></table><div class="banner">Labor – Installation & Configuration (Estimate)</div><table><thead><tr><th>Service</th><th>Description</th><th>Hours</th><th>Rate</th><th>Line Total</th></tr></thead><tbody>${laborRows}</tbody></table><table><tbody><tr><td>Estimated Labor Total</td><td class="right">${money(totals.laborTotal)}</td></tr><tr class="total"><td>Estimated Grand Total</td><td class="right">${money(totals.total)}</td></tr></tbody></table><div class="banner">Payment Terms & Conditions</div><div class="terms">${terms}</div></section>`;
}

async function invoicePrintSection(id, { pageBreak=false } = {}) {
  if (!id) return '';
  await preloadLookups();
  let invoice = state.invoices.find(i => Number(i.id) === Number(id));
  if (!invoice) invoice = (await api('/api/invoices?page_size=100')).items.find(i => Number(i.id) === Number(id));
  if (!invoice) return '<section class="print-section"><h2>Associated Invoice</h2><p>Invoice not found.</p></section>';
  const settings = (await api('/api/admin/settings')).settings || {};
  const labor = (await api(`/api/labor?page_size=100`)).items.filter(l => Number(l.invoice_id) === Number(id));
  const laborRows = labor.map(l => `<tr><td>${escapeHtml(l.work_date)}</td><td>${escapeHtml(l.service_type)}</td><td>${escapeHtml(l.notes || '')}</td><td class="right">${Number(l.hours || 0).toFixed(2)}</td><td class="right">${money(l.hourly_rate)}</td><td class="right">${money(l.line_total)}</td></tr>`).join('') || `<tr><td colspan="6">${escapeHtml(invoice.notes || 'Labor services')}</td></tr>`;
  const lineItems = invoice.line_items || [];
  const materials = lineItems.filter(item => item.kind === 'material');
  const credits = lineItems.filter(item => ['credit','payment','adjustment'].includes(String(item.kind)));
  const materialRows = materials.map(item => `<tr><td>${escapeHtml(item.description)}</td><td class="right">${Number(item.quantity || 0).toFixed(2)}</td><td class="right">${money(item.unit_price)}</td><td class="right">${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="4">No additional parts or materials.</td></tr>`;
  const creditRows = credits.map(item => `<tr><td>${escapeHtml(statusLabel(item.kind))}</td><td>${escapeHtml(item.description)}</td><td class="right">-${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="3">No credits or payments applied.</td></tr>`;
  const materialsTotal = materials.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const laborTotal = labor.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
  const terms = invoiceTermsValue(invoice.terms, settings.default_invoice_terms).split('\n').filter(Boolean).map(t => `<p>• ${escapeHtml(t.replace(/^[-•]\s*/, ''))}</p>`).join('');
  return `<section class="print-section ${pageBreak ? 'page-break' : ''}"><h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>Associated Invoice</h2><div class="grid"><div class="box"><strong>Bill To</strong><br>${escapeHtml(clientName(invoice.client_id))}<br>${escapeHtml(projectName(invoice.project_id) || '')}</div><div class="box"><strong>Invoice #:</strong> ${escapeHtml(invoice.invoice_number)}<br><strong>Date:</strong> ${escapeHtml(invoice.invoice_date || '')}<br><strong>Due:</strong> ${escapeHtml(invoice.due_date || '')}<br><strong>Status:</strong> ${escapeHtml(statusLabel(invoice.status))}</div></div><h2>${escapeHtml(invoice.title || 'Labor Services')}</h2><div class="banner">Labor Summary</div><table><thead><tr><th>Date</th><th>Service</th><th>Description</th><th>Hours</th><th>Rate</th><th>Line Total</th></tr></thead><tbody>${laborRows}</tbody></table><div class="banner">Additional Parts & Materials</div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${materialRows}</tbody></table><div class="banner">Credits / Payments Applied</div><table><thead><tr><th>Type</th><th>Description</th><th>Amount</th></tr></thead><tbody>${creditRows}</tbody></table><table><tbody><tr><td>Labor Total</td><td class="right">${money(laborTotal)}</td></tr><tr><td>Parts / Materials</td><td class="right">${money(materialsTotal)}</td></tr><tr><td>Sales Tax</td><td class="right">${money(invoice.tax_amount)}</td></tr><tr class="total"><td>Invoice Total</td><td class="right">${money(invoice.total_amount)}</td></tr><tr><td>Credits / Payments Applied</td><td class="right">-${money(invoice.amount_paid)}</td></tr><tr class="total"><td>Balance Due</td><td class="right">${money(invoice.balance_due)}</td></tr></tbody></table><div class="banner">Payment Terms & Conditions</div><div class="terms">${terms}</div></section>`;
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
  const fee = n => feeByName(items, n) ? money(feeByName(items, n).line_total) : '$0.00';
  const equipmentRows = equipment.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.description)}</td><td class="right">${Number(i.quantity || 0).toFixed(2)}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.line_total)}</td></tr>`).join('') || '<tr><td colspan="5">No equipment/material lines.</td></tr>';
  const laborRows = labor.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.description)}</td><td class="right">${Number(i.quantity || 0).toFixed(2)}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.line_total)}</td></tr>`).join('') || '<tr><td colspan="5">No labor lines.</td></tr>';
  const terms = defaultQuoteTerms(quoteTermsValue(quote.terms, settings.default_quote_terms)).map(t => `<p>• ${escapeHtml(t.replace(/^[-•]\s*/, ''))}</p>`).join('');
  printWindow(`Quote ${quote.quote_number}`, `<h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>Quote</h2><div class="grid"><div class="box"><strong>Client</strong><br>${escapeHtml(clientName(quote.client_id))}<br>${escapeHtml(projectName(quote.project_id) || '')}</div><div class="box"><strong>Quote #:</strong> ${escapeHtml(quote.quote_number)}<br><strong>Date:</strong> ${escapeHtml(quote.quote_date || '')}<br><strong>Valid Through:</strong> ${escapeHtml(quote.valid_until || '')}</div></div><h2>${escapeHtml(quote.title || '')}</h2><div class="banner">Equipment & Materials</div><table><thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${equipmentRows}</tbody></table><table><tbody><tr><td>Equipment Subtotal</td><td class="right">${money(totals.equipmentSubtotal)}</td></tr><tr><td>Shipping & Freight</td><td class="right">${fee('shipping')}</td></tr><tr><td>Tariff Surcharge</td><td class="right">${fee('tariff')}</td></tr><tr><td>Sales Tax</td><td class="right">${money(totals.tax)}</td></tr><tr><td>Project Coordination & Logistics</td><td class="right">${fee('coordination')}</td></tr><tr class="total"><td>Total Equipment Cost</td><td class="right">${money(totals.equipmentTotal)}</td></tr></tbody></table><div class="banner">Labor – Installation & Configuration (Estimate)</div><table><thead><tr><th>Service</th><th>Description</th><th>Hours</th><th>Rate</th><th>Line Total</th></tr></thead><tbody>${laborRows}</tbody></table><table><tbody><tr><td>Estimated Labor Total</td><td class="right">${money(totals.laborTotal)}</td></tr><tr class="total"><td>Estimated Grand Total</td><td class="right">${money(totals.total)}</td></tr></tbody></table><div class="banner">Payment Terms & Conditions</div><div class="terms">${terms}</div><div class="banner">Client Approval & Authorization</div><p>By signing below, the client acknowledges and agrees to the scope, pricing, and payment terms outlined in this quote.</p><p>Client Name:<span class="signature-line"></span></p><p>Signature:<span class="signature-line"></span></p><p>Date:<span class="signature-line"></span></p>`);
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
  const credits = lineItems.filter(item => ['credit','payment','adjustment'].includes(String(item.kind)));
  const materialRows = materials.map(item => `<tr><td>${escapeHtml(item.description)}</td><td class="right">${Number(item.quantity || 0).toFixed(2)}</td><td class="right">${money(item.unit_price)}</td><td class="right">${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="4">No additional parts or materials.</td></tr>`;
  const creditRows = credits.map(item => `<tr><td>${escapeHtml(statusLabel(item.kind))}</td><td>${escapeHtml(item.description)}</td><td class="right">-${money(item.line_total)}</td></tr>`).join('') || `<tr><td colspan="3">No credits or payments applied.</td></tr>`;
  const materialsTotal = materials.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const laborTotal = labor.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
  const terms = invoiceTermsValue(invoice.terms, settings.default_invoice_terms).split('\n').filter(Boolean).map(t => `<p>• ${escapeHtml(t.replace(/^[-•]\s*/, ''))}</p>`).join('');
  printWindow(`Invoice ${invoice.invoice_number}`, `<h1>${escapeHtml(settings.company_name || 'Forged Systems LLC')}</h1><h2>Invoice</h2><div class="grid"><div class="box"><strong>Bill To</strong><br>${escapeHtml(clientName(invoice.client_id))}<br>${escapeHtml(projectName(invoice.project_id) || '')}</div><div class="box"><strong>Invoice #:</strong> ${escapeHtml(invoice.invoice_number)}<br><strong>Date:</strong> ${escapeHtml(invoice.invoice_date || '')}<br><strong>Due:</strong> ${escapeHtml(invoice.due_date || '')}<br><strong>Status:</strong> ${escapeHtml(statusLabel(invoice.status))}</div></div><h2>${escapeHtml(invoice.title || 'Labor Services')}</h2><div class="banner">Labor Summary</div><table><thead><tr><th>Date</th><th>Service</th><th>Description</th><th>Hours</th><th>Rate</th><th>Line Total</th></tr></thead><tbody>${laborRows}</tbody></table><div class="banner">Additional Parts & Materials</div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${materialRows}</tbody></table><div class="banner">Credits / Payments Applied</div><table><thead><tr><th>Type</th><th>Description</th><th>Amount</th></tr></thead><tbody>${creditRows}</tbody></table><table><tbody><tr><td>Labor Total</td><td class="right">${money(laborTotal)}</td></tr><tr><td>Parts / Materials</td><td class="right">${money(materialsTotal)}</td></tr><tr><td>Sales Tax</td><td class="right">${money(invoice.tax_amount)}</td></tr><tr class="total"><td>Invoice Total</td><td class="right">${money(invoice.total_amount)}</td></tr><tr><td>Credits / Payments Applied</td><td class="right">-${money(invoice.amount_paid)}</td></tr><tr class="total"><td>Balance Due</td><td class="right">${money(invoice.balance_due)}</td></tr></tbody></table><div class="banner">Payment Terms & Conditions</div><div class="terms">${terms}</div><div class="banner">Client Approval & Acknowledgment</div><p>Client Name:<span class="signature-line"></span></p><p>Signature:<span class="signature-line"></span></p><p>Date:<span class="signature-line"></span></p>`);
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

function attachPrintActions(scope=root) {
  scope.querySelectorAll('[data-action="print"]').forEach(btn => {
    btn.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      try { await printRecord(btn.dataset.type, Number(btn.dataset.id)); }
      catch (err) { alert(err.message || 'Unable to print.'); }
    };
  });
}

function attachRowActions() {
  attachPrintActions(root);
  root.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      try { await editRecord(btn.dataset.type, Number(btn.dataset.id)); }
      catch (err) { alert(err.message || 'Unable to open edit form.'); }
    };
  });
  root.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      try { await deleteRecord(btn.dataset.type, Number(btn.dataset.id)); }
      catch (err) { alert(err.message || 'Unable to delete record.'); }
    };
  });
}

function attachProjectRowClicks() {
  root.querySelectorAll('.projects-table .project-record-row[data-project-id]').forEach(row => {
    const open = () => editRecord('project', Number(row.dataset.projectId));
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
    const open = () => editRecord('quote', Number(row.dataset.quoteId));
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

function attachInvoiceRowClicks() {
  root.querySelectorAll('.invoices-table .invoice-record-row[data-invoice-id]').forEach(row => {
    const open = () => editRecord('invoice', Number(row.dataset.invoiceId));
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

function attachLedgerRowClicks() {
  root.querySelectorAll('.ledger-table .ledger-record-row[data-ledger-id]').forEach(row => {
    const open = () => editRecord('ledger', Number(row.dataset.ledgerId));
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

function attachLaborRowClicks() {
  root.querySelectorAll('.labor-table .labor-record-row[data-labor-id]').forEach(row => {
    const open = () => editRecord('labor', Number(row.dataset.laborId));
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
async function deleteRecord(type, id) {
  const names = {client:'client', project:'project', quote:'quote', invoice:'invoice', ledger:'ledger entry', labor:'labor entry', receipt:'receipt'};
  if (!confirm(`Delete this ${names[type]}? This cannot be undone.`)) return;
  try {
    const paths = {client:`/api/clients/${id}`, project:`/api/projects/${id}`, quote:`/api/quotes/${id}`, invoice:`/api/invoices/${id}`, ledger:`/api/ledger/${id}`, labor:`/api/labor/${id}`, receipt:`/api/receipts/${id}`};
    const clientId = state.clientDetailId;
    const clientTab = state.clientDetailTab;
    await api(paths[type], { method:'DELETE' });
    show(`${names[type]} deleted`);
    if (clientId && type !== 'client') {
      const typeMap = { project: 'projects', quote: 'quotes', invoice: 'invoices', ledger: 'ledger', labor: 'labor', receipt: 'receipts' };
      await renderClientDetail(Number(clientId), typeMap[type] || clientTab || 'overview');
    } else {
      await loadPage(state.page);
    }
  } catch (err) { alert(err.message); }
}
async function editRecord(type, id) {
  state.editing = { type, id };
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


async function renderClients(editId=null) {
  const data = await api('/api/clients?page_size=100');
  const editing = editId ? data.items.find(c => c.id === editId) : null;
  const formTitle = editing ? 'Edit Client' : 'Add Client';
  const hasSeparateBilling = Boolean(editing?.billing_address && editing?.billing_address !== editing?.site_address);
  const clientRows = data.items.map(c => [
    `<strong>${escapeHtml(c.name)}</strong>`,
    escapeHtml(c.contact_name),
    escapeHtml(c.email),
    escapeHtml(c.phone),
    escapeHtml(c.site_address),
    `<span class="status ${c.is_active ? '' : 'muted-status'}">${c.is_active ? 'Active' : 'Inactive'}</span>`,
    rowActions('client', c.id),
  ]);

  root.innerHTML = `<div class="page-actions"><div class="search-row"><label class="search-field">Search Clients<input id="clientSearch" type="search" placeholder="Search name, contact, email, phone, or address..."></label><label class="filter-field">Status<select id="clientStatusFilter"><option value="all">All</option><option value="active" selected>Active</option><option value="inactive">Inactive</option></select></label></div><button class="primary" id="openClientModal" type="button">+ Add Client</button></div>
  <div class="panel list-panel"><div class="table-wrap client-table"><table id="clientsTable"><thead><tr>${['Name','Contact','Email','Phone','Primary Site','Status','Actions'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${clientRows.length ? clientRows.map((r, idx)=>`<tr class="clickable-row client-record-row" data-client-id="${data.items[idx].id}" data-active="${data.items[idx].is_active ? 'active' : 'inactive'}" data-search="${escapeHtml(Object.values(data.items[idx]).join(' ').toLowerCase())}">${r.map((c, cellIndex)=>`<td data-label="${['Name','Contact','Email','Phone','Primary Site','Status','Actions'][cellIndex]}">${c??''}</td>`).join('')}</tr>`).join('') : '<tr class="client-empty-row"><td colspan="7">No clients yet. Use + Add Client to create one.</td></tr>'}</tbody></table></div></div>
  <div id="clientModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="clientModalTitle"><div class="modal-card"><div class="modal-header"><div><h2 id="clientModalTitle">${formTitle}</h2><p>${editing ? 'Update this client record.' : 'Create a client record without leaving the list.'}</p></div><button class="ghost modal-close" id="closeClientModal" type="button" aria-label="Close client form">×</button></div><form id="clientForm" class="form-grid">
    <label class="client-field client-name-field">Client Name<input name="name" required value="${escapeHtml(editing?.name)}" placeholder="Company or household name"></label><label class="client-field">Primary Contact<input name="contact_name" value="${escapeHtml(editing?.contact_name)}" placeholder="Contact name"></label>
    <label class="client-field">Email<input name="email" type="email" value="${escapeHtml(editing?.email)}" placeholder="name@example.com"></label><label class="client-field">Phone<input name="phone" value="${escapeHtml(editing?.phone)}" placeholder="(555) 555-5555"></label>
    <label class="client-field client-address-field">Primary Site Address<textarea name="site_address" rows="2" placeholder="Main job/site address for this client">${escapeHtml(editing?.site_address)}</textarea></label>
    <label class="check-row client-billing-toggle"><input id="separateBilling" type="checkbox" ${hasSeparateBilling ? 'checked' : ''}> Separate billing address</label>
    <label id="billingAddressField" class="full client-field client-address-field ${hasSeparateBilling ? '' : 'hidden'}">Billing Address<textarea name="billing_address" rows="3" placeholder="Billing address">${escapeHtml(editing?.billing_address)}</textarea></label>
    <label class="check-row client-active-toggle"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? 'checked' : ''}> Active Client</label>
    <div class="form-actions client-modal-actions"><button class="ghost" type="button" id="cancelClientModal">Cancel</button><button class="primary" type="submit">${editing ? 'Update Client' : 'Save Client'}</button></div>
  </form></div></div>`;

  const modal = document.querySelector('#clientModal');
  const separateBillingToggle = document.querySelector('#separateBilling');
  const billingAddressField = document.querySelector('#billingAddressField');
  const openModal = () => { modal.classList.remove('hidden'); setTimeout(() => clientForm.querySelector('input[name="name"]')?.focus(), 0); };
  const closeModal = () => renderClients();
  openClientModal.onclick = () => renderClients();
  openClientModal.onclick = openModal;
  closeClientModal.onclick = closeModal;
  cancelClientModal.onclick = closeModal;
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function escClose(e) { if (e.key === 'Escape' && !modal.classList.contains('hidden')) { document.removeEventListener('keydown', escClose); closeModal(); } });
  separateBillingToggle.onchange = () => {
    billingAddressField.classList.toggle('hidden', !separateBillingToggle.checked);
    if (!separateBillingToggle.checked) clientForm.elements.billing_address.value = clientForm.elements.site_address.value;
  };
  if (editing) openModal();

  const applyClientFilters = () => {
    const q = clientSearch.value.trim().toLowerCase();
    const status = clientStatusFilter.value;
    const rows = [...clientsTable.querySelectorAll('tbody tr')];
    let shown = 0;
    for (const row of rows) {
      if (!row.dataset.search) continue;
      const matchesSearch = !q || row.dataset.search.includes(q);
      const matchesStatus = status === 'all' || row.dataset.active === status;
      const showRow = matchesSearch && matchesStatus;
      row.classList.toggle('hidden', !showRow);
      if (showRow) shown += 1;
    }
    let empty = clientsTable.querySelector('[data-empty-row="true"]');
    if (!shown && data.items.length) {
      if (!empty) {
        empty = document.createElement('tr');
        empty.dataset.emptyRow = 'true';
        empty.innerHTML = '<td colspan="7">No clients match that search/filter.</td>';
        clientsTable.querySelector('tbody').appendChild(empty);
      }
      empty.classList.remove('hidden');
    } else if (empty) {
      empty.classList.add('hidden');
    }
  };
  clientSearch.addEventListener('input', applyClientFilters);
  clientStatusFilter.addEventListener('change', applyClientFilters);
  applyClientFilters();
  root.querySelectorAll('[data-client-id]').forEach(row => {
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      renderClientDetail(Number(row.dataset.clientId));
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      renderClientDetail(Number(row.dataset.clientId));
    });
  });

  clientForm.onsubmit = async e => {
    e.preventDefault();
    if (!separateBillingToggle.checked) clientForm.elements.billing_address.value = clientForm.elements.site_address.value;
    const payload = clean(formData(clientForm)); payload.is_active = formBool(clientForm, 'is_active');
    try {
      if (editing) await api(`/api/clients/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)});
      else await api('/api/clients', {method:'POST', body: JSON.stringify(payload)});
      show(editing ? 'Client updated' : 'Client saved'); await renderClients();
    } catch (err) { alert(err.message); }
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
async function renderClientDetail(clientId, tab=state.clientDetailTab || 'overview') {
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

async function renderProjects(editId=null) {
  const data = await api('/api/projects?page_size=100');
  const editing = editId ? data.items.find(p => p.id === editId) : null;
  const currentClientId = editing?.client_id || '';
  const addresses = await ensureAddresses(currentClientId);
  const finishedStatuses = new Set(['completed', 'closed', 'canceled']);
  const projectStatusFilterValue = state.projectStatusFilter || 'active';
  const visibleProjects = data.items.filter(p => {
    const status = String(p.status || '').toLowerCase();
    if (projectStatusFilterValue === 'all') return true;
    if (projectStatusFilterValue === 'finished') return finishedStatuses.has(status);
    return !finishedStatuses.has(status);
  });
  const rows = visibleProjects.map(p => [escapeHtml(p.name),escapeHtml(clientName(p.client_id)),`<span class="status">${statusLabel(p.status)}</span>`,escapeHtml(p.site_address),p.start_date,p.completed_date,rowActions('project', p.id)]);
  const rowAttrs = visibleProjects.map(p => `class="project-record-row" role="button" tabindex="0" data-project-id="${Number(p.id)}"`);
  root.innerHTML = `<div class="page-actions"><div class="search-row"><label class="search-field compact-search">Search<input id="projectSearch" type="search" placeholder="Search projects..."></label><label class="filter-field">Status<select id="projectStatusFilter"><option value="active">Active</option><option value="finished">Closed / Completed</option><option value="all">All Projects</option></select></label></div><button class="primary" id="openProjectModal" type="button">+ Add Project</button></div>
  ${table(['Project','Client','Status','Site Address','Start','End','Actions'], rows, 'projects-table', rowAttrs)}
  <div id="projectModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="projectModalTitle"><div class="modal-card"><div class="modal-header"><div><h2 id="projectModalTitle">${editing ? 'Edit Project' : 'Add Project'}</h2><p>${editing ? 'Update this project.' : 'Create a project and attach it to a client.'}</p></div><button class="ghost modal-close" id="closeProjectModal" type="button" aria-label="Close project form">×</button></div><form id="projectForm" class="form-grid">
    <label class="project-field">Client<select name="client_id" id="projectClient" required>${clientOptions(currentClientId)}</select></label><label class="project-field">Project Name<input name="name" required value="${escapeHtml(editing?.name)}" placeholder="Project name"></label>
    <label class="project-field">Status<select name="status"><option value="lead">Lead</option><option value="quoted">Quoted</option><option value="approved">Approved</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label>
    <label class="project-field">Start Date<input name="start_date" type="date" value="${escapeHtml(editing?.start_date)}"></label><label class="project-field">End Date<input name="completed_date" type="date" value="${escapeHtml(editing?.completed_date)}"></label>
    <label class="project-field">Site Address<select id="siteAddressSelect">${addressOptions(addresses, editing?.site_address)}</select><input type="hidden" name="site_address" id="projectSiteAddress" value="${escapeHtml(editing?.site_address)}"></label>
    <label id="newAddressWrap" class="full project-field project-address-field hidden">New Site Address<textarea id="projectNewSiteAddress" rows="2" placeholder="Enter the new site address"></textarea><span class="project-subfield-label">Address Label</span><input id="newAddressLabel" value="Site"></label>
    <label class="full project-field project-notes-field">Notes<textarea name="notes" rows="3" placeholder="Internal project notes">${escapeHtml(editing?.notes)}</textarea></label>
    <div class="form-actions project-modal-actions"><button class="ghost" type="button" id="cancelProjectModal">Cancel</button><button class="primary" type="submit">${editing ? 'Update Project' : 'Save Project'}</button></div>
  </form></div></div>`;
  projectStatusFilter.value = state.projectStatusFilter || 'active';
  projectStatusFilter.onchange = () => { state.projectStatusFilter = projectStatusFilter.value; renderProjects(); };
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
      show(editing ? 'Project updated' : 'Project saved'); await renderProjects();
    } catch (err) { alert(err.message); }
  };
  setupModal('projectModal','openProjectModal','closeProjectModal','cancelProjectModal',editing,renderProjects,'select[name="client_id"]');
  attachPageSearch('projectSearch');
  attachRowActions();
  attachProjectRowClicks();
}

async function renderQuotes(editId=null) {
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
  const quoteRows = visibleQuotes.map(q => [escapeHtml(q.quote_number),escapeHtml(q.title),escapeHtml(clientName(q.client_id)),escapeHtml(projectName(q.project_id)),`<span class="status">${statusLabel(q.status)}</span>`,q.quote_date,q.valid_until,money(q.total_amount),rowActions('quote', q.id)]);
  const quoteRowAttrs = visibleQuotes.map(q => `class="quote-record-row" role="button" tabindex="0" data-quote-id="${Number(q.id)}"`);
  root.innerHTML = `<div class="page-actions"><div class="toolbar quote-page-toolbar"><details class="filter-menu"><summary>Filters</summary><div class="filter-menu-panel"><label class="search-field compact-search">Search<input id="quoteSearch" type="search" placeholder="Search quotes..."></label><label class="filter-field">Status<select id="quoteStatusFilter"><option value="all">All Statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="expired">Expired</option></select></label><label class="filter-field">Client<select id="quoteClientFilter"><option value="all">All Clients</option>${quoteClientOptions}</select></label><button class="ghost" id="resetQuoteFilters" type="button">Reset Filters</button></div></details><button class="primary" id="openQuoteModal" type="button">+ Add Quote</button></div></div>
  ${table(['Quote #','Title','Client','Project','Status','Date','Valid Until','Total','Actions'], quoteRows, 'quotes-table', quoteRowAttrs)}
  <div id="quoteModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="quoteModalTitle"><div class="modal-card wide-modal"><div class="modal-header"><div><h2 id="quoteModalTitle">${editing ? 'Edit Quote' : 'Add Quote'}</h2><p>${editing ? 'Update quote details and line items.' : 'Create a quote linked to a client/project.'}</p></div><button class="ghost modal-close" id="closeQuoteModal" type="button" aria-label="Close quote form">×</button></div><form id="quoteForm" class="form-grid">
    <div class="quote-sheet-banner full">Quote – Internal Working Sheet</div>
    <div class="quote-meta-grid full">
      <label>Prepared by<input value="${escapeHtml(settings.company_name || 'Forged Systems LLC')}" disabled></label>
      <label>Quote #<input name="quote_number" required${quoteNumberAttrs} value="${escapeHtml(generatedQuoteNumber)}"></label>
      <label>Client<select name="client_id" id="quoteClient" required>${clientOptions(editing?.client_id)}</select></label>
      <label>Valid Through<input name="valid_until" type="date" value="${escapeHtml(editing?.valid_until)}"></label>
      <label>Site / Project<select name="project_id" id="quoteProject">${projectOptions(editing?.project_id, editing?.client_id)}</select></label>
      <label>Issued Date<input name="quote_date" type="date" required value="${escapeHtml(editing?.quote_date || todayIso())}"></label>
      <label>Quote Title<input name="title" required value="${escapeHtml(editing?.title)}" placeholder="Camera install quote"></label>
      <label>Status<select name="status"><option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="expired">Expired</option></select></label>
    </div>
    <input name="subtotal" type="hidden" value="${escapeHtml(editing?.subtotal || '0.00')}"><input name="tax_amount" type="hidden" value="${escapeHtml(editing?.tax_amount || '0.00')}"><input name="total_amount" type="hidden" value="${escapeHtml(editing?.total_amount || '0.00')}">
    ${quoteLineEditorHtml(existingItems, settings)}
    <div class="quote-section-title full">Payment Terms & Conditions</div>
    <label class="full">Terms<textarea name="terms" rows="6">${escapeHtml(quoteTermsValue(editing?.terms, settings.default_quote_terms))}</textarea></label>
    <div class="quote-section-title full">Internal Notes</div>
    <label class="full">Notes<textarea name="notes">${escapeHtml(editing?.notes)}</textarea></label>
    <div class="form-actions"><button class="primary" type="submit">${editing ? 'Update Quote' : 'Save Quote'}</button>${editing ? `<button class="ghost" type="button" data-action="print" data-type="quote" data-id="${editing.id}">Print Quote</button>` : ''}<button class="ghost" type="button" id="cancelQuoteModal">Cancel</button></div>
  </form></div></div>`;
  quoteStatusFilter.value = state.quoteStatusFilter || 'all';
  quoteClientFilter.value = state.quoteClientFilter || 'all';
  if (quoteStatusFilter.value !== 'all' || quoteClientFilter.value !== 'all') root.querySelector('.filter-menu')?.setAttribute('open', '');
  quoteStatusFilter.onchange = () => { state.quoteStatusFilter = quoteStatusFilter.value; renderQuotes(); };
  quoteClientFilter.onchange = () => { state.quoteClientFilter = quoteClientFilter.value; renderQuotes(); };
  resetQuoteFilters.onclick = () => { state.quoteStatusFilter = 'all'; state.quoteClientFilter = 'all'; quoteSearch.value = ''; renderQuotes(); };
  quoteForm.status.value = editing?.status || 'draft';
  quoteClient.onchange = () => { quoteProject.innerHTML = projectOptions('', quoteClient.value); };
  wireQuoteLineEditor(root);
  quoteForm.onsubmit = async e => {
    e.preventDefault();
    const payload = clean(formData(quoteForm));
    payload.client_id = Number(payload.client_id);
    numOrDelete(payload, 'project_id');
    const items = collectQuoteLineItems(root.querySelector('#quoteLineEditor'));
    const totals = recalcQuoteEditor(root);
    payload.subtotal = decimalString(totals.subtotal || 0);
    payload.tax_amount = decimalString(totals.tax || 0);
    payload.total_amount = decimalString(totals.total || 0);
    try {
      const saved = editing ? await api(`/api/quotes/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}) : await api('/api/quotes', {method:'POST', body: JSON.stringify(payload)});
      const quoteId = saved.id || editing?.id;
      const itemsWithQuote = items.map(item => ({...item, quote_id: Number(quoteId)}));
      await api(`/api/quotes/${quoteId}/line-items`, {method:'PUT', body: JSON.stringify({items: itemsWithQuote})});
      show(editing ? 'Quote updated' : 'Quote saved'); await preloadLookups(); await renderQuotes();
    } catch (err) { alert(err.message); }
  };
  setupModal('quoteModal','openQuoteModal','closeQuoteModal','cancelQuoteModal',editing,renderQuotes, editing ? 'input[name="quote_number"]' : 'input[name="title"]');
  attachPageSearch('quoteSearch');
  attachRowActions();
  attachQuoteRowClicks();
}

async function renderInvoices(editId=null) {
  const data = await api('/api/invoices?page_size=100');
  state.invoices = data.items;
  const settingsResponse = await api('/api/admin/settings');
  const settings = settingsResponse.settings || {};
  const editing = editId ? data.items.find(i => i.id === editId) : null;
  const generatedInvoiceNumber = editing?.invoice_number || await nextInvoiceNumber();
  const invoiceNumberAttrs = editing ? '' : ' readonly aria-readonly="true" title="Generated automatically to prevent duplicate invoice numbers"';
  const invoiceRows = data.items.map(i => [escapeHtml(i.invoice_number),escapeHtml(i.title),escapeHtml(clientName(i.client_id)),escapeHtml(projectName(i.project_id)),escapeHtml(quoteName(i.quote_id)),`<span class="status">${statusLabel(i.status)}</span>`,i.invoice_date,money(i.total_amount),money(i.amount_paid),money(i.balance_due),rowActions('invoice', i.id)]);
  const invoiceRowAttrs = data.items.map(i => `class="invoice-record-row" role="button" tabindex="0" data-invoice-id="${Number(i.id)}"`);
  root.innerHTML = `<div class="page-actions"><label class="search-field compact-search">Search<input id="invoiceSearch" type="search" placeholder="Search invoices..."></label><button class="primary" id="openInvoiceModal" type="button">+ Add Invoice</button></div>
  ${table(['Invoice #','Title','Client','Project','Quote','Status','Date','Total','Paid','Balance','Actions'], invoiceRows, 'invoices-table', invoiceRowAttrs)}
  <div id="invoiceModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="invoiceModalTitle"><div class="modal-card wide-modal"><div class="modal-header"><div><h2 id="invoiceModalTitle">${editing ? 'Edit Invoice' : 'Add Invoice'}</h2><p>${editing ? 'Update invoice labor and payment details.' : 'Create an invoice linked to a client/project.'}</p></div><button class="ghost modal-close" id="closeInvoiceModal" type="button" aria-label="Close invoice form">×</button></div>
    ${invoiceInternalSheetHtml({editing, generatedInvoiceNumber, invoiceNumberAttrs, settings, formId:'invoiceForm', clientSelectId:'invoiceClient', projectSelectId:'invoiceProject', quoteSelectId:'invoiceQuote'})}
  </div></div>`;
  await wireInvoiceInternalForm(root, {formId:'invoiceForm', clientSelectId:'invoiceClient', projectSelectId:'invoiceProject', quoteSelectId:'invoiceQuote', editing, onSave: async payload => { try { if (editing) await api(`/api/invoices/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/invoices', {method:'POST', body: JSON.stringify(payload)}); show(editing ? 'Invoice updated' : 'Invoice saved'); await preloadLookups(); await renderInvoices(); } catch (err) { alert(err.message); } }});
  setupModal('invoiceModal','openInvoiceModal','closeInvoiceModal','cancelInvoiceModal',editing,renderInvoices, editing ? 'input[name="invoice_number"]' : 'input[name="title"]');
  attachPageSearch('invoiceSearch');
  attachRowActions();
  attachInvoiceRowClicks();
}

async function renderLedger(editId=null) {
  const data = await api('/api/ledger?page_size=100');
  const editing = editId ? data.items.find(i => i.id === editId) : null;
  const editingKind = normalizeLedgerKind(editing?.kind);
  const editingBusinessType = editing?.business_type || 'client';
  root.innerHTML = `<div class="page-actions"><label class="search-field compact-search">Search<input id="ledgerSearch" type="search" placeholder="Search ledger..."></label><button class="primary" id="openLedgerModal" type="button">+ Add Ledger Entry</button></div>
  ${table(['Date','Account Type','Category','Amount','Client','Project','Quote','Invoice','Receipt','Description','Actions'], data.items.map(e => [e.entry_date,ledgerKindLabel(e.kind),escapeHtml(e.category),money(e.amount),escapeHtml(clientName(e.client_id)),escapeHtml(projectName(e.project_id)),escapeHtml(quoteName(e.quote_id)),escapeHtml(invoiceName(e.invoice_id)),e.receipt_id ? receiptPreviewButton(e.receipt_id) : '—',escapeHtml(e.description),rowActions('ledger', e.id)]))}
  <div id="ledgerModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="ledgerModalTitle"><div class="modal-card"><div class="modal-header"><div><h2 id="ledgerModalTitle">${editing ? 'Edit Ledger Entry' : 'Add Ledger Entry'}</h2><p>${editing ? 'Update this financial entry.' : 'Add an income, cost of goods sold, or expense entry.'}</p></div><button class="ghost modal-close" id="closeLedgerModal" type="button" aria-label="Close ledger form">×</button></div><form id="ledgerForm" class="form-grid" enctype="multipart/form-data">
    <label class="ledger-field">Date<input name="entry_date" type="date" required value="${escapeHtml(editing?.entry_date || todayIso())}"></label><label class="ledger-field">Amount<input name="amount" type="number" step="0.01" required value="${escapeHtml(editing?.amount)}"></label>
    <label class="ledger-field">Account Type<select name="kind"><option value="income">Income</option><option value="cogs">Cost of Goods Sold</option><option value="expense">Expenses</option></select></label>
    <label class="ledger-field">Business Type<select name="business_type"><option value="client">Client</option><option value="admin">Admin</option></select></label>
    <label class="ledger-field">Category<select name="category" required><option value="">Select category...</option></select></label>
    <label class="ledger-field" data-ledger-client-wrap>Client<select name="client_id" id="ledgerClient">${clientOptions(editing?.client_id)}</select></label><label class="ledger-field" data-ledger-project-wrap>Project<select name="project_id" id="ledgerProject">${projectOptions(editing?.project_id, editing?.client_id)}</select></label>
    <label class="ledger-field" data-ledger-quote-wrap>Quote<select name="quote_id">${quoteOptions(editing?.quote_id, editing?.client_id, editing?.project_id)}</select></label><label class="ledger-field" data-ledger-invoice-wrap>Invoice<select name="invoice_id">${invoiceOptions(editing?.invoice_id, editing?.client_id, editing?.project_id)}</select></label>
    <label class="full ledger-field ledger-wide-field ledger-receipt-field">Receipt Photo/PDF<input name="receipt_file" type="file" accept="image/*,application/pdf"></label>${editing?.receipt_id ? `<div class="full muted ledger-attached-receipt">Attached receipt: ${receiptPreviewButton(editing.receipt_id, 'Preview receipt')}</div>` : ''}
    <label class="full ledger-field ledger-wide-field ledger-description-field">Description<textarea name="description" rows="3" placeholder="Ledger entry details">${escapeHtml(editing?.description)}</textarea></label><div class="form-actions ledger-modal-actions"><button class="ghost" type="button" id="cancelLedgerModal">Cancel</button><button class="primary" type="submit">${editing ? 'Update Ledger Entry' : 'Save Ledger Entry'}</button></div>
  </form></div></div>`;
  const ledgerTableWrap = root.querySelector('.table-wrap');
  ledgerTableWrap?.classList.add('ledger-table');
  root.querySelectorAll('.ledger-table tbody tr').forEach((row, index) => {
    const entry = data.items[index];
    if (!entry) return;
    row.classList.add('ledger-record-row');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.dataset.ledgerId = Number(entry.id);
    row.dataset.businessType = entry.business_type || 'client';
    row.querySelectorAll('td').forEach(cell => {
      const label = cell.dataset.label;
      if (['Client', 'Project', 'Quote', 'Invoice'].includes(label) && !cell.textContent.trim()) {
        cell.classList.add('ledger-empty-link-cell');
      }
    });
  });
  ledgerForm.kind.value = editingKind; ledgerForm.business_type.value = editingBusinessType;
  configureLedgerForm(ledgerForm, { selectedCategory: editing?.category || '' });
  ledgerForm.onsubmit = async e => { e.preventDefault(); const payload = normalizeLedgerPayload(clean(formData(ledgerForm))); delete payload.receipt_file; try { await saveLedgerEntryWithReceipt(ledgerForm, payload, editing); show(editing ? 'Ledger entry updated' : 'Ledger entry saved'); await renderLedger(); } catch (err) { alert(err.message); } };
  setupModal('ledgerModal','openLedgerModal','closeLedgerModal','cancelLedgerModal',editing,renderLedger,'input[name="entry_date"]');
  attachPageSearch('ledgerSearch');
  attachRowActions();
  attachLedgerRowClicks();
}

async function renderLabor(editId=null) {
  const data = await api('/api/labor?page_size=100');
  const settingsResponse = await api('/api/admin/settings');
  const settings = settingsResponse.settings || {};
  const editing = editId ? data.items.find(i => i.id === editId) : null;
  const defaultRate = settings.default_labor_rate || '100.00';
  const laborRows = data.items.map(l => [l.work_date,escapeHtml(clientName(l.client_id)),escapeHtml(projectName(l.project_id)),escapeHtml(l.service_type),l.hours,money(l.hourly_rate),money(l.line_total),`<span class="status">${statusLabel(l.status)}</span>`,escapeHtml(invoiceName(l.invoice_id) || l.invoice_number || ''),l.is_invoiced?'Yes':'No',rowActions('labor', l.id)]);
  const laborRowAttrs = data.items.map(l => `class="labor-record-row" role="button" tabindex="0" data-labor-id="${Number(l.id)}"`);
  root.innerHTML = `<div class="page-actions"><label class="search-field compact-search">Search<input id="laborSearch" type="search" placeholder="Search labor..."></label><button class="primary" id="openLaborModal" type="button">+ Add Labor Entry</button></div>
  ${table(['Date','Client','Project','Service','Hours','Rate','Total','Status','Invoice','Invoiced','Actions'], laborRows, 'labor-table', laborRowAttrs)}
  <div id="laborModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="laborModalTitle"><div class="modal-card"><div class="modal-header"><div><h2 id="laborModalTitle">${editing ? 'Edit Labor Entry' : 'Add Labor Entry'}</h2><p>${editing ? 'Update this labor entry.' : 'Add billable or internal work for a client/project.'}</p></div><button class="ghost modal-close" id="closeLaborModal" type="button" aria-label="Close labor form">×</button></div><form id="laborForm" class="form-grid">
    <label class="labor-field">Work Date<input name="work_date" type="date" required value="${escapeHtml(editing?.work_date || todayIso())}"></label><label class="labor-field">Client<select name="client_id" id="laborClient" required>${clientOptions(editing?.client_id)}</select></label>
    <label class="labor-field">Project<select name="project_id" id="laborProject">${projectOptions(editing?.project_id, editing?.client_id)}</select></label><label class="labor-field">Status<select name="status"><option value="planned">Planned</option><option value="completed">Completed</option><option value="invoiced">Invoiced</option><option value="paid">Paid</option><option value="canceled">Canceled</option></select></label>
    <label class="labor-field">Service Type<select name="service_type" required><option value="">Select service...</option>${optionList(state.dropdowns.service_type, editing?.service_type)}</select></label><label class="labor-field">Hours<input name="hours" type="number" step="0.25" min="0" required value="${escapeHtml(editing?.hours ?? '')}"></label>
    <label class="labor-field">Hourly Rate<input name="hourly_rate" type="number" step="0.01" min="0.01" required value="${escapeHtml(editing?.hourly_rate || defaultRate)}"></label><label class="labor-field">Invoice<select name="invoice_id" id="laborInvoice">${invoiceOptions(editing?.invoice_id, editing?.client_id, editing?.project_id)}</select></label>
    <label class="labor-field">Invoice Number<input name="invoice_number" value="${escapeHtml(editing?.invoice_number)}" placeholder="Optional manual invoice #"></label>
    <label class="check-row labor-invoiced-toggle"><input name="is_invoiced" type="checkbox" ${editing?.is_invoiced ? 'checked' : ''}> Mark as invoiced</label>
    <label class="full labor-field labor-notes-field">Notes<textarea name="notes" rows="3" placeholder="Internal labor notes">${escapeHtml(editing?.notes)}</textarea></label>
    <div class="form-actions labor-modal-actions"><button class="ghost" type="button" id="cancelLaborModal">Cancel</button><button class="primary" type="submit">${editing ? 'Update Labor Entry' : 'Save Labor Entry'}</button></div>
  </form></div></div>`;
  laborForm.status.value = editing?.status || 'completed';
  laborClient.onchange = () => { laborProject.innerHTML = projectOptions('', laborClient.value); laborInvoice.innerHTML = invoiceOptions('', laborClient.value, ''); };
  laborProject.onchange = () => { laborInvoice.innerHTML = invoiceOptions('', laborClient.value, laborProject.value); };
  laborForm.onsubmit = async e => { e.preventDefault(); const payload = clean(formData(laborForm)); payload.client_id = Number(payload.client_id); numOrDelete(payload, 'project_id'); numOrDelete(payload, 'invoice_id'); payload.hours = Number(payload.hours); payload.hourly_rate = Number(payload.hourly_rate); payload.is_invoiced = formBool(laborForm, 'is_invoiced'); try { if (editing) await api(`/api/labor/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/labor', {method:'POST', body: JSON.stringify(payload)}); show(editing ? 'Labor entry updated' : 'Labor entry saved'); await renderLabor(); } catch (err) { alert(err.message); } };
  setupModal('laborModal','openLaborModal','closeLaborModal','cancelLaborModal',editing,renderLabor,'input[name="work_date"]');
  attachPageSearch('laborSearch');
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
  receiptUploadForm.onsubmit = async e => { e.preventDefault(); const fd = new FormData(receiptUploadForm); try { await api('/api/receipts', {method:'POST', body:fd}); show('Receipt uploaded'); await renderReceipts(); } catch (err) { alert(err.message); } };
  if (editing) {
    receiptEditForm.status.value = editing.status || 'needs_review'; receiptEditForm.linked_type.value = editing.linked_type || '';
    receiptEditForm.onsubmit = async e => { e.preventDefault(); const payload = clean(formData(receiptEditForm)); numOrDelete(payload, 'linked_id'); if (payload.total_amount) payload.total_amount = Number(payload.total_amount); if (payload.tax_amount) payload.tax_amount = Number(payload.tax_amount); try { await api(`/api/receipts/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); show('Receipt updated'); await renderReceipts(); } catch (err) { alert(err.message); } };
    cancelEdit.onclick = () => renderReceipts();
  }
  attachPageSearch('receiptSearch');
  attachRowActions();
}


function closeClientQuickModal() {
  document.querySelector('#clientQuickModal')?.remove();
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
  closeClientQuickModal();
  await preloadLookups();
  const editing = await findRecordForModal(type, editId);
  if (editId && !editing) throw new Error('Could not find that record to edit. Refresh and try again.');
  const isEdit = Boolean(editing);
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
      } catch(err) { alert(err.message); }
    };
  }

  if (type === 'quotes') {
    const settingsResponse = await api('/api/admin/settings');
    const settings = settingsResponse.settings || {};
    const existingItems = isEdit ? (await api(`/api/quotes/${editing.id}/line-items`)).items : [];
    const generatedQuoteNumber = editing?.quote_number || await nextQuoteNumber();
    const quoteNumberAttrs = isEdit ? '' : ' readonly aria-readonly="true" title="Generated automatically to prevent duplicate quote numbers"';
    wrapper.innerHTML = `<div class="modal-card wide-modal"><div class="modal-header"><div><h2>${isEdit ? 'Edit Quote' : 'Add Quote'}</h2><p>${isEdit ? 'Update this quote without leaving the client.' : `Create a quote for ${clientLabel}.`}</p></div><button class="ghost modal-close" type="button" aria-label="Close quote form">×</button></div><form id="clientQuoteForm" class="form-grid">
      <div class="quote-sheet-banner full">Quote – Internal Working Sheet</div>
      <div class="quote-meta-grid full">
        <label>Prepared by<input value="${escapeHtml(settings.company_name || 'Forged Systems LLC')}" disabled></label>
        <label>Quote #<input name="quote_number" required${quoteNumberAttrs} value="${escapeHtml(generatedQuoteNumber)}"></label>
        ${clientHidden}
        <label>Valid Through<input name="valid_until" type="date" value="${escapeHtml(editing?.valid_until)}"></label>
        <label>Site / Project<select name="project_id">${projectOptions(editing?.project_id, clientId)}</select></label>
        <label>Issued Date<input name="quote_date" type="date" required value="${escapeHtml(editing?.quote_date || todayIso())}"></label>
        <label>Quote Title<input name="title" required value="${escapeHtml(editing?.title)}" placeholder="Camera install quote"></label>
        <label>Status<select name="status"><option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="expired">Expired</option></select></label>
      </div>
      <input name="subtotal" type="hidden" value="${escapeHtml(editing?.subtotal || '0.00')}"><input name="tax_amount" type="hidden" value="${escapeHtml(editing?.tax_amount || '0.00')}"><input name="total_amount" type="hidden" value="${escapeHtml(editing?.total_amount || '0.00')}">
      ${quoteLineEditorHtml(existingItems, settings)}
      <div class="quote-section-title full">Payment Terms & Conditions</div>
      <label class="full">Terms<textarea name="terms" rows="6">${escapeHtml(quoteTermsValue(editing?.terms, settings.default_quote_terms))}</textarea></label>
      <div class="quote-section-title full">Internal Notes</div>
      <label class="full">Notes<textarea name="notes">${escapeHtml(editing?.notes)}</textarea></label>
      <div class="form-actions"><button class="primary" type="submit">${isEdit ? 'Update Quote' : 'Save Quote'}</button>${isEdit ? `<button class="ghost" type="button" data-action="print" data-type="quote" data-id="${editing.id}">Print Quote</button>` : ''}<button class="ghost quick-cancel" type="button">Cancel</button></div>
    </form></div>`;
    root.appendChild(wrapper);
    const form = wrapper.querySelector('#clientQuoteForm');
    form.status.value = editing?.status || 'draft';
    wireQuoteLineEditor(wrapper);
    form.onsubmit = async e => {
      e.preventDefault();
      const payload = clean(formData(form));
      payload.client_id = Number(clientId);
      numOrDelete(payload, 'project_id');
      const items = collectQuoteLineItems(wrapper.querySelector('#quoteLineEditor'));
      const totals = recalcQuoteEditor(wrapper);
      payload.subtotal = decimalString(totals.subtotal || 0);
      payload.tax_amount = decimalString(totals.tax || 0);
      payload.total_amount = decimalString(totals.total || 0);
      try {
        const saved = isEdit ? await api(`/api/quotes/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}) : await api('/api/quotes', {method:'POST', body: JSON.stringify(payload)});
        const quoteId = saved.id || editing?.id;
        await api(`/api/quotes/${quoteId}/line-items`, {method:'PUT', body: JSON.stringify({items: items.map(item => ({...item, quote_id: Number(quoteId)}))})});
        await closeAfter('quotes', isEdit ? 'Quote updated' : 'Quote saved');
      } catch(err) { alert(err.message); }
    };
  }

  if (type === 'invoices') {
    const settingsResponse = await api('/api/admin/settings');
    const settings = settingsResponse.settings || {};
    const generatedInvoiceNumber = editing?.invoice_number || await nextInvoiceNumber();
    const invoiceNumberAttrs = isEdit ? '' : ' readonly aria-readonly="true" title="Generated automatically to prevent duplicate invoice numbers"';
    wrapper.innerHTML = `<div class="modal-card wide-modal"><div class="modal-header"><div><h2>${isEdit ? 'Edit Invoice' : 'Add Invoice'}</h2><p>${isEdit ? 'Update this labor invoice without leaving the client.' : `Create a labor invoice for ${clientLabel}.`}</p></div><button class="ghost modal-close" type="button" aria-label="Close invoice form">×</button></div>
      ${invoiceInternalSheetHtml({editing, generatedInvoiceNumber, invoiceNumberAttrs, scopedClientId: clientId, clientLabel, settings, formId:'clientInvoiceForm', projectSelectId:'clientInvoiceProject', quoteSelectId:'clientInvoiceQuote'})}
    </div>`;
    root.appendChild(wrapper);
    await wireInvoiceInternalForm(wrapper, {formId:'clientInvoiceForm', projectSelectId:'clientInvoiceProject', quoteSelectId:'clientInvoiceQuote', editing, scopedClientId: clientId, onSave: async payload => { try { if (isEdit) await api(`/api/invoices/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/invoices', {method:'POST', body: JSON.stringify(payload)}); await closeAfter('invoices', isEdit ? 'Invoice updated' : 'Invoice saved'); } catch(err) { alert(err.message); } }});
  }

  if (type === 'labor') {
    const settingsResponse = await api('/api/admin/settings');
    const settings = settingsResponse.settings || {};
    const defaultRate = settings.default_labor_rate || '100.00';
    wrapper.innerHTML = `<div class="modal-card"><div class="modal-header"><div><h2>${isEdit ? 'Edit Labor Entry' : 'Add Labor Entry'}</h2><p>${isEdit ? 'Update this labor entry without leaving the client.' : `Add labor for ${clientLabel}.`}</p></div><button class="ghost modal-close" type="button" aria-label="Close labor form">×</button></div><form id="clientLaborForm" class="form-grid">
      <label>Work Date<input name="work_date" type="date" required value="${escapeHtml(editing?.work_date || todayIso())}"></label>${clientHidden}
      <label>Project<select name="project_id" id="clientLaborProject">${projectOptions(editing?.project_id, clientId)}</select></label><label>Status<select name="status"><option value="planned">Planned</option><option value="completed">Completed</option><option value="invoiced">Invoiced</option><option value="paid">Paid</option><option value="canceled">Canceled</option></select></label>
      <label>Service Type<select name="service_type" required><option value="">Select service...</option>${optionList(state.dropdowns.service_type, editing?.service_type)}</select></label><label>Hours<input name="hours" type="number" step="0.25" min="0" required value="${escapeHtml(editing?.hours ?? '')}"></label>
      <label>Hourly Rate<input name="hourly_rate" type="number" step="0.01" min="0.01" required value="${escapeHtml(editing?.hourly_rate || defaultRate)}"></label><label>Invoice<select name="invoice_id" id="clientLaborInvoice">${invoiceOptions(editing?.invoice_id, clientId, editing?.project_id)}</select></label>
      <label>Invoice Number<input name="invoice_number" value="${escapeHtml(editing?.invoice_number)}" placeholder="Optional manual invoice #"></label><label class="check-row"><input name="is_invoiced" type="checkbox" ${editing?.is_invoiced ? 'checked' : ''}> Mark as invoiced</label>
      <label class="full">Notes<textarea name="notes">${escapeHtml(editing?.notes)}</textarea></label>
      <div class="form-actions"><button class="primary" type="submit">${isEdit ? 'Update Labor Entry' : 'Save Labor Entry'}</button><button class="ghost quick-cancel" type="button">Cancel</button></div>
    </form></div>`;
    root.appendChild(wrapper);
    const form = wrapper.querySelector('#clientLaborForm');
    form.status.value = editing?.status || 'completed';
    const projectSelect = wrapper.querySelector('#clientLaborProject');
    const invoiceSelect = wrapper.querySelector('#clientLaborInvoice');
    projectSelect.onchange = () => { invoiceSelect.innerHTML = invoiceOptions('', clientId, projectSelect.value); };
    form.onsubmit = async e => { e.preventDefault(); const payload = clean(formData(form)); payload.client_id = Number(clientId); numOrDelete(payload, 'project_id'); numOrDelete(payload, 'invoice_id'); payload.hours = Number(payload.hours); payload.hourly_rate = Number(payload.hourly_rate); payload.is_invoiced = formBool(form, 'is_invoiced'); try { if (isEdit) await api(`/api/labor/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/labor', {method:'POST', body: JSON.stringify(payload)}); await closeAfter('labor', isEdit ? 'Labor entry updated' : 'Labor entry saved'); } catch(err) { alert(err.message); } };
  }

  if (type === 'ledger') {
    const editingKind = normalizeLedgerKind(editing?.kind);
    const editingBusinessType = editing?.business_type || 'client';
    wrapper.innerHTML = `<div class="modal-card"><div class="modal-header"><div><h2>${isEdit ? 'Edit Ledger Entry' : 'Add Ledger Entry'}</h2><p>${isEdit ? 'Update this ledger entry without leaving the client.' : `Add a ledger entry for ${clientLabel}.`}</p></div><button class="ghost modal-close" type="button" aria-label="Close ledger form">×</button></div><form id="clientLedgerForm" class="form-grid" enctype="multipart/form-data">
      <label>Date<input name="entry_date" type="date" required value="${escapeHtml(editing?.entry_date || todayIso())}"></label><label>Amount<input name="amount" type="number" step="0.01" required value="${escapeHtml(editing?.amount ?? '')}"></label>
      <label>Account Type<select name="kind"><option value="income">Income</option><option value="cogs">Cost of Goods Sold</option><option value="expense">Expenses</option></select></label><label>Business Type<select name="business_type"><option value="client">Client</option><option value="admin">Admin</option></select></label>
      <label>Category<select name="category" required><option value="">Select category...</option></select></label><input type="hidden" name="client_id" value="${clientId}"><label data-ledger-client-wrap>Client<input value="${clientLabel}" disabled></label>
      <label data-ledger-project-wrap>Project<select name="project_id">${projectOptions(editing?.project_id, clientId)}</select></label>
      <label data-ledger-quote-wrap>Quote<select name="quote_id">${quoteOptions(editing?.quote_id, clientId, editing?.project_id)}</select></label><label data-ledger-invoice-wrap>Invoice<select name="invoice_id">${invoiceOptions(editing?.invoice_id, clientId, editing?.project_id)}</select></label>
      <label class="full">Receipt Photo/PDF<input name="receipt_file" type="file" accept="image/*,application/pdf"></label>${editing?.receipt_id ? `<div class="full muted">Attached receipt: ${receiptPreviewButton(editing.receipt_id, 'Preview receipt')}</div>` : ''}
      <label class="full">Description<textarea name="description">${escapeHtml(editing?.description)}</textarea></label>
      <div class="form-actions"><button class="primary" type="submit">${isEdit ? 'Update Ledger Entry' : 'Save Ledger Entry'}</button><button class="ghost quick-cancel" type="button">Cancel</button></div>
    </form></div>`;
    root.appendChild(wrapper);
    const form = wrapper.querySelector('#clientLedgerForm');
    form.kind.value = editingKind;
    form.business_type.value = editingBusinessType;
    configureLedgerForm(form, { selectedCategory: editing?.category || '', clientId });
    form.onsubmit = async e => { e.preventDefault(); const payload = normalizeLedgerPayload(clean(formData(form))); delete payload.receipt_file; if (payload.business_type === 'client') payload.client_id = Number(clientId); try { await saveLedgerEntryWithReceipt(form, payload, isEdit ? editing : null); await closeAfter('ledger', isEdit ? 'Ledger entry updated' : 'Ledger entry saved'); } catch(err) { alert(err.message); } };
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
      } catch(err) { alert(err.message); }
    };
  }

  attachPrintActions(wrapper);
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
    const ranges = {
      1: [`${year - 1}-12-01`, `${year}-02-${String(lastDayOfMonth(year, 1)).padStart(2,'0')}`, `NY Sales Tax Q1 ${year} (Dec-Feb)`],
      2: [`${year}-03-01`, `${year}-05-31`, `NY Sales Tax Q2 ${year} (Mar-May)`],
      3: [`${year}-06-01`, `${year}-08-31`, `NY Sales Tax Q3 ${year} (Jun-Aug)`],
      4: [`${year}-09-01`, `${year}-11-30`, `NY Sales Tax Q4 ${year} (Sep-Nov)`],
    };
    const [start, end, label] = ranges[quarter];
    return { start, end, label };
  }
  const start = document.querySelector('#reportStart')?.value || `${year}-01-01`;
  const end = document.querySelector('#reportEnd')?.value || `${year}-12-31`;
  return { start, end, label: `${start} to ${end}` };
}
function statusRows(statuses) {
  return Object.entries(statuses || {}).map(([name, count]) => [statusLabel(name), count]);
}

async function renderDashboard() {
  const data = await api('/api/dashboard');
  const c = data.cards;
  root.innerHTML = `<div class="dashboard-view"><div class="cards dashboard-cards">
    <div class="card"><span>Open Projects</span><strong>${c.open_projects}</strong></div>
    <div class="card"><span>Open Quotes</span><strong>${c.open_quotes}</strong></div>
    <div class="card"><span>Open Invoices</span><strong>${c.open_invoices}</strong></div>
    <div class="card"><span>Invoice Balance</span><strong>${money(c.open_invoice_balance)}</strong></div>
    <div class="card"><span>Uninvoiced Labor</span><strong>${c.uninvoiced_labor}</strong></div>
    <div class="card"><span>Uninvoiced Value</span><strong>${money(c.uninvoiced_labor_value)}</strong></div>
  </div>
  <div class="panel dashboard-panel"><h2>Open Projects</h2>${dashboardTable(['Project','Client','Status','Start'], (data.open_projects || []).map(p => [escapeHtml(p.name), escapeHtml(p.client), `<span class="status">${statusLabel(p.status)}</span>`, shortDate(p.start_date)]), 'No open projects.', (data.open_projects || []).map(p => `class="dashboard-record-row" role="button" tabindex="0" data-dashboard-type="project" data-dashboard-id="${Number(p.id)}"`))}</div>
  <div class="panel dashboard-panel"><h2>Open Quotes</h2>${dashboardTable(['Quote','Client','Project','Status','Total','Valid Until'], (data.open_quotes || []).map(q => [escapeHtml(q.quote_number), escapeHtml(q.client), escapeHtml(q.project), `<span class="status">${statusLabel(q.status)}</span>`, money(q.total_amount), shortDate(q.valid_until)]), 'No open quotes.', (data.open_quotes || []).map(q => `class="dashboard-record-row" role="button" tabindex="0" data-dashboard-type="quote" data-dashboard-id="${Number(q.id)}"`))}</div>
  <div class="panel dashboard-panel"><h2>Open Invoices</h2>${dashboardTable(['Invoice','Client','Project','Status','Balance','Due'], (data.open_invoices || []).map(i => [escapeHtml(i.invoice_number), escapeHtml(i.client), escapeHtml(i.project), `<span class="status">${statusLabel(i.status)}</span>`, money(i.balance_due), shortDate(i.due_date)]), 'No open invoices.', (data.open_invoices || []).map(i => `class="dashboard-record-row" role="button" tabindex="0" data-dashboard-type="invoice" data-dashboard-id="${Number(i.id)}"`))}</div>
  <div class="panel dashboard-panel"><h2>Uninvoiced Labor</h2>${dashboardTable(['Date','Client','Project','Service','Value'], (data.uninvoiced_labor_items || []).map(l => [shortDate(l.work_date), escapeHtml(l.client), escapeHtml(l.project), escapeHtml(l.service_type), money(l.line_total)]), 'No uninvoiced labor.', (data.uninvoiced_labor_items || []).map(l => `class="dashboard-record-row" role="button" tabindex="0" data-dashboard-type="labor" data-dashboard-id="${Number(l.id)}"`))}</div></div>`;
  attachDashboardActions();
}

async function openDashboardRecord(type, id) {
  const typeMap = { project: 'projects', quote: 'quotes', invoice: 'invoices', labor: 'labor', ledger: 'ledger' };
  const quickType = typeMap[type];
  if (!quickType) throw new Error(`Unknown dashboard record type: ${type}`);
  const record = await findRecordForModal(quickType, id);
  if (!record) throw new Error('Could not find that record. Refresh and try again.');
  if (!record.client_id) throw new Error('This dashboard record is not attached to a client.');
  await openClientQuickModal(Number(record.client_id), quickType, id, { returnToDashboard: true });
}

function attachDashboardActions() {
  root.querySelectorAll('[data-dashboard-type][data-dashboard-id]').forEach(row => {
    const open = () => openDashboardRecord(row.dataset.dashboardType, Number(row.dataset.dashboardId));
    row.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      open().catch(err => alert(err.message || 'Unable to open record.'));
    });
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      open().catch(err => alert(err.message || 'Unable to open record.'));
    });
  });
}

async function renderReports() {
  const now = new Date();
  const currentYear = now.getFullYear();
  root.innerHTML = `<div class="page-actions report-filter-actions"><details class="filter-menu report-filter-menu"><summary>Filters</summary><form id="reportForm" class="form-grid report-grid filter-menu-panel report-filter-dropdown">
    <label class="report-field">View By<select id="reportMode" name="mode"><option value="year">Year</option><option value="month">Month</option><option value="ny-quarter">New York Sales Tax Quarter</option><option value="range">Custom Date Range</option></select></label>
    <label class="report-field">Year<input id="reportYear" name="year" type="number" min="2000" max="2100" step="1" value="${currentYear}" inputmode="numeric"></label>
    <label class="report-field" id="reportMonthWrap">Month<select id="reportMonth" name="month">${Array.from({length:12}, (_,i)=>`<option value="${i+1}" ${i===now.getMonth()?'selected':''}>${new Date(2000, i, 1).toLocaleString('default', {month:'long'})}</option>`).join('')}</select></label>
    <label class="report-field" id="reportQuarterWrap">NY Quarter<select id="reportQuarter" name="quarter"><option value="1">Q1: Dec-Feb</option><option value="2">Q2: Mar-May</option><option value="3">Q3: Jun-Aug</option><option value="4">Q4: Sep-Nov</option></select></label>
    <label class="report-field" id="reportStartWrap">Start Date<input id="reportStart" type="date" value="${formatLocalDate(new Date(currentYear,0,1))}"></label>
    <label class="report-field" id="reportEndWrap">End Date<input id="reportEnd" type="date" value="${formatLocalDate(new Date(currentYear,11,31))}"></label>
    <div class="form-actions report-actions"><button class="primary" type="submit">Run Report</button></div>
  </form></details></div><div id="reportResults"></div>`;

  const updateVisibility = () => {
    const mode = reportMode.value;
    reportMonthWrap.classList.toggle('hidden', mode !== 'month');
    reportQuarterWrap.classList.toggle('hidden', mode !== 'ny-quarter');
    reportStartWrap.classList.toggle('hidden', mode !== 'range');
    reportEndWrap.classList.toggle('hidden', mode !== 'range');
  };
  const run = async () => {
    const range = reportRangeFromControls();
    const data = await api(`/api/reports/money-flow?start_date=${range.start}&end_date=${range.end}`);
    const c = data.cards;
    const target = document.querySelector('#reportResults');
    target.innerHTML = `<div class="panel"><h2>Money Flow: ${escapeHtml(range.label)}</h2><p class="muted">Range: ${escapeHtml(data.range.start_date)} through ${escapeHtml(data.range.end_date)}</p><div class="cards report-money-cards">
      <div class="card"><span>Revenue</span><strong>${money(c.ledger_revenue)}</strong></div>
      <div class="card"><span>Total Expenses</span><strong>${money(c.ledger_expenses)}</strong></div>
      <div class="card"><span>Job Expenses</span><strong>${money(c.job_expenses)}</strong></div>
      <div class="card"><span>Business Expenses</span><strong>${money(c.business_expenses)}</strong></div>
      <div class="card"><span>Net Income</span><strong>${money(c.net_income)}</strong></div>
      <div class="card"><span>Net Profit</span><strong>${money(c.ledger_net_profit)}</strong></div>
      <div class="card"><span>Invoice Total</span><strong>${money(c.invoice_total)}</strong></div>
      <div class="card"><span>Outstanding</span><strong>${money(c.invoice_outstanding)}</strong></div>
      <div class="card"><span>Sales Tax Reserve</span><strong>${money(c.estimated_sales_tax)}</strong></div>
      <div class="card"><span>Sales Tax Paid</span><strong>${money(c.sales_tax_paid)}</strong></div>
      <div class="card"><span>Income Tax Reserve</span><strong>${money(c.estimated_income_tax)}</strong></div>
      <div class="card"><span>Income Tax Paid</span><strong>${money(c.income_tax_paid)}</strong></div>
      <div class="card"><span>Tax Reserve Total</span><strong>${money(c.estimated_tax_owed)}</strong></div>
      <div class="card"><span>Total Tax Paid</span><strong>${money(c.total_tax_paid)}</strong></div>
    </div><p class="muted">Reserve cards show the remaining tax buckets after payments. Payments only reduce net profit beyond the estimate when they exceed the reserved amount. Invoice totals are shown separately for receivables tracking.</p></div>
    <div class="panel"><h2>Money Flow by Account Type & Category</h2><p class="muted">Uses the same selected report range and breaks ledger activity into the QuickBooks-style account type/category totals.</p>${compactTable(['Account Type','Category','Total'], (data.account_type_breakdown || []).map(r => [escapeHtml(r.account_type), escapeHtml(r.category), money(r.total)]), 'No ledger activity for this period.', 'reports-table')}</div>
    <div class="panel"><h2>By Category</h2>${compactTable(['Category','Revenue','Expenses','Net'], (data.by_category || []).map(r => [escapeHtml(r.name), money(r.revenue), money(r.expenses), money(r.net)]), 'No ledger activity for this period.', 'reports-table')}</div>
    <div class="panel"><h2>By Client</h2>${compactTable(['Client','Revenue','Expenses','Net'], (data.by_client || []).map(r => [escapeHtml(r.name), money(r.revenue), money(r.expenses), money(r.net)]), 'No client activity for this period.', 'reports-table')}</div>
    <div class="panel"><h2>By Project</h2>${compactTable(['Project','Revenue','Expenses','Net'], (data.by_project || []).map(r => [escapeHtml(r.name), money(r.revenue), money(r.expenses), money(r.net)]), 'No project activity for this period.', 'reports-table')}</div>
    <div class="panel"><h2>Status Summary</h2><div class="report-columns"><div><h3>Projects</h3>${compactTable(['Status','Count'], statusRows(data.project_statuses), 'No projects.', 'reports-table')}</div><div><h3>Quotes</h3>${compactTable(['Status','Count'], statusRows(data.quote_statuses), 'No quotes.', 'reports-table')}</div><div><h3>Invoices</h3>${compactTable(['Status','Count'], statusRows(data.invoice_statuses), 'No invoices.', 'reports-table')}</div></div></div>
    <div class="panel"><h2>Client Report</h2>${compactTable(['Client','Projects','Quotes','Invoices','Labor','Ledger Net','Invoice Total','Outstanding'], (data.client_report || []).map(r => [escapeHtml(r.client), r.projects, r.quotes, r.invoices, r.labor_entries, money(r.ledger_net), money(r.invoice_total), money(r.outstanding)]), 'No client report rows for this period.', 'reports-table')}</div>
    <div class="panel"><h2>Project Report</h2>${compactTable(['Project','Client','Status','Quotes','Invoices','Labor','Ledger Net','Invoice Total'], (data.project_report || []).map(r => [escapeHtml(r.project), escapeHtml(r.client), statusLabel(r.status), r.quotes, r.invoices, r.labor_entries, money(r.ledger_net), money(r.invoice_total)]), 'No project report rows for this period.', 'reports-table')}</div>`;
  };
  reportMode.addEventListener('change', updateVisibility);
  reportForm.onsubmit = async e => { e.preventDefault(); try { await run(); } catch(err) { alert(err.message); } };
  updateVisibility();
  await run();
}

async function renderAdmin() {
  const records = await api('/api/admin/backups');
  const dropdowns = await api('/api/admin/dropdowns?include_inactive=true&page_size=100');
  const settingsResponse = await api('/api/admin/settings');
  const settings = settingsResponse.settings || {};
  const rows = dropdowns.items || [];
  root.innerHTML = `<div class="panel"><h2>Create Full Backup</h2><p>Downloads a zip containing the SQLite database plus uploaded files and exports.</p><button id="backupBtn" class="primary">Download Full Backup</button></div>
  <div class="panel"><h2>Restore Backup</h2><p class="error">Restore replaces the current database/uploads. A pre-restore backup is created automatically.</p><form id="restoreForm" class="form-grid" enctype="multipart/form-data"><label class="full">Backup ZIP<input name="file" type="file" accept=".zip" required></label><button id="restoreBtn" class="danger" type="submit">Restore Backup</button><p id="restoreStatus" class="full muted"></p></form></div>
  <div class="panel"><h2>Business Settings</h2><p>Defaults used by quotes, invoices, labor, and reports.</p><form id="businessSettingsForm" class="form-grid">
    <label>Company Name<input name="company_name" value="${escapeHtml(settings.company_name || 'Forged Systems LLC')}"></label>
    <label>Default Labor Rate<input name="default_labor_rate" type="number" step="0.01" min="0" value="${escapeHtml(settings.default_labor_rate || '100.00')}"></label>
    <label>Quote Markup %<input name="quote_markup_percent" type="number" step="0.01" min="0" value="${escapeHtml(settings.quote_markup_percent || '10')}"></label>
    <label>Sales Tax Rate<input name="sales_tax_rate" value="${escapeHtml(settings.sales_tax_rate || '0.07')}" placeholder="0.07 for 7%"></label>
    <label class="full">Default Quote Terms<textarea name="default_quote_terms">${escapeHtml(quoteTermsValue(null, settings.default_quote_terms))}</textarea></label>
    <label class="full">Default Invoice Terms<textarea name="default_invoice_terms">${escapeHtml(invoiceTermsValue(null, settings.default_invoice_terms))}</textarea></label>
    <div class="form-actions"><button class="primary" type="submit">Save Business Settings</button></div>
  </form></div>
  <div class="panel"><h2>Dropdown Management</h2><p>Adjust the categories and service types used across the app.</p><form id="dropdownForm" class="form-grid">
    <label>Dropdown Type<select name="kind"><option value="ledger_category">Ledger Category</option><option value="service_type">Service Type</option></select></label>
    <label>Label<input name="label" required placeholder="Example: Cable Runs"></label>
    <label>Color/Tag<input name="color" placeholder="green, red, blue, optional"></label>
    <label>Sort Order<input name="sort_order" type="number" value="100"></label>
    <label class="check-row"><input name="is_active" type="checkbox" checked> Active</label>
    <div class="form-actions"><button class="primary" type="submit">Add Dropdown Option</button></div>
  </form></div>
  ${table(['Type','Label','Color','Sort','Active','Actions'], rows.map(o => [statusLabel(o.kind), escapeHtml(o.label), escapeHtml(o.color), o.sort_order, o.is_active ? 'Yes' : 'No', `<div class="row-actions"><button class="mini" data-dd-action="toggle" data-id="${o.id}" data-active="${o.is_active}">${o.is_active ? 'Disable' : 'Enable'}</button><button class="mini danger-mini" data-dd-action="delete" data-id="${o.id}">Delete</button></div>`]))}
  ${table(['Filename','Created','Size'], records.items.map(b => [escapeHtml(b.filename),b.created_at,`${Math.round(b.file_size_bytes/1024)} KB`]))}`;
  backupBtn.onclick = async () => { window.location = '/api/admin/backups/download'; };
  restoreForm.onsubmit = async e => {
    e.preventDefault();
    if(!confirm('This will replace current data. A pre-restore backup will be created. Continue?')) return;
    const fd = new FormData(restoreForm);
    const status = document.querySelector('#restoreStatus');
    const btn = document.querySelector('#restoreBtn');
    btn.disabled = true;
    status.textContent = 'Restoring backup...';
    try {
      const result = await api('/api/admin/backups/restore', {method:'POST', body:fd});
      const counts = result.restored_counts || {};
      status.textContent = `Restore completed. Clients: ${counts.clients ?? 0}, Projects: ${counts.projects ?? 0}, Quotes: ${counts.quotes ?? 0}, Invoices: ${counts.invoices ?? 0}, Labor: ${counts.labor_entries ?? 0}, Ledger: ${counts.ledger_entries ?? 0}. Reloading...`;
      show('Restore completed');
      setTimeout(() => window.location.href = `/?restored=${Date.now()}`, 900);
    } catch(err) {
      status.textContent = err.message;
      alert(err.message);
      btn.disabled = false;
    }
  };
  businessSettingsForm.onsubmit = async e => { e.preventDefault(); const payload = clean(formData(businessSettingsForm)); try { await api('/api/admin/settings', {method:'PUT', body: JSON.stringify(payload)}); show('Business settings saved'); await loadPage('admin'); } catch(err) { alert(err.message); } };
  dropdownForm.onsubmit = async e => { e.preventDefault(); const payload = clean(formData(dropdownForm)); payload.sort_order = Number(payload.sort_order || 100); payload.is_active = formBool(dropdownForm, 'is_active'); try { await api('/api/admin/dropdowns', {method:'POST', body: JSON.stringify(payload)}); show('Dropdown option added'); await loadPage('admin'); } catch(err) { alert(err.message); } };
  root.querySelectorAll('[data-dd-action="toggle"]').forEach(btn => btn.addEventListener('click', async () => { try { await api(`/api/admin/dropdowns/${btn.dataset.id}`, {method:'PATCH', body: JSON.stringify({is_active: btn.dataset.active !== 'true'})}); await loadPage('admin'); } catch(err) { alert(err.message); } }));
  root.querySelectorAll('[data-dd-action="delete"]').forEach(btn => btn.addEventListener('click', async () => { if(!confirm('Delete this dropdown option? Existing records keep their current text, but new forms will no longer show it.')) return; try { await api(`/api/admin/dropdowns/${btn.dataset.id}`, {method:'DELETE'}); await loadPage('admin'); } catch(err) { alert(err.message); } }));
}

document.querySelector('#loginForm').addEventListener('submit', login);
document.querySelector('#setupAccountForm').addEventListener('submit', createInitialAccount);
document.querySelector('#setupRestoreForm').addEventListener('submit', restoreInitialBackup);
document.querySelector('#showCreateSetup').addEventListener('click', () => showSetupPane('create'));
document.querySelector('#showRestoreSetup').addEventListener('click', () => showSetupPane('restore'));
document.querySelector('#userBtn').addEventListener('click', openUserModal);
document.querySelector('#logoutBtn').addEventListener('click', logout);
document.querySelector('#mobileMenuBtn')?.addEventListener('click', toggleMobileNav);
document.querySelector('#sidebarScrim')?.addEventListener('click', closeMobileNav);
document.addEventListener('click', event => {
  const btn = event.target.closest('[data-action="preview-receipt"]');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  openReceiptPreviewModal(Number(btn.dataset.id)).catch(err => alert(err.message || 'Unable to preview receipt.'));
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileNav(); });
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => navigateFromSidebar(b.dataset.page)));
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
