import PDFDocument from 'pdfkit';
import { formatSaDate } from '@omnivate/shared';

export type TabularReport = {
  title: string;
  from: string;
  to: string;
  headers: string[];
  rows: string[][];
};

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function renderCsv(table: TabularReport): {
  filename: string;
  contentType: string;
  body: string;
} {
  const lines = [
    [table.title],
    [`${formatSaDate(table.from)} to ${formatSaDate(table.to)}`],
    table.headers,
    ...table.rows,
  ];
  return {
    filename: `${slug(table.title)}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: lines.map((line) => line.map(csvCell).join(',')).join('\n'),
  };
}

export function renderPdf(
  table: TabularReport,
  companyName: string,
): Promise<{ filename: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve({
        filename: `${slug(table.title)}.pdf`,
        contentType: 'application/pdf',
        body: Buffer.concat(chunks),
      });
    });
    doc.on('error', reject);
    doc.fontSize(16).fillColor('#1c1917').text(companyName, 40, 40, { lineBreak: false });
    doc.fontSize(13).text(table.title, 40, 64);
    doc
      .fontSize(10)
      .fillColor('#57534e')
      .text(`${formatSaDate(table.from)} to ${formatSaDate(table.to)}`, 40, 84);
    doc.fillColor('#1c1917').fontSize(9);
    doc.text('', 40, 110);
    const width = doc.page.width - 80;
    const columnWidth = width / Math.max(table.headers.length, 1);
    const drawRow = (cells: string[], bold: boolean) => {
      const y = doc.y;
      cells.forEach((cell, index) => {
        doc.fontSize(bold ? 9 : 8).text(cell, 40 + index * columnWidth, y, {
          width: columnWidth - 6,
          lineBreak: false,
        });
      });
      doc.text('', 40, y + 14);
    };
    drawRow(table.headers, true);
    for (const row of table.rows) {
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
      }
      drawRow(row, false);
    }
    doc.end();
  });
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'report'
  );
}
