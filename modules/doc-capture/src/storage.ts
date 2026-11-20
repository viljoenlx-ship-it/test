import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoredDocument = {
  bytes: Buffer;
  contentType: string;
};

export type DocumentStore = {
  put(input: {
    tenantId: string;
    documentId: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<void>;
  open(input: { tenantId: string; documentId: string }): Promise<StoredDocument | null>;
};

function assertUuid(value: string): string {
  if (!UUID.test(value)) {
    throw new Error('Invalid document path.');
  }
  return value.toLowerCase();
}

/**
 * Local disk for the preview. The key is tenant id plus document id, so one
 * company cannot open another's file by guessing a path. An S3-compatible
 * store can replace this without changing the routes.
 */
export function localDocumentStore(root: string): DocumentStore {
  const base = resolve(root);
  return {
    async put(input) {
      const tenantId = assertUuid(input.tenantId);
      const documentId = assertUuid(input.documentId);
      const path = join(base, tenantId, documentId);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, input.bytes);
      await writeFile(`${path}.type`, input.contentType, 'utf8');
    },
    async open(input) {
      const tenantId = assertUuid(input.tenantId);
      const documentId = assertUuid(input.documentId);
      const path = join(base, tenantId, documentId);
      try {
        const bytes = await readFile(path);
        const contentType = (await readFile(`${path}.type`, 'utf8')).trim();
        return { bytes, contentType };
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
  };
}

export function memoryDocumentStore(): DocumentStore {
  const files = new Map<string, StoredDocument>();
  return {
    async put(input) {
      const key = `${assertUuid(input.tenantId)}/${assertUuid(input.documentId)}`;
      files.set(key, { bytes: Buffer.from(input.bytes), contentType: input.contentType });
    },
    async open(input) {
      const key = `${assertUuid(input.tenantId)}/${assertUuid(input.documentId)}`;
      const hit = files.get(key);
      return hit ? { bytes: Buffer.from(hit.bytes), contentType: hit.contentType } : null;
    },
  };
}

export function documentStorageDir(): string {
  return process.env.DOCUMENT_STORAGE_DIR?.trim() || 'data/documents';
}

let storeOverride: DocumentStore | null = null;

/** Tests inject a store. Production uses the local disk directory. */
export function setDocumentStoreForTests(store: DocumentStore | null): void {
  storeOverride = store;
}

export function currentDocumentStore(): DocumentStore {
  return storeOverride ?? localDocumentStore(documentStorageDir());
}
