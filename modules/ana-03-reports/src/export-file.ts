import PDFDocument from 'pdfkit';
import type { ReportTable } from './run';

export type ReportBrand = {
  companyName: string;
  city: string | null;
  vatNumber: string | null;
  primary: string;
  logo: Buffer | null;
};

export type ReportFile = {
  filename: string;
  contentType: string;
  body: Buffer;
};

function slug(name: string): string {
  const text = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return text || 'report';
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function renderCsv(name: string, table: ReportTable): ReportFile {
  const lines = [
    csvCell(name),
    csvCell(table.summary),
    csvCell(`Prepared ${table.generatedOn}`),
    '',
    table.columns.map((column) => csvCell(column.label)).join(','),
    ...table.rows.map((row) => row.map((cell) => csvCell(cell.text)).join(',')),
  ];
  if (table.footer.length > 0) {
    const footer = table.columns.map((column, index) => {
      if (index === 0 && !table.footer.some((item) => item.key === column.key)) {
        return 'Total';
      }
      return table.footer.find((item) => item.key === column.key)?.text ?? '';
    });
    lines.push(footer.map(csvCell).join(','));
  }
  return {
    filename: `${slug(name)}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: Buffer.from(`\uFEFF${lines.join('\n')}\n`, 'utf8'),
  };
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    parts.push(local, name, file.data);
    central.push(centralHeader, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

function sheetXml(name: string, table: ReportTable): string {
  const rows: string[][] = [
    [name],
    [table.summary],
    [`Prepared ${table.generatedOn}`],
    [],
    table.columns.map((column) => column.label),
    ...table.rows.map((row) => row.map((cell) => cell.text)),
  ];
  if (table.footer.length > 0) {
    rows.push(
      table.columns.map((column, index) => {
        if (index === 0 && !table.footer.some((item) => item.key === column.key)) {
          return 'Total';
        }
        return table.footer.find((item) => item.key === column.key)?.text ?? '';
      }),
    );
  }
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map(
          (value, columnIndex) =>
            `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`,
        )
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function renderXlsx(name: string, table: ReportTable): ReportFile {
  const files = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(name, table)) },
  ];
  return {
    filename: `${slug(name)}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: zipStore(files),
  };
}

function safeColour(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#314056';
}

export function renderPdf(
  name: string,
  table: ReportTable,
  brand: ReportBrand,
): Promise<ReportFile> {
  return new Promise((resolve, reject) => {
    const wide = table.columns.length > 6;
    const doc = new PDFDocument({
      size: 'A4',
      layout: wide ? 'landscape' : 'portrait',
      margin: 36,
      compress: false,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve({
        filename: `${slug(name)}.pdf`,
        contentType: 'application/pdf',
        body: Buffer.concat(chunks),
      });
    });
    doc.on('error', reject);

    const colour = safeColour(brand.primary);
    doc.rect(0, 0, doc.page.width, 72).fill(colour);
    let titleX = 40;
    if (brand.logo && (brand.logo[0] === 0x89 || brand.logo[0] === 0xff)) {
      try {
        doc.image(brand.logo, 36, 16, { height: 40 });
        titleX = 88;
      } catch {
        titleX = 40;
      }
    }
    doc
      .fillColor('#ffffff')
      .fontSize(16)
      .text(brand.companyName, titleX, 22, {
        width: doc.page.width - titleX - 36,
        lineBreak: false,
      });
    const meta = [brand.city, brand.vatNumber ? `VAT ${brand.vatNumber}` : null, table.generatedOn]
      .filter(Boolean)
      .join('  ·  ');
    doc
      .fontSize(9)
      .text(meta, titleX, 46, { width: doc.page.width - titleX - 36, lineBreak: false });

    doc
      .fillColor('#243044')
      .fontSize(16)
      .text(name, 36, 88, { width: doc.page.width - 72 });
    doc
      .fontSize(10)
      .fillColor('#4a5968')
      .text(table.summary, 36, doc.y + 4, { width: doc.page.width - 72 });
    let y = doc.y + 16;
    const width = (doc.page.width - 72) / Math.max(table.columns.length, 1);

    const drawHeader = () => {
      doc.rect(36, y, doc.page.width - 72, 18).fill('#eef1f4');
      doc.fillColor('#243044').fontSize(8);
      table.columns.forEach((column, index) => {
        doc.text(column.label, 40 + index * width, y + 4, { width: width - 8, lineBreak: false });
      });
      y += 20;
    };
    drawHeader();

    const body = table.rows.map((row) => row.map((cell) => cell.text));
    if (table.footer.length > 0) {
      body.push(
        table.columns.map((column, index) => {
          if (index === 0 && !table.footer.some((item) => item.key === column.key)) {
            return 'Total';
          }
          return table.footer.find((item) => item.key === column.key)?.text ?? '';
        }),
      );
    }
    body.forEach((row, rowIndex) => {
      if (y > doc.page.height - 48) {
        doc.addPage();
        y = 40;
        drawHeader();
      }
      if (rowIndex === body.length - 1 && table.footer.length > 0) {
        doc.rect(36, y - 2, doc.page.width - 72, 16).fill('#f3f1ec');
      }
      doc.fillColor('#243044').fontSize(8);
      row.forEach((cell, index) => {
        const text = cell.length > 48 ? `${cell.slice(0, 45)}...` : cell;
        doc.text(text, 40 + index * width, y, { width: width - 8, lineBreak: false });
      });
      y += 16;
    });

    doc.end();
  });
}
