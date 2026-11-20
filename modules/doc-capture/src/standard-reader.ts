import { countPages } from './files';
import type { DocumentReader } from './reader';
import { recognizeImage } from './standard/ocr';
import { parseInvoiceText } from './standard/parse-invoice';
import { extractPdfText } from './standard/pdf-text';

const TEXT_LAYER_ENOUGH = 40;

/**
 * Included reader. A PDF uses its text layer first. Photos are read locally.
 * Nothing is sent to a paid service.
 */
export const standardReader: DocumentReader = {
  name: 'standard',
  async read(input) {
    const pages = countPages(input.bytes, input.contentType);
    let text = '';
    if (input.contentType === 'application/pdf') {
      text = extractPdfText(input.bytes);
    }
    if (text.trim().length < TEXT_LAYER_ENOUGH) {
      if (input.contentType === 'application/pdf') {
        throw new Error('reader_status_no_text');
      }
      text = await recognizeImage(input.bytes);
    }
    if (text.trim().length < 8) {
      throw new Error('reader_status_empty');
    }
    return parseInvoiceText(text, pages);
  },
};
