import ExcelJS from 'exceljs';
import { detectDelimiter, parseCsv, writeCsv } from './csv';

const MAX_ROWS = 50_000;
const MAX_COLUMNS = 40;

export type Sheet = {
  headers: string[];
  rows: { rowNumber: number; cells: Record<string, string> }[];
};

export class FileProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileProblem';
  }
}

export async function readUpload(fileName: string, bytes: Buffer): Promise<Sheet> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    return sheetFromMatrix(
      parseCsv(bytes.toString('utf8'), detectDelimiter(bytes.toString('utf8'))),
    );
  }
  if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new FileProblem('The workbook has no sheet to read.');
    }
    const matrix: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values;
      const cells: string[] = [];
      if (Array.isArray(values)) {
        for (let index = 1; index < values.length; index += 1) {
          cells.push(cellText(values[index]));
        }
      }
      matrix.push(cells);
    });
    return sheetFromMatrix(matrix);
  }
  throw new FileProblem('Upload an Excel file (.xlsx) or a CSV file.');
}

function sheetFromMatrix(matrix: string[][]): Sheet {
  const headerRow = matrix[0];
  if (!headerRow || headerRow.every((cell) => cell.trim() === '')) {
    throw new FileProblem('The file needs a header row.');
  }
  const headers = headerRow
    .map((cell) => cell.trim())
    .filter((cell, index, all) => {
      if (cell === '' && all.slice(index).every((later) => later.trim() === '')) {
        return false;
      }
      return true;
    });
  if (headers.length === 0) {
    throw new FileProblem('The file needs a header row.');
  }
  if (headers.length > MAX_COLUMNS) {
    throw new FileProblem(`Use at most ${MAX_COLUMNS} columns.`);
  }
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.toLowerCase();
    if (seen.has(key)) {
      throw new FileProblem(`The column “${header}” appears twice. Rename one of them.`);
    }
    seen.add(key);
  }

  const rows: Sheet['rows'] = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const line = matrix[index] ?? [];
    const cells: Record<string, string> = {};
    let blank = true;
    headers.forEach((header, column) => {
      const value = (line[column] ?? '').trim();
      cells[header] = value;
      if (value !== '') {
        blank = false;
      }
    });
    if (blank) {
      continue;
    }
    rows.push({ rowNumber: index + 1, cells });
    if (rows.length > MAX_ROWS) {
      throw new FileProblem(
        `This file has more than ${MAX_ROWS.toLocaleString('en-ZA')} rows. Split it and import each part.`,
      );
    }
  }
  if (rows.length === 0) {
    throw new FileProblem('The file has no data rows.');
  }
  return { headers, rows };
}

function cellText(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${value.getUTCFullYear()}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      return record.text.trim();
    }
    if ('result' in record) {
      return cellText(record.result);
    }
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((part) =>
          part && typeof part === 'object' && 'text' in part ? String(part.text) : '',
        )
        .join('')
        .trim();
    }
  }
  return String(value).trim();
}

export function csvFor(table: string[][]): string {
  return writeCsv(table);
}

export async function workbookFor(
  sheetName: string,
  table: string[][],
  notes: string[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Omnivate';
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of table) {
    sheet.addRow(row);
  }
  const header = sheet.getRow(1);
  header.font = { bold: true };
  sheet.columns.forEach((column) => {
    column.width = 22;
  });
  const help = workbook.addWorksheet('How to fill this in');
  for (const line of notes) {
    help.addRow([line]);
  }
  help.getColumn(1).width = 88;
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export const TEMPLATE_NOTES = [
  'Fill in the first sheet. Do not rename the header row.',
  'You can leave optional columns blank.',
  'Amounts can look like 10.50, 10,50, or R 1 234,56.',
  'Dates are written day/month/year, for example 19/11/2026.',
  'In a CSV file, put quotes around an amount that contains a comma.',
  'VAT numbers are 10 digits.',
  'This sheet is only a reminder. It is not imported.',
];
