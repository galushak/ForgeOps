function invoiceReferences(invoices) {
  const numbers = invoices.map(invoice => String(invoice?.invoice_number || '').trim()).filter(Boolean);
  if (!numbers.length) return invoices.length === 1 ? 'an existing Invoice' : `${invoices.length} existing Invoices`;
  if (numbers.length === 1) return `Invoice ${numbers[0]}`;
  const shown = numbers.slice(0, 4);
  const remaining = invoices.length - shown.length;
  return `Invoices ${shown.join(', ')}${remaining > 0 ? `, plus ${remaining} more` : ''}`;
}

export function duplicateInvoiceDialogOptions(invoices = []) {
  const linkedInvoices = Array.isArray(invoices) ? invoices : [];
  return {
    title: 'Invoice Already Exists',
    message: `This Quote is already associated with ${invoiceReferences(linkedInvoices)}. You can still create another Invoice if needed.`,
    kind: 'warning',
    primaryButtonText: 'Create Another Invoice',
    cancelButtonText: 'Cancel',
  };
}

export async function startQuoteInvoiceDecision({quote, loadLinkedInvoices, confirmDuplicate, openEditor}) {
  const linkedInvoices = await loadLinkedInvoices(Number(quote.id));
  if (linkedInvoices.length) {
    const shouldContinue = await confirmDuplicate(duplicateInvoiceDialogOptions(linkedInvoices));
    if (!shouldContinue) return {opened: false, linkedInvoices};
  }

  const context = {
    clientId: Number(quote.client_id),
    projectId: quote.project_id == null ? null : Number(quote.project_id),
    quoteId: Number(quote.id),
  };
  await openEditor(context);
  return {opened: true, linkedInvoices, context};
}
