import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { HttpError } from './http';

const MAX_BYTES = 1_000_000;

export function brandingRoot(): string {
  return resolve(process.env.BRANDING_STORAGE_DIR ?? 'data/branding');
}

function extensionFor(bytes: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function contentTypeFor(key: string): string {
  if (key.endsWith('.png')) {
    return 'image/png';
  }
  if (key.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

/** The key must stay inside this tenant's folder. Callers never choose the path. */
export function logoPath(tenantId: string, key: string): string | null {
  const pattern = new RegExp(
    `^${tenantId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp)$`,
  );
  if (!pattern.test(key)) {
    return null;
  }
  const root = brandingRoot();
  const full = resolve(root, key);
  if (full !== root && !full.startsWith(root + sep)) {
    return null;
  }
  return full;
}

export async function storeLogo(tenantId: string, bytes: Buffer): Promise<string> {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    throw new HttpError(400, 'bad_request', 'The logo must be a PNG, JPEG, or WebP under 1 MB.');
  }
  const extension = extensionFor(bytes);
  if (!extension) {
    throw new HttpError(400, 'bad_request', 'The logo must be a PNG, JPEG, or WebP file.');
  }
  const key = `${tenantId}/${randomUUID()}.${extension}`;
  const path = logoPath(tenantId, key);
  if (!path) {
    throw new Error('Logo key was not tenant scoped.');
  }
  await mkdir(resolve(brandingRoot(), tenantId), { recursive: true });
  await writeFile(path, bytes);
  return key;
}

export async function readLogo(tenantId: string, key: string): Promise<Buffer | null> {
  const path = logoPath(tenantId, key);
  if (!path) {
    return null;
  }
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

export async function removeLogo(tenantId: string, key: string | null): Promise<void> {
  if (!key) {
    return;
  }
  const path = logoPath(tenantId, key);
  if (!path) {
    return;
  }
  await rm(path, { force: true });
}
