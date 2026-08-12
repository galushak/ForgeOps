const state = { page: 'dashboard', clients: [], projects: [], quotes: [], invoices: [], addressesByClient: {}, dropdowns: { ledger_category: [], service_type: [] }, editing: null, clientDetailTab: 'overview', clientDetailId: null, clientStatusFilter: 'all', projectDetailTab: 'overview', projectDetailId: null, projectStatusFilter: 'all', projectClientFilter: 'all', quoteStatusFilter: 'all', quoteClientFilter: 'all', quoteReturnFocusSelector: '', invoiceStatusFilter: 'all', invoiceClientFilter: 'all', invoiceReturnFocusSelector: '', user: null, lookupCacheAt: 0, lookupCachePromise: null };
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
  const shipping = feeByName(items, 'shipping')?.line_total || '0.00';
  const tariff = feeByName(items, 'tariff')?.line_total || '0.00';
  const markup = feeByName(items, 'coordination')?.line_total || '0.00';
  return `<div class="quote-builder quote-editor-sections full" id="quoteLineEditor" data-markup-percent="${markupPercent}" data-sales-tax-rate="${salesTaxRate}">
    <section class="quote-sheet-section quote-editor-section" aria-labelledby="quoteEquipmentHeading">
      <div class="quote-editor-section-head"><span>2</span><div><h3 id="quoteEquipmentHeading">Equipment & Materials</h3><p>Add the hardware, materials, and quantities included in this estimate.</p></div></div>
      <div class="quote-sheet-head equipment-head"><span>Item</span><span>Description</span><span>Qty</span><span>Unit Price</span><span>Line Total</span><span>Tax</span><span></span></div>
      <div id="quoteEquipmentRows">${(equipment.length ? equipment : [{kind:'equipment', name:'', description:'', quantity:'1.00', unit_price:'0.00', line_total:'0.00', taxable:true}]).map(quoteEquipmentRowHtml).join('')}</div>
      <div class="quote-toolbar sheet-toolbar"><button class="mini quote-add-line" type="button" id="addEquipmentLine">+ Add Equipment or Material</button></div>
    </section>

    <section class="quote-sheet-section quote-editor-section quote-fees-section" aria-labelledby="quoteFeesHeading">
      <div class="quote-editor-section-head"><span>3</span><div><h3 id="quoteFeesHeading">Shipping, Tariff & Markup</h3><p>Use the optional cost fields that apply to this quote.</p></div></div>
      <div class="quote-fee-grid">
        <label>Shipping & Freight<input id="quoteShippingInput" type="number" min="0" step="0.01" value="${escapeHtml(shipping)}"></label>
        <label>Tariff Surcharge<input id="quoteTariffInput" type="number" min="0" step="0.01" value="${escapeHtml(tariff)}"></label>
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
        <div data-quote-summary-row="shipping"><span>Shipping & Freight</span><output data-quote-summary="shipping">$0.00</output></div>
        <div data-quote-summary-row="tariff"><span>Tariff Surcharge</span><output data-quote-summary="tariff">$0.00</output></div>
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
  const summaryValues = { shipping: totals.shipping, tariff: totals.tariff, markup: totals.markup };
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
  const equipmentButton = editor.querySelector('#addEquipmentLine');
  const laborButton = editor.querySelector('#addLaborLine');
  if (equipmentButton) equipmentButton.onclick = addEquipment;
  if (laborButton) laborButton.onclick = addLabor;
  editor.querySelectorAll('input,select,textarea').forEach(el => el.oninput = () => recalcQuoteEditor(container));
  editor.querySelectorAll('.quote-remove-line').forEach(btn => btn.onclick = () => { btn.closest('.quote-line-row')?.remove(); recalcQuoteEditor(container); });
  recalcQuoteEditor(container);
}

function quoteEditorFormHtml({editing=null, generatedQuoteNumber='', quoteNumberAttrs='', settings={}, existingItems=[], formId='quoteForm', clientSelectId='quoteClient', projectSelectId='quoteProject', scopedClientId=null, scopedProjectId='', clientLabel='', closeButtonId='', cancelButtonId='', scoped=false}) {
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

function invoiceInternalSheetHtml({editing=null, generatedInvoiceNumber='', invoiceNumberAttrs='', scopedClientId='', presetClientId='', scopedProjectId='', scopedQuoteId='', clientLabel='', settings={}, formId='invoiceForm', clientSelectId='invoiceClient', projectSelectId='invoiceProject', quoteSelectId='invoiceQuote'}) {
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
      <div class="invoice-editor-section-head"><span>4</span><div><h3 id="${formId}MaterialsHeading">Additional Materials</h3><p>Add parts or materials that belong on this Invoice.</p></div></div>
      <div class="invoice-material-head"><span>Description</span><span>Qty</span><span>Unit Price</span><span>Line Total</span><span></span></div>
      <div id="invoiceMaterialRows">${materials.length ? materials.map(invoiceMaterialRowHtml).join('') : ''}</div>
      <button class="mini invoice-add-line" id="addInvoiceMaterialLine" type="button">+ Add Material</button>
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
        <label>Payment Terms & Conditions<span>Included in the client-facing printout.</span><textarea name="terms" rows="6">${escapeHtml(terms)}</textarea></label>
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

function wireInvoiceLineEditor(container) {
  const form = container.querySelector('.invoice-internal-sheet');
  if (!form) return;
  const materialRows = form.querySelector('#invoiceMaterialRows');
  const creditRows = form.querySelector('#invoiceCreditRows');
  const addMaterial = form.querySelector('#addInvoiceMaterialLine');
  const addCredit = form.querySelector('#addInvoiceCreditLine');
  if (addMaterial) addMaterial.onclick = () => {
    materialRows?.insertAdjacentHTML('beforeend', invoiceMaterialRowHtml({quantity:'1.00', unit_price:'0.00', line_total:'0.00'}));
    wireInvoiceLineEditor(container); recalcInvoiceEditor(container);
  };
  if (addCredit) addCredit.onclick = () => {
    creditRows?.insertAdjacentHTML('beforeend', invoiceCreditRowHtml({kind:'payment', line_total:'0.00'}));
    wireInvoiceLineEditor(container); recalcInvoiceEditor(container);
  };
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
  const display = (selector, value) => { form.querySelectorAll(selector).forEach(el => { if ('value' in el) el.value = money(value); else el.textContent = money(value); }); };
  display('#invoiceLaborTotalDisplay', laborTotal);
  display('#invoiceLaborTotalDisplay2', laborTotal);
  display('#invoiceMaterialsTotalDisplay', materialsTotal);
  display('#invoiceSubtotalDisplay', taxableBase);
  display('#invoiceTaxDisplay', tax);
  display('#invoiceTotalDisplay', total);
  display('#invoiceCreditsDisplay', paid);
  display('#invoiceBalanceDisplay', balance);
  display('[data-invoice-sticky-balance]', balance);
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
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => modal.querySelector(editing ? 'input[name="quote_number"]' : 'input[name="title"]')?.focus(), 0);
  };
  const closeModal = async () => {
    document.removeEventListener('keydown', onKeydown);
    setBackgroundInert(false);
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

function setInvoiceEditorPageState(active) {
  document.body.classList.toggle('invoice-editor-open', active);
  const mobileNavigation = document.querySelector('.mobile-bottom-nav');
  if (!mobileNavigation) return;
  mobileNavigation.inert = active;
  if (active) mobileNavigation.setAttribute('aria-hidden', 'true');
  else mobileNavigation.removeAttribute('aria-hidden');
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
    if (!confirm(`This quote is already linked to ${linkedInvoices.length} ${noun}${references}. Create another invoice?`)) return;
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
      startInvoiceFromQuote(Number(button.dataset.quoteId)).catch(err => alert(err.message || 'Unable to start the Invoice.'));
    };
  });
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
    alert('Popup blocked. Allow popups for ForgeOps to print.');
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
      if (btn.dataset.type === 'quote') state.quoteReturnFocusSelector = `[data-action="edit"][data-type="quote"][data-id="${Number(btn.dataset.id)}"]`;
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
  } catch (err) { alert(err.message); }
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
  wrapper.innerHTML = `<section class="scoped-action-sheet"><header><div><p class="sheet-eyebrow">${escapeHtml(eyebrow)}</p><h2 id="scopedActionTitle">${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><button class="sheet-close" type="button" data-scoped-close aria-label="Close add menu">×</button></header><div class="scoped-action-grid">${actions.map((action, index) => `<button type="button" data-scoped-action="${index}"><strong>${escapeHtml(action.label)}</strong><span>${escapeHtml(action.description || '')}</span></button>`).join('')}</div></section>`;
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
      Promise.resolve(action.run()).catch(err => alert(err.message || 'Unable to open that form.'));
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

  root.innerHTML = `<div class="detail-header hub-header"><button class="ghost" id="backToClients" type="button">← Clients</button><div class="detail-title"><div class="hub-title-line"><h2>${escapeHtml(client.name)}</h2><span class="status ${client.is_active ? '' : 'muted-status'}">${client.is_active ? 'Active' : 'Inactive'}</span></div><div class="hub-contact-line"><span>${escapeHtml(client.contact_name || 'No primary contact')}</span>${client.email ? contactEmail(client.email) : ''}${client.phone ? contactPhone(client.phone) : ''}</div><p>${escapeHtml(client.site_address || 'No primary site address')}</p></div><div class="hub-header-actions"><button class="ghost" id="editClientDetail" type="button">Edit</button><button class="primary" id="addClientDetail" type="button">+ Add</button></div></div>
    <div class="tabs hub-tabs detail-tab-grid client-detail-tabs" role="tablist" aria-label="Client sections">${detailTabButton('client', tab, 'overview','Overview')}${detailTabButton('client', tab, 'projects',`Projects (${projects.length})`)}${detailTabButton('client', tab, 'quotes',`Quotes (${quotes.length})`)}${detailTabButton('client', tab, 'invoices',`Invoices (${invoices.length})`)}${detailTabButton('client', tab, 'labor',`Labor (${labor.length})`)}${detailTabButton('client', tab, 'ledger',`Ledger (${ledger.length})`)}</div>${tabs[tab] || overviewHtml}`;

  backToClients.onclick = () => loadPage('clients');
  editClientDetail.onclick = () => renderClients(clientId, clientId);
  addClientDetail.onclick = () => openScopedActionSheet({title:`Add to ${client.name}`, subtitle:'The client is already selected in each form.', actions:[
    {label:'New Project', description:'Create a project for this client.', run:() => openClientQuickModal(clientId, 'projects')},
    {label:'New Quote', description:'Start a client-scoped quote.', run:() => openClientQuickModal(clientId, 'quotes')},
    {label:'New Invoice', description:'Start a client-scoped invoice.', run:() => openClientQuickModal(clientId, 'invoices')},
    {label:'Add Labor', description:'Log billable work.', run:() => openClientQuickModal(clientId, 'labor')},
    {label:'Add Expense', description:'Add a client expense.', run:() => openClientQuickModal(clientId, 'ledger', null, {ledgerKind:'expense'})},
    {label:'Ledger Entry', description:'Add income, COGS, or an expense.', run:() => openClientQuickModal(clientId, 'ledger')},
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

  root.innerHTML = `<div class="detail-header hub-header"><button class="ghost" id="backToProjects" type="button">← Projects</button><div class="detail-title"><div class="hub-title-line"><h2>${escapeHtml(project.name)}</h2><span class="status">${statusLabel(project.status)}</span></div><p><button class="link-button hub-client-link" id="projectClientLink" type="button">${escapeHtml(client?.name || `Client #${project.client_id}`)}</button>${project.site_address ? ` · ${escapeHtml(project.site_address)}` : ''}</p><div class="hub-meta-line"><span>Start ${shortDate(project.start_date)}</span>${project.completed_date ? `<span>Completed ${shortDate(project.completed_date)}</span>` : ''}</div></div><div class="hub-header-actions"><button class="ghost" id="editProjectDetail" type="button">Edit</button><button class="primary" id="addProjectDetail" type="button">+ Add</button></div></div>
    <div class="tabs hub-tabs detail-tab-grid project-detail-tabs" role="tablist" aria-label="Project sections">${detailTabButton('project', tab, 'overview','Overview')}${detailTabButton('project', tab, 'quotes',`Quotes (${quotes.length})`)}${detailTabButton('project', tab, 'invoices',`Invoices (${invoices.length})`)}${detailTabButton('project', tab, 'labor',`Labor (${labor.length})`)}${detailTabButton('project', tab, 'ledger',`Ledger (${ledger.length})`)}</div>${tabs[tab] || overviewHtml}`;

  backToProjects.onclick = () => loadPage('projects');
  projectClientLink.onclick = () => renderClientDetail(project.client_id);
  root.querySelector('#openProjectClient')?.addEventListener('click', () => renderClientDetail(project.client_id));
  editProjectDetail.onclick = () => renderProjects(projectId, projectId);
  addProjectDetail.onclick = () => openScopedActionSheet({title:`Add to ${project.name}`, subtitle:'The client and project are already selected.', actions:[
    {label:'Add Labor', description:'Log work against this project.', run:() => openClientQuickModal(project.client_id, 'labor', null, {projectId, returnToProject:true})},
    {label:'Add Expense', description:'Add a project expense.', run:() => openClientQuickModal(project.client_id, 'ledger', null, {projectId, returnToProject:true, ledgerKind:'expense'})},
    {label:'New Quote', description:'Create a quote for this project.', run:() => openClientQuickModal(project.client_id, 'quotes', null, {projectId, returnToProject:true})},
    {label:'New Invoice', description:'Create an invoice for this project.', run:() => openClientQuickModal(project.client_id, 'invoices', null, {projectId, returnToProject:true})},
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
    <div id="quoteModal" class="modal-backdrop quote-editor-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="quoteFormTitle">${quoteEditorFormHtml({editing, generatedQuoteNumber, quoteNumberAttrs, settings, existingItems, formId:'quoteForm', clientSelectId:'quoteClient', projectSelectId:'quoteProject', closeButtonId:'closeQuoteModal', cancelButtonId:'cancelQuoteModal'})}</div>`;
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
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      const result = await persistQuoteEditor(form, root, editing);
      if (!result) return;
      show(editing ? 'Quote updated' : 'Quote saved'); await preloadLookups(); await renderQuotes();
    } catch (err) { alert(err.message); }
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
    <div id="invoiceModal" class="modal-backdrop invoice-editor-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="invoiceFormTitle">${invoiceEditorShellHtml({editing, generatedInvoiceNumber, invoiceNumberAttrs, presetClientId: handoff.clientId || '', scopedProjectId: handoff.projectId || '', scopedQuoteId: handoff.quoteId || '', settings, formId:'invoiceForm', clientSelectId:'invoiceClient', projectSelectId:'invoiceProject', quoteSelectId:'invoiceQuote', closeButtonId:'closeInvoiceModal'})}</div>`;
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
  await wireInvoiceInternalForm(root, {formId:'invoiceForm', clientSelectId:'invoiceClient', projectSelectId:'invoiceProject', quoteSelectId:'invoiceQuote', editing, onSave: async payload => { try { if (editing) await api(`/api/invoices/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/invoices', {method:'POST', body: JSON.stringify(payload)}); show(editing ? 'Invoice updated' : 'Invoice saved'); await preloadLookups(); await renderInvoices(); } catch (err) { alert(err.message); } }});
  setupInvoiceModal({editing, autoOpen:Boolean(handoff.autoOpen), rerender:renderInvoices});
  attachInvoiceSearch(visibleInvoices.length);
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
  const modal = document.querySelector('#clientQuickModal');
  if (!modal) return;
  if (modal._quoteEscapeHandler) document.removeEventListener('keydown', modal._quoteEscapeHandler);
  if (modal._invoiceEscapeHandler) document.removeEventListener('keydown', modal._invoiceEscapeHandler);
  const closesInvoiceEditor = modal.classList.contains('invoice-editor-backdrop');
  if (modal.classList.contains('quote-editor-backdrop') || closesInvoiceEditor) [...root.children].forEach(child => { child.inert = false; });
  if (closesInvoiceEditor) setInvoiceEditorPageState(false);
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
      } catch(err) { alert(err.message); }
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
    wrapper.innerHTML = quoteEditorFormHtml({editing, generatedQuoteNumber, quoteNumberAttrs, settings, existingItems, formId:'clientQuoteForm', projectSelectId:'clientQuoteProject', scopedClientId:clientId, scopedProjectId, clientLabel, scoped:true});
    root.appendChild(wrapper);
    wrapper._quoteReturnFocus = returnFocus;
    [...root.children].filter(child => child !== wrapper).forEach(child => { child.inert = true; });
    wrapper._quoteEscapeHandler = event => { if (event.key === 'Escape') closeClientQuickModal(); };
    document.addEventListener('keydown', wrapper._quoteEscapeHandler);
    const form = wrapper.querySelector('#clientQuoteForm');
    form.status.value = editing?.status || 'draft';
    wireQuoteLineEditor(wrapper);
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        const result = await persistQuoteEditor(form, wrapper, editing, clientId);
        if (!result) return;
        await closeAfter('quotes', isEdit ? 'Quote updated' : 'Quote saved');
      } catch(err) { alert(err.message); }
    };
  }

  if (type === 'invoices') {
    const settingsResponse = await api('/api/admin/settings');
    const settings = settingsResponse.settings || {};
    const generatedInvoiceNumber = editing?.invoice_number || await nextInvoiceNumber();
    const invoiceNumberAttrs = isEdit ? '' : ' readonly aria-readonly="true" title="Generated automatically to prevent duplicate invoice numbers"';
    wrapper.classList.add('invoice-editor-backdrop');
    wrapper.setAttribute('aria-labelledby', 'clientInvoiceFormTitle');
    wrapper.innerHTML = invoiceEditorShellHtml({editing, generatedInvoiceNumber, invoiceNumberAttrs, scopedClientId: clientId, scopedProjectId, scopedQuoteId, clientLabel, settings, formId:'clientInvoiceForm', projectSelectId:'clientInvoiceProject', quoteSelectId:'clientInvoiceQuote'});
    root.appendChild(wrapper);
    wrapper._quoteReturnFocus = returnFocus;
    [...root.children].filter(child => child !== wrapper).forEach(child => { child.inert = true; });
    setInvoiceEditorPageState(true);
    wrapper._invoiceEscapeHandler = event => { if (event.key === 'Escape') closeClientQuickModal(); };
    document.addEventListener('keydown', wrapper._invoiceEscapeHandler);
    await wireInvoiceInternalForm(wrapper, {formId:'clientInvoiceForm', projectSelectId:'clientInvoiceProject', quoteSelectId:'clientInvoiceQuote', editing, scopedClientId: clientId, onSave: async payload => { try { if (isEdit) await api(`/api/invoices/${editing.id}`, {method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/invoices', {method:'POST', body: JSON.stringify(payload)}); await closeAfter('invoices', isEdit ? 'Invoice updated' : 'Invoice saved'); } catch(err) { alert(err.message); } }});
  }

  if (type === 'labor') {
    const settingsResponse = await api('/api/admin/settings');
    const settings = settingsResponse.settings || {};
    const defaultRate = settings.default_labor_rate || '100.00';
    wrapper.innerHTML = `<div class="modal-card"><div class="modal-header"><div><h2>${isEdit ? 'Edit Labor Entry' : 'Add Labor Entry'}</h2><p>${isEdit ? 'Update this labor entry without leaving the client.' : `Add labor for ${clientLabel}.`}</p></div><button class="ghost modal-close" type="button" aria-label="Close labor form">×</button></div><form id="clientLaborForm" class="form-grid">
      <label>Work Date<input name="work_date" type="date" required value="${escapeHtml(editing?.work_date || todayIso())}"></label>${clientHidden}
      <label>Project<select name="project_id" id="clientLaborProject">${projectOptions(scopedProjectId, clientId)}</select></label><label>Status<select name="status"><option value="planned">Planned</option><option value="completed">Completed</option><option value="invoiced">Invoiced</option><option value="paid">Paid</option><option value="canceled">Canceled</option></select></label>
      <label>Service Type<select name="service_type" required><option value="">Select service...</option>${optionList(state.dropdowns.service_type, editing?.service_type)}</select></label><label>Hours<input name="hours" type="number" step="0.25" min="0" required value="${escapeHtml(editing?.hours ?? '')}"></label>
      <label>Hourly Rate<input name="hourly_rate" type="number" step="0.01" min="0.01" required value="${escapeHtml(editing?.hourly_rate || defaultRate)}"></label><label>Invoice<select name="invoice_id" id="clientLaborInvoice">${invoiceOptions(editing?.invoice_id, clientId, scopedProjectId)}</select></label>
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
      <label data-ledger-project-wrap>Project<select name="project_id">${projectOptions(scopedProjectId, clientId)}</select></label>
      <label data-ledger-quote-wrap>Quote<select name="quote_id">${quoteOptions(editing?.quote_id, clientId, scopedProjectId)}</select></label><label data-ledger-invoice-wrap>Invoice<select name="invoice_id">${invoiceOptions(editing?.invoice_id, clientId, scopedProjectId)}</select></label>
      <label class="full">Receipt Photo/PDF<input name="receipt_file" type="file" accept="image/*,application/pdf"></label>${editing?.receipt_id ? `<div class="full muted">Attached receipt: ${receiptPreviewButton(editing.receipt_id, 'Preview receipt')}</div>` : ''}
      <label class="full">Description<textarea name="description">${escapeHtml(editing?.description)}</textarea></label>
      <div class="form-actions"><button class="primary" type="submit">${isEdit ? 'Update Ledger Entry' : 'Save Ledger Entry'}</button><button class="ghost quick-cancel" type="button">Cancel</button></div>
    </form></div>`;
    root.appendChild(wrapper);
    const form = wrapper.querySelector('#clientLedgerForm');
    form.kind.value = opts.ledgerKind || editingKind;
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
    </div><p class="muted">Reserve cards show the remaining tax buckets after payments. Net profit plus the remaining Sales Tax and Income Tax reserves equals net income. Invoice totals are shown separately for receivables tracking.</p></div>
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
    <label>Sales Tax Rate<input name="sales_tax_rate" type="number" min="0" max="100" step="0.01" value="${escapeHtml(settings.sales_tax_rate || '0.07')}" placeholder="7 or 0.07"><small>Enter 7 or 0.07 for 7%.</small></label>
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
  control.addEventListener('click', () => runQuickCreate(control.dataset.quickCreate).catch(err => alert(err.message)));
});
document.addEventListener('click', event => {
  const btn = event.target.closest('[data-action="preview-receipt"]');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  openReceiptPreviewModal(Number(btn.dataset.id)).catch(err => alert(err.message || 'Unable to preview receipt.'));
});
document.addEventListener('keydown', trapShellDialogFocus);
document.querySelectorAll('.nav[data-page]').forEach(button => {
  button.addEventListener('click', () => navigateFromNavigation(button.dataset.page).catch(err => alert(err.message)));
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
