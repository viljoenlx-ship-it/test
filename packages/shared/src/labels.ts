/**
 * Goods-receipt labels and keyboard-wedge scans.
 * Quantities are decimal strings. Copies are whole labels.
 * A 50×15 mm label at 203 dpi is 400×120 pixels.
 */

export const LABEL_WIDTH_MM = 50;
export const LABEL_HEIGHT_MM = 15;
export const LABEL_DPI = 203;
export const LABEL_COPY_MAX = 200;

const LEFT_ODD = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const LEFT_EVEN = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const RIGHT = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

const INTERNAL_BARCODE = /^OM(\d{8})$/;
const SCAN_GAP_MS = 45;
const SCAN_SPAN_MS = 280;
const SCAN_RESET_MS = 500;
const SCAN_MIN_CHARS = 4;

export type ScanSample = { key: string; at: number };

export type ScanPush = {
  samples: ScanSample[];
  code: string | null;
  burst: boolean;
};

export function ean13CheckDigit(body: string): number {
  if (!/^\d{12}$/.test(body)) {
    throw new Error('An EAN-13 check digit needs 12 digits.');
  }
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = Number(body[index]);
    sum += digit * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) {
    return false;
  }
  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

export function barcodeSymbology(value: string): 'ean-13' | 'code128' {
  return isValidEan13(value) ? 'ean-13' : 'code128';
}

/** Module row for a valid EAN-13, with a quiet zone of 9 modules on each side. */
export function ean13Modules(value: string): number[] {
  if (!isValidEan13(value)) {
    throw new Error('That is not a valid EAN-13 barcode.');
  }
  const digits = [...value].map((digit) => Number(digit));
  const parity = PARITY[digits[0] ?? 0] ?? 'LLLLLL';
  let bits = '0'.repeat(9) + '101';
  for (let index = 1; index <= 6; index += 1) {
    const digit = digits[index] ?? 0;
    const pattern = parity[index - 1] === 'G' ? LEFT_EVEN[digit] : LEFT_ODD[digit];
    bits += pattern ?? '';
  }
  bits += '01010';
  for (let index = 7; index <= 12; index += 1) {
    bits += RIGHT[digits[index] ?? 0] ?? '';
  }
  bits += `101${'0'.repeat(9)}`;
  return [...bits].map((bit) => (bit === '1' ? 1 : 0));
}

export function barcodeTextError(value: string): string | null {
  if (value.length < 1) {
    return 'Enter a barcode.';
  }
  if (value.length > 40) {
    return 'That barcode is too long.';
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      return 'This barcode uses letters, numbers, and basic symbols only.';
    }
  }
  return null;
}

export function internalBarcode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99_999_999) {
    throw new Error('Barcode sequence is out of range.');
  }
  return `OM${String(sequence).padStart(8, '0')}`;
}

export function nextInternalSequence(taken: Iterable<string>): number {
  let max = 0;
  for (const code of taken) {
    const match = INTERNAL_BARCODE.exec(code);
    const sequence = match?.[1] ? Number(match[1]) : 0;
    if (sequence > max) {
      max = sequence;
    }
  }
  return max + 1;
}

/** Next OM######## code that is not in `taken`. Callers scope `taken` to one tenant. */
export function nextInternalBarcode(taken: ReadonlySet<string>, start = 1): string {
  let sequence = Math.max(1, start);
  for (let attempt = 0; attempt < 100_000; attempt += 1) {
    const code = internalBarcode(sequence);
    sequence += 1;
    if (!taken.has(code)) {
      return code;
    }
  }
  throw new Error('No free barcode is left.');
}

export function truncateLabelText(value: string, max = 28): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) {
    return text;
  }
  const slice = text.slice(0, max - 1);
  const space = slice.lastIndexOf(' ');
  const base = (space >= 10 ? slice.slice(0, space) : slice).replace(/[\s,.;:–-]+$/u, '');
  return `${base}…`;
}

/** Whole labels for one received quantity. Half a unit rounds away from zero, and any positive quantity gets at least one label. */
export function defaultLabelCopies(quantity: string): number {
  const text = quantity.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) {
    return 0;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  const whole = Math.floor(value);
  const fraction = value - whole;
  const rounded = fraction >= 0.5 ? whole + 1 : whole;
  return Math.min(LABEL_COPY_MAX, Math.max(1, rounded));
}

export function clampLabelCopies(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const whole = Math.trunc(value);
  if (whole < 1) {
    return 0;
  }
  return Math.min(LABEL_COPY_MAX, whole);
}

export function totalLabelCopies(lines: readonly { included: boolean; copies: number }[]): number {
  return lines.reduce((sum, line) => sum + (line.included ? clampLabelCopies(line.copies) : 0), 0);
}

export function labelPixels(
  widthMm: number,
  heightMm: number,
  dpi = LABEL_DPI,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round((widthMm / 25.4) * dpi)),
    height: Math.max(1, Math.round((heightMm / 25.4) * dpi)),
  };
}

export function labelPagePoints(
  widthMm: number,
  heightMm: number,
): { width: string; height: string } {
  return {
    width: ((widthMm * 72) / 25.4).toFixed(2),
    height: ((heightMm * 72) / 25.4).toFixed(2),
  };
}

/** Fit a label onto a print head. The M2_H head is 567 dots at 300 dpi, narrower than a 50 mm label. */
export function printerLabelPixels(
  widthMm: number,
  heightMm: number,
  dpi: number,
  printheadPixels: number,
): { width: number; height: number } {
  const natural = labelPixels(widthMm, heightMm, dpi);
  return {
    width: Math.max(1, Math.min(printheadPixels, natural.width)),
    height: natural.height,
  };
}

export function nextGoodsReceiptNumber(existing: readonly string[]): string {
  let max = 1000;
  for (const number of existing) {
    const match = /^GRV-(\d+)$/.exec(number.trim());
    const value = match?.[1] ? Number(match[1]) : 0;
    if (value > max) {
      max = value;
    }
  }
  return `GRV-${String(max + 1).padStart(4, '0')}`;
}

export type CaptureLine = { itemId: string; quantity: string };

export function bumpQuantity(quantity: string): string {
  const match = /^(\d+)(\.\d{1,4})?$/.exec(quantity.trim());
  if (!match?.[1]) {
    return '1';
  }
  return `${Number(match[1]) + 1}${match[2] ?? ''}`;
}

/** Scanning a known item adds a line, or adds one to the quantity already on the receipt. */
export function applyScanToLines(lines: readonly CaptureLine[], itemId: string): CaptureLine[] {
  const index = lines.findIndex((line) => line.itemId === itemId);
  if (index < 0) {
    return [...lines, { itemId, quantity: '1' }];
  }
  return lines.map((line, lineIndex) =>
    lineIndex === index ? { ...line, quantity: bumpQuantity(line.quantity) } : line,
  );
}

export function isScanBurst(samples: readonly ScanSample[], enterAt: number): boolean {
  if (samples.length < SCAN_MIN_CHARS) {
    return false;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) {
    return false;
  }
  if (enterAt - first.at > SCAN_SPAN_MS || enterAt - last.at > SCAN_GAP_MS) {
    return false;
  }
  let previous = first.at;
  for (const sample of samples) {
    if (sample.at - previous > SCAN_GAP_MS) {
      return false;
    }
    previous = sample.at;
  }
  return true;
}

/**
 * A keyboard-wedge scanner types the code and sends Enter.
 * Fast gaps are a scan. A pause starts a new code. Enter always yields what was typed.
 */
export function pushScanKey(samples: readonly ScanSample[], key: string, at: number): ScanPush {
  if (key === 'Enter') {
    const code = samples.map((sample) => sample.key).join('');
    return {
      samples: [],
      code: code.length > 0 ? code : null,
      burst: code.length > 0 && isScanBurst(samples, at),
    };
  }
  if (key.length !== 1) {
    return { samples: [...samples], code: null, burst: false };
  }
  const last = samples[samples.length - 1];
  const fresh = !last || at - last.at > SCAN_RESET_MS;
  const next = fresh ? [{ key, at }] : [...samples, { key, at }].slice(-64);
  return { samples: next, code: null, burst: false };
}

export function buildLabelPdf(
  images: readonly { width: number; height: number; rgb: Uint8Array }[],
  widthMm: number,
  heightMm: number,
): Uint8Array {
  if (images.length === 0) {
    throw new Error('A label file needs at least one label.');
  }
  const box = labelPagePoints(widthMm, heightMm);
  const encoder = new TextEncoder();
  const bodies: (string | Uint8Array)[] = [];
  const pageIds: number[] = [];
  bodies.push('<< /Type /Catalog /Pages 2 0 R >>');
  bodies.push('');
  images.forEach((image, index) => {
    if (
      image.width < 1 ||
      image.height < 1 ||
      image.rgb.length !== image.width * image.height * 3
    ) {
      throw new Error('Label image size does not match its pixels.');
    }
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    pageIds.push(pageId);
    const stream = `q\n${box.width} 0 0 ${box.height} 0 0 cm\n/Im0 Do\nQ`;
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${box.width} ${box.height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    bodies.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const header = encoder.encode(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.rgb.length} >>\nstream\n`,
    );
    const footer = encoder.encode('\nendstream');
    bodies.push(concatBytes([header, image.rgb, footer]));
  });
  bodies[1] = `<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;

  const parts: Uint8Array[] = [encoder.encode('%PDF-1.4\n')];
  const offsets = [0];
  let cursor = parts[0]?.length ?? 0;
  bodies.forEach((body, index) => {
    offsets.push(cursor);
    const header = encoder.encode(`${index + 1} 0 obj\n`);
    const content = typeof body === 'string' ? encoder.encode(body) : body;
    const chunk = concatBytes([header, content, encoder.encode('\nendobj\n')]);
    parts.push(chunk);
    cursor += chunk.length;
  });
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF`;
  parts.push(encoder.encode(xref));
  return concatBytes(parts);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date): { time: number; day: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** Stored (uncompressed) zip. Used for a batch of label PNGs. */
export function zipStoredFiles(
  files: readonly { name: string; bytes: Uint8Array }[],
  modified = new Date(2026, 10, 19, 8, 0, 0),
): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosTime(modified);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length + file.bytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, stamp.time, true);
    view.setUint16(10, stamp.day, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.bytes.length, true);
    view.setUint32(22, file.bytes.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(file.bytes, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.day, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.bytes.length, true);
    centralView.setUint32(24, file.bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralBytes = concatBytes(centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, offset, true);
  return concatBytes([...locals, centralBytes, end]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
