import {
  formatReportNumber,
  formatSaDate,
  formatZar,
  money,
  type ReportFieldType,
} from '@omnivate/shared';

const ACTIONS: Record<string, string> = {
  'scm.movement.receipt': 'Stock Receipt',
  'scm.movement.issue': 'Stock Issue',
  'scm.movement.adjust': 'Stock Adjustment',
  'scm.movement.transfer': 'Stock Transfer',
  'scm.movement.reverse': 'Stock Reversal',
  'report.saved': 'Report Saved',
  'report.exported': 'Report Exported',
  'report.archived': 'Report Archived',
};

export type Presented = { text: string; chart: number | null };

function asBigint(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function actionLabel(value: string): string {
  const known = ACTIONS[value];
  if (known) {
    return known;
  }
  const last = value.split('.').pop() ?? value;
  return last.replaceAll('_', ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function presentValue(type: ReportFieldType, value: unknown, display?: 'action'): Presented {
  if (value === null || value === undefined || value === '') {
    return { text: '', chart: null };
  }
  if (display === 'action') {
    return { text: actionLabel(String(value)), chart: null };
  }
  if (type === 'money') {
    const cents = asBigint(value) ?? asBigint(String(Math.round(Number(value))));
    if (cents === null) {
      return { text: '', chart: null };
    }
    return { text: formatZar(money(cents)), chart: Number(cents) / 100 };
  }
  if (type === 'number') {
    const text = typeof value === 'bigint' ? value.toString() : String(value);
    const chart = Number(text);
    return {
      text: formatReportNumber(text),
      chart: Number.isFinite(chart) ? chart : null,
    };
  }
  if (type === 'date') {
    const text =
      value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    return { text: formatSaDate(text), chart: null };
  }
  if (type === 'boolean') {
    const yes = value === true || value === 't' || value === 'true' || value === 'yes';
    return { text: yes ? 'Yes' : 'No', chart: yes ? 1 : 0 };
  }
  return { text: String(value), chart: null };
}
