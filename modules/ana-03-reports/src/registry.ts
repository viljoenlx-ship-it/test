import type { ReportSource } from './types';
import { ReportError } from './types';

const sources = new Map<string, ReportSource>();

/**
 * Plug a data source into Reports.
 * Invoicing and the ledger will call this when they load. They do not edit this module.
 */
export function registerReportSource(source: ReportSource): void {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(source.key)) {
    throw new ReportError(`Report source ${source.key} is not a safe key.`);
  }
  sources.set(source.key, source);
}

export function listReportSources(): ReportSource[] {
  return [...sources.values()];
}

export function getReportSource(key: string): ReportSource | undefined {
  return sources.get(key);
}

export function resetReportSourcesForTests(): void {
  sources.clear();
}
