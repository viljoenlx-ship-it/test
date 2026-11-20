import { copy } from './copy';
import { DocumentError } from './errors';

export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

const HEIC_BRANDS = new Set(['heic', 'heix', 'heif', 'mif1', 'msf1', 'heim', 'heis']);

export type SniffedFile = {
  contentType: 'image/jpeg' | 'image/png' | 'image/heic' | 'application/pdf';
  extension: 'jpg' | 'png' | 'heic' | 'pdf';
};

export function sniffDocument(bytes: Buffer): SniffedFile {
  if (bytes.length === 0) {
    throw new DocumentError(copy.empty);
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentError(copy.tooLarge);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii').toLowerCase();
    if (HEIC_BRANDS.has(brand)) {
      return { contentType: 'image/heic', extension: 'heic' };
    }
  }
  throw new DocumentError(copy.badType);
}

/** Counts PDF pages without a parser. Images are one page. */
export function countPages(bytes: Buffer, contentType: string): number {
  if (contentType !== 'application/pdf') {
    return 1;
  }
  const text = bytes.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return Math.max(1, matches?.length ?? 1);
}

export function tidyFilename(value: string): string {
  const base = value.replace(/\\/g, '/').split('/').pop() ?? 'document';
  const cleaned = base.replace(/[^\w.\- ()]+/g, '').trim();
  return (cleaned || 'document').slice(0, 180);
}
