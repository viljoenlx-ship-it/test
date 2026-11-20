import { printerLabelPixels } from '@omnivate/shared';
import type { NiimbotBluetoothClient } from '@mmote/niimbluelib';
import { drawLabel, type RasterLabel } from './label-sheet';

/**
 * Direct printing uses @mmote/niimbluelib 0.49.1 (MIT, © 2024 MultiMote).
 * The M2_H is model id 4608 and uses that library's B1 print task.
 * The library is not affiliated with Niimbot.
 * https://github.com/MultiMote/niimbluelib
 */

const PRINTER_KEY = 'omnivate.niimbot.printer';

type GrantedDevice = { id: string; name?: string };

function bluetoothApi(): {
  getDevices?: () => Promise<GrantedDevice[]>;
} | null {
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
    return null;
  }
  return (
    (navigator as Navigator & { bluetooth?: { getDevices?: () => Promise<GrantedDevice[]> } })
      .bluetooth ?? null
  );
}

export type RememberedPrinter = { id: string; name: string };

let client: NiimbotBluetoothClient | null = null;
let connectedName = '';

export function webBluetoothAvailable(): boolean {
  return bluetoothApi() !== null;
}

export function rememberedPrinter(): RememberedPrinter | null {
  try {
    const raw = localStorage.getItem(PRINTER_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<RememberedPrinter>;
    if (!parsed.id || !parsed.name) {
      return null;
    }
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

export function connectedPrinterName(): string {
  return connectedName;
}

function printerTitle(model: string | undefined, deviceName: string): string {
  if (model === 'M2_H') {
    return 'Niimbot M2_H';
  }
  if (model && model !== 'UNKNOWN') {
    return `Niimbot ${model.replaceAll('_', ' ')}`;
  }
  return deviceName || 'Niimbot';
}

export async function connectNiimbot(): Promise<string> {
  if (!webBluetoothAvailable()) {
    throw new Error('This browser cannot connect to a printer.');
  }
  const { NiimbotBluetoothClient } = await import('@mmote/niimbluelib');
  if (client?.isConnected() && connectedName) {
    return connectedName;
  }
  client = new NiimbotBluetoothClient();
  const saved = rememberedPrinter();
  const bluetooth = bluetoothApi();
  const before = bluetooth?.getDevices ? await bluetooth.getDevices() : [];
  const known = saved ? before.find((device) => device.id === saved.id) : undefined;
  const info = await client.connect(
    known
      ? {
          authorizedDevice: known as NonNullable<
            Parameters<NiimbotBluetoothClient['connect']>[0]
          >['authorizedDevice'],
        }
      : undefined,
  );
  const devices = bluetooth?.getDevices ? await bluetooth.getDevices() : [];
  const match =
    devices.find((device) => device.name && info.deviceName && device.name === info.deviceName) ??
    (known && devices.some((device) => device.id === known?.id) ? known : undefined) ??
    devices.at(-1);
  const name = printerTitle(client.getModelMetadata()?.model, match?.name || info.deviceName || '');
  if (match?.id) {
    localStorage.setItem(PRINTER_KEY, JSON.stringify({ id: match.id, name }));
  }
  connectedName = name;
  return name;
}

export async function printOnNiimbot(input: {
  labels: RasterLabel[];
  widthMm: number;
  heightMm: number;
  onProgress: (done: number, total: number) => void;
}): Promise<void> {
  if (!client?.isConnected()) {
    await connectNiimbot();
  }
  if (!client?.isConnected()) {
    throw new Error('Connect the printer first.');
  }
  const { ImageEncoder, PageColorType } = await import('@mmote/niimbluelib');
  const meta = client.getModelMetadata();
  const taskName = client.getPrintTaskType() ?? 'B1';
  const pixels = printerLabelPixels(
    input.widthMm,
    input.heightMm,
    meta?.dpi ?? 300,
    meta?.printheadPixels ?? 567,
  );
  const canvas = document.createElement('canvas');
  const task = client.protocol.newPrintTask(taskName, {
    totalPages: input.labels.length,
    statusPollIntervalMs: 100,
    statusTimeoutMs: 8_000,
    pageColor: PageColorType.SingleColor,
    density: meta?.densityDefault ?? 3,
  });
  try {
    await task.printInit();
    for (let index = 0; index < input.labels.length; index += 1) {
      const label = input.labels[index];
      if (!label) {
        continue;
      }
      drawLabel(canvas, label, pixels);
      const encoded = ImageEncoder.encodeCanvas(
        canvas,
        PageColorType.SingleColor,
        meta?.printDirection ?? 'top',
      );
      await task.printPage(encoded, 1);
      await task.waitForPageFinished();
      input.onProgress(index + 1, input.labels.length);
    }
    await task.waitForFinished();
  } finally {
    await task.printEnd();
  }
}

export function printerError(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === 'NotFoundError' || error.name === 'NotAllowedError')
  ) {
    return 'Printer connection was cancelled.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'The printer did not print.';
}
