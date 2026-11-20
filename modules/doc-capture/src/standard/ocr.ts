import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorker, OEM, type Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

async function worker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', OEM.DEFAULT, {
      cachePath: join(tmpdir(), 'omnivate-tesseract'),
    });
  }
  return workerPromise;
}

/** Local character recognition. The text is not written to the log. */
export async function recognizeImage(bytes: Buffer): Promise<string> {
  const active = await worker();
  const result = await active.recognize(bytes);
  return result.data.text ?? '';
}
