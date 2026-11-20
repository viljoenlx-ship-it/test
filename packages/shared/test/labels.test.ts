import { describe, expect, it } from 'vitest';
import {
  applyScanToLines,
  barcodeSymbology,
  buildLabelPdf,
  defaultLabelCopies,
  ean13Modules,
  isScanBurst,
  isValidEan13,
  labelPagePoints,
  labelPixels,
  nextGoodsReceiptNumber,
  nextInternalBarcode,
  nextInternalSequence,
  printerLabelPixels,
  pushScanKey,
  totalLabelCopies,
  truncateLabelText,
  zipStoredFiles,
  type ScanSample,
} from '../src/labels';

function burst(code: string, start = 0, gap = 10): ScanSample[] {
  return [...code].map((key, index) => ({ key, at: start + index * gap }));
}

describe('barcodes', () => {
  it('accepts a valid EAN-13 and rejects a bad check digit', () => {
    expect(isValidEan13('9900000001001')).toBe(true);
    expect(isValidEan13('9900000001002')).toBe(false);
    expect(barcodeSymbology('9900000001001')).toBe('ean-13');
    expect(barcodeSymbology('OM00000001')).toBe('code128');
    expect(ean13Modules('9900000001001')).toHaveLength(113);
  });

  it('keeps internal codes unique inside one set and allows the same code in another set', () => {
    const atlas = new Set<string>();
    const first = nextInternalBarcode(atlas, nextInternalSequence(atlas));
    atlas.add(first);
    const second = nextInternalBarcode(atlas, nextInternalSequence(atlas));
    const otherTenant = nextInternalBarcode(new Set(), 1);
    expect(first).toBe('OM00000001');
    expect(second).toBe('OM00000002');
    expect(otherTenant).toBe(first);
    expect(nextInternalBarcode(new Set(['OM00000001', 'OM00000002']), 1)).toBe('OM00000003');
  });
});

describe('label batch quantities', () => {
  it('defaults to one label per received unit, with a whole-label rule', () => {
    expect(defaultLabelCopies('6')).toBe(6);
    expect(defaultLabelCopies('2.4')).toBe(2);
    expect(defaultLabelCopies('2.5')).toBe(3);
    expect(defaultLabelCopies('0.4')).toBe(1);
    expect(defaultLabelCopies('0')).toBe(0);
    expect(defaultLabelCopies('300')).toBe(200);
  });

  it('skips a line and sums the copies that will print', () => {
    expect(
      totalLabelCopies([
        { included: true, copies: 6 },
        { included: false, copies: 4 },
        { included: true, copies: 2.9 },
      ]),
    ).toBe(8);
  });

  it('numbers the next goods receipt after the highest GRV number', () => {
    expect(nextGoodsReceiptNumber([])).toBe('GRV-1001');
    expect(nextGoodsReceiptNumber(['GRV-1042', 'Opening'])).toBe('GRV-1043');
  });

  it('truncates a long item name on a word', () => {
    expect(truncateLabelText('Chipboard screw 4 x 50 mm')).toBe('Chipboard screw 4 x 50 mm');
    expect(truncateLabelText('Portland cement 42.5 N, 50 kg')).toBe('Portland cement 42.5 N, 50…');
  });

  it('sizes a 50 by 15 mm page at 203 dpi and a narrower M2_H print head', () => {
    expect(labelPixels(50, 15, 203)).toEqual({ width: 400, height: 120 });
    expect(labelPagePoints(50, 15)).toEqual({ width: '141.73', height: '42.52' });
    expect(printerLabelPixels(50, 15, 300, 567)).toEqual({ width: 567, height: 177 });
  });

  it('builds one PDF page per label at the label size', () => {
    const rgb = new Uint8Array(400 * 120 * 3);
    const pdf = buildLabelPdf(
      [
        { width: 400, height: 120, rgb },
        { width: 400, height: 120, rgb },
      ],
      50,
      15,
    );
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 141.73 42.52]');
    expect(text).toContain('/Width 400');
    expect(text).toContain('/Height 120');
  });

  it('packs label files into a zip the Niimbot app can open', () => {
    const zip = zipStoredFiles([{ name: 'GRV-1042-1.png', bytes: Uint8Array.from([1, 2, 3]) }]);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain('GRV-1042-1.png');
    expect(text).toContain('PK');
  });
});

describe('scanner input', () => {
  it('treats a fast burst and Enter as a scan', () => {
    const samples = burst('9900000001002');
    const enterAt = 10 * (samples.length - 1) + 12;
    expect(isScanBurst(samples, enterAt)).toBe(true);
    expect(pushScanKey(samples, 'Enter', enterAt)).toEqual({
      samples: [],
      code: '9900000001002',
      burst: true,
    });
  });

  it('does not treat slow typing as a scanner burst', () => {
    let samples: ScanSample[] = [];
    let at = 0;
    for (const key of '9900000001002') {
      const pushed = pushScanKey(samples, key, at);
      samples = pushed.samples;
      at += 180;
    }
    const result = pushScanKey(samples, 'Enter', at);
    expect(result.code).toBe('9900000001002');
    expect(result.burst).toBe(false);
  });

  it('starts a new code after a pause and ignores a short burst', () => {
    const paused = pushScanKey(burst('ABCDE', 0, 10), 'Z', 800);
    expect(paused.samples.map((sample) => sample.key).join('')).toBe('Z');
    const short = burst('AB');
    expect(pushScanKey(short, 'Enter', 30).burst).toBe(false);
  });

  it('adds a scanned item or increases the quantity already on the receipt', () => {
    const first = applyScanToLines([], 'screw');
    expect(first).toEqual([{ itemId: 'screw', quantity: '1' }]);
    expect(applyScanToLines(first, 'screw')).toEqual([{ itemId: 'screw', quantity: '2' }]);
    expect(applyScanToLines([{ itemId: 'screw', quantity: '2.5' }], 'cement')).toEqual([
      { itemId: 'screw', quantity: '2.5' },
      { itemId: 'cement', quantity: '1' },
    ]);
  });
});
