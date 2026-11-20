/** A fictional supplier invoice. The numbers are not a real tax invoice. */

export const INVOICE_LINES = [
  'TAX INVOICE',
  'North Quince Supplies (Pty) Ltd',
  'VAT 4123456789',
  'Invoice No NQ-2201',
  'Date 4 March 2026',
  'Due Date 3 April 2026',
  'Brass hinge 75 mm 12 18.50 222.00',
  'Galvanised nail 50 mm 8 6.25 50.00',
  'Subtotal 272.00',
  'VAT 40.80',
  'Total 312.80',
];

export const INVOICE_TEXT = INVOICE_LINES.join('\n');

/** A one-page PDF whose text layer is the fictional invoice. */
export function invoicePdf(lines: string[] = INVOICE_LINES): Buffer {
  const commands = ['BT', '/F1 12 Tf'];
  lines.forEach((line, index) => {
    const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    commands.push(index === 0 ? '72 740 Td' : '0 -18 Td', `(${escaped}) Tj`);
  });
  commands.push('ET');
  const stream = `${commands.join('\n')}\n`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}endstream\nendobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xref = Buffer.byteLength(body);
  let xrefTable = 'xref\n0 6\n0000000000 65535 f \n';
  for (let index = 1; index <= 5; index += 1) {
    xrefTable += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `${xrefTable}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
