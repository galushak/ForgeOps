export const QUOTE_MARKUP_NAME = 'Project Coordination & Logistics';

function amount(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isQuoteMarkupItem(item) {
  return String(item?.kind || '') === 'fee'
    && String(item?.name || '').trim().toLowerCase() === QUOTE_MARKUP_NAME.toLowerCase();
}

export function quoteVendorFeeItems(items=[]) {
  return items.filter(item => String(item?.kind || '') === 'fee' && !isQuoteMarkupItem(item));
}

function quoteBaseTotals(items=[], salesTaxRate=0.07) {
  const equipment = items.filter(item => String(item?.kind || '') === 'equipment');
  const labor = items.filter(item => String(item?.kind || '') === 'labor');
  const vendorFees = quoteVendorFeeItems(items);
  const equipmentSubtotal = equipment.reduce((sum, item) => sum + amount(item.line_total), 0);
  const taxableEquipmentSubtotal = equipment
    .filter(item => item.taxable !== false)
    .reduce((sum, item) => sum + amount(item.line_total), 0);
  const vendorFeesTotal = vendorFees.reduce((sum, item) => sum + amount(item.line_total), 0);
  const laborTotal = labor.reduce((sum, item) => sum + amount(item.line_total), 0);
  const taxableBase = taxableEquipmentSubtotal + vendorFeesTotal;
  const tax = taxableBase * amount(salesTaxRate);
  return {equipmentSubtotal, taxableEquipmentSubtotal, vendorFeesTotal, laborTotal, taxableBase, tax};
}

export function calculateQuoteDraftTotals(items=[], salesTaxRate=0.07, markupPercent=0) {
  const base = quoteBaseTotals(items, salesTaxRate);
  const markupBase = base.equipmentSubtotal + base.vendorFeesTotal + base.tax;
  const markup = markupBase * (amount(markupPercent) / 100);
  const subtotal = base.equipmentSubtotal + base.vendorFeesTotal + markup + base.laborTotal;
  const equipmentTotal = base.equipmentSubtotal + base.vendorFeesTotal + base.tax + markup;
  return {...base, markupBase, markup, subtotal, equipmentTotal, total: subtotal + base.tax};
}

export function calculateQuoteTotals(items=[], salesTaxRate=0.07) {
  const base = quoteBaseTotals(items, salesTaxRate);
  const markup = items.filter(isQuoteMarkupItem).reduce((sum, item) => sum + amount(item.line_total), 0);
  const markupBase = base.equipmentSubtotal + base.vendorFeesTotal + base.tax;
  const subtotal = base.equipmentSubtotal + base.vendorFeesTotal + markup + base.laborTotal;
  const equipmentTotal = base.equipmentSubtotal + base.vendorFeesTotal + base.tax + markup;
  return {...base, markupBase, markup, subtotal, equipmentTotal, total: subtotal + base.tax};
}

export function calculateInvoiceTotals({laborTotal=0, lineItems=[], salesTaxRate=0.07}={}) {
  const materialsTotal = lineItems
    .filter(item => String(item?.kind || '') === 'material')
    .reduce((sum, item) => sum + amount(item.line_total), 0);
  const vendorFeesTotal = lineItems
    .filter(item => String(item?.kind || '') === 'vendor_fee')
    .reduce((sum, item) => sum + amount(item.line_total), 0);
  const paid = lineItems
    .filter(item => ['credit', 'payment', 'adjustment'].includes(String(item?.kind || '')))
    .reduce((sum, item) => sum + amount(item.line_total), 0);
  const subtotal = amount(laborTotal) + materialsTotal + vendorFeesTotal;
  const tax = subtotal * amount(salesTaxRate);
  const total = subtotal + tax;
  return {laborTotal: amount(laborTotal), materialsTotal, vendorFeesTotal, subtotal, taxableBase: subtotal, tax, total, paid, balance: total - paid};
}
