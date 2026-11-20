import {
  LABEL_DPI,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  buildLabelPdf,
  labelPixels,
  truncateLabelText,
  zipStoredFiles,
} from '@omnivate/shared';

export type RasterLabel = {
  name: string;
  code: string;
  modules: number[];
  meta?: string;
};

export function drawLabel(
  canvas: HTMLCanvasElement,
  label: RasterLabel,
  pixels: { width: number; height: number },
): ImageData {
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('This browser cannot draw a label.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, pixels.width, pixels.height);
  context.fillStyle = '#111111';
  const nameSize = Math.max(8, Math.round(pixels.height * 0.15));
  context.font = `600 ${nameSize}px sans-serif`;
  context.textBaseline = 'top';
  context.fillText(truncateLabelText(label.name), 4, 1, pixels.width - 8);
  let barTop = nameSize + 3;
  if (label.meta) {
    const metaSize = Math.max(7, Math.round(pixels.height * 0.11));
    context.font = `${metaSize}px sans-serif`;
    context.fillText(label.meta, 4, nameSize + 1, pixels.width - 8);
    barTop = nameSize + metaSize + 3;
  }

  const barcodeWidth = Math.round(pixels.width * 0.62);
  const barcodeHeight = Math.max(8, pixels.height - barTop - 2);
  const moduleWidth = barcodeWidth / Math.max(1, label.modules.length);
  let x = 4;
  for (const bit of label.modules) {
    if (bit === 1) {
      context.fillRect(Math.round(x), barTop, Math.max(1, Math.ceil(moduleWidth)), barcodeHeight);
    }
    x += moduleWidth;
  }

  const textX = barcodeWidth + 10;
  const codeSize = Math.max(8, Math.round(pixels.height * 0.14));
  context.font = `${codeSize}px sans-serif`;
  context.fillText(label.code, textX, barTop, pixels.width - textX - 4);
  const image = context.getImageData(0, 0, pixels.width, pixels.height);
  return image;
}

function rgbFrom(image: ImageData): Uint8Array {
  const rgb = new Uint8Array(image.width * image.height * 3);
  for (let index = 0, target = 0; index < image.data.length; index += 4, target += 3) {
    rgb[target] = image.data[index] ?? 0;
    rgb[target + 1] = image.data[index + 1] ?? 0;
    rgb[target + 2] = image.data[index + 2] ?? 0;
  }
  return rgb;
}

function saveFile(bytes: Uint8Array, name: string, type: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('The label image was not created.'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

/** One 50×15 mm page per label at 203 dpi, plus a zip of the same PNGs. */
export async function downloadLabelBatch(
  labels: RasterLabel[],
  fileStem: string,
  kind: 'pdf' | 'png',
): Promise<void> {
  if (labels.length === 0) {
    throw new Error('Choose at least one label.');
  }
  const pixels = labelPixels(LABEL_WIDTH_MM, LABEL_HEIGHT_MM, LABEL_DPI);
  const canvas = document.createElement('canvas');
  if (kind === 'pdf') {
    const images = labels.map((label) => {
      const image = drawLabel(canvas, label, pixels);
      return { width: pixels.width, height: pixels.height, rgb: rgbFrom(image) };
    });
    saveFile(
      buildLabelPdf(images, LABEL_WIDTH_MM, LABEL_HEIGHT_MM),
      `${fileStem}.pdf`,
      'application/pdf',
    );
    return;
  }
  const files = [];
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (!label) {
      continue;
    }
    drawLabel(canvas, label, pixels);
    files.push({ name: `${fileStem}-${index + 1}.png`, bytes: await pngBytes(canvas) });
  }
  saveFile(zipStoredFiles(files), `${fileStem}.zip`, 'application/zip');
}
