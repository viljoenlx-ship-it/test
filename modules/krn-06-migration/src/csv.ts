/** Small CSV reader and writer. A semicolon is used when the header has more of them than commas. */

export function detectDelimiter(text: string): ',' | ';' {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const commas = (header.match(/,/g) ?? []).length;
  const semis = (header.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const src = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < src.length; index += 1) {
    const char = src[index] ?? '';
    if (quoted) {
      if (char === '"') {
        if (src[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function writeCsv(rows: string[][]): string {
  const lines = rows.map((row) => row.map(escapeCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
