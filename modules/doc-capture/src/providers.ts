import { demoReader } from './demo-reader';
import { openaiReader } from './openai-reader';
import type { DocumentReader } from './reader';
import { standardReader } from './standard-reader';

export type ReaderChoice = 'standard' | 'premium';

let readerOverride: DocumentReader | null = null;

/** Tests inject a reader. Production leaves this unset. */
export function setDocumentReaderForTests(reader: DocumentReader | null): void {
  readerOverride = reader;
}

export function premiumConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * The company chooses standard or premium. Premium runs only when a key is
 * configured. Otherwise the included reader is used. A test override wins.
 */
export function resolveReader(choice: ReaderChoice): {
  reader: DocumentReader;
  kind: 'standard' | 'premium';
  fellBack: boolean;
} {
  if (readerOverride) {
    const premium = readerOverride.name === 'openai';
    return { reader: readerOverride, kind: premium ? 'premium' : 'standard', fellBack: false };
  }
  const requested = (process.env.DOCUMENT_READER_PROVIDER ?? '').trim().toLowerCase();
  if (requested === 'demo') {
    return { reader: demoReader, kind: 'standard', fellBack: false };
  }
  if (choice === 'premium' && premiumConfigured()) {
    return { reader: openaiReader, kind: 'premium', fellBack: false };
  }
  if (choice === 'premium') {
    return { reader: standardReader, kind: 'standard', fellBack: true };
  }
  return { reader: standardReader, kind: 'standard', fellBack: false };
}

export function currentReader(): DocumentReader {
  return resolveReader('standard').reader;
}
