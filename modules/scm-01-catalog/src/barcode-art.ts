import { barcodeSymbology, ean13Modules } from '@omnivate/shared';
import { code128Modules, modulesToSvg } from './code128';

export type BarcodeArt = {
  symbology: 'ean-13' | 'code128';
  modules: number[];
  svg: string;
};

/** Code 128, or EAN-13 when the value already has a valid EAN check digit. */
export function barcodeArtwork(value: string): BarcodeArt {
  if (barcodeSymbology(value) === 'ean-13') {
    const modules = ean13Modules(value);
    return { symbology: 'ean-13', modules, svg: modulesToSvg(modules, value) };
  }
  const modules = code128Modules(value);
  return { symbology: 'code128', modules, svg: modulesToSvg(modules, value) };
}
