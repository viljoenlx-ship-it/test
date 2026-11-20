/** Wording shown in the company app and the control panel. */
export const copy = {
  switchedOff: 'Document capture is switched off for this company.',
  tooLarge: 'That file is larger than 12 MB.',
  badType: 'Use a JPG, PNG, HEIC, or PDF.',
  empty: 'That file is empty.',
  chooseFile: 'Choose a file to snap.',
  couldNotRead: 'Could not read this document. Try a clearer photo or a PDF.',
  notFound: 'That document was not found.',
  notReady: 'This document is not ready to receive.',
  needItems: 'Match every line to a stock item before receiving.',
  needBranch: 'Choose the branch that is receiving this stock.',
  duplicate: 'A document with this supplier and number is already on file.',
  currency: 'Stock is received in rand. Set the currency to ZAR before receiving.',
  stockOff: 'Stock is switched off for this company.',
  cannotCapture: 'Your role cannot snap documents.',
  cannotReview: 'Your role cannot open documents.',
  cannotEdit: 'This document can no longer be edited.',
  alreadyReceived: 'This document has already been received.',
  notReceived: 'This document has not been received.',
  alreadyUndone: 'This receipt has already been reversed.',
  checkFields: 'Check Highlighted Fields',
  reading: 'Reading Document',
  queued: 'Queued',
  ready: 'Ready For Review',
  failed: 'Could Not Read',
  received: 'Received',
  reversed: 'Reversed',
  createSupplier: 'Create Supplier',
  createItem: 'Create Item',
  receiveStock: 'Receive Stock',
  undoReceipt: 'Undo Receipt',
  pagesRead: 'Pages Read',
  premiumFallback:
    'Premium Reader is selected, but no key is configured. This company is using the Standard Reader.',
  moduleName: 'Document Capture',
  signIn: 'Sign in again.',
  supplierName: 'Enter a supplier name of at least 2 characters.',
  itemName: 'Enter a description before creating an item.',
} as const;

export const STATUS_LABEL = {
  queued: copy.queued,
  reading: copy.reading,
  ready: copy.ready,
  failed: copy.failed,
  posted: copy.received,
  reversed: copy.reversed,
} as const;

export type DocumentStatus = keyof typeof STATUS_LABEL;

export function statusLabel(status: string): string {
  if (status in STATUS_LABEL) {
    return STATUS_LABEL[status as DocumentStatus];
  }
  return status;
}
