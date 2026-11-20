import { readLogo } from '@omnivate/module-platform-control';
import { formatSaDate, formatZar, money } from '@omnivate/shared';
import PDFDocument from 'pdfkit';
import type { TenantTransaction } from '@omnivate/kernel';
import type { Actor } from './access';
import { bankingForPdf, companyForPdf, getDocument } from './documents';

type View = Awaited<ReturnType<typeof getDocument>>;

function safeColour(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#243044';
}

function titleFor(kind: View['kind']): string {
  if (kind === 'invoice') {
    return 'Tax Invoice';
  }
  if (kind === 'credit_note') {
    return 'Credit Note';
  }
  return 'Quote';
}

export async function renderDocumentPdf(tx: TenantTransaction, actor: Actor, id: string) {
  const document = await getDocument(tx, actor, id);
  const company = await companyForPdf(tx);
  const bank = await bankingForPdf(tx);
  const logoKey = company?.logo_storage_key ?? '';
  const logo = logoKey ? await readLogo(tx.tenantId, logoKey) : null;
  const body = await draw({
    document,
    companyName: company?.company_name ?? 'Company',
    vatNumber: company?.vat_number ?? '',
    address: [
      company?.address_line1,
      company?.address_line2,
      company?.address_city,
      company?.address_province,
      company?.address_postal_code,
    ]
      .filter((part): part is string => Boolean(part))
      .join(', '),
    colour: safeColour(company?.brand_primary),
    logo,
    bank,
  });
  const number = document.number ?? 'draft';
  return {
    filename: `${number}.pdf`.replace(/[^\w.-]+/g, '-'),
    body,
  };
}

function draw(input: {
  document: View;
  companyName: string;
  vatNumber: string;
  address: string;
  colour: string;
  logo: Buffer | null;
  bank: {
    bank_name: string;
    account_name: string;
    account_number: string;
    branch_code: string;
  } | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 86).fill(input.colour);
    let x = 48;
    if (input.logo && (input.logo[0] === 0x89 || input.logo[0] === 0xff)) {
      try {
        doc.image(input.logo, 48, 22, { height: 42 });
        x = 100;
      } catch {
        x = 48;
      }
    }
    doc.fillColor('#ffffff').fontSize(16).text(input.companyName, x, 24, { width: 360 });
    doc.fontSize(9).text(input.address || 'South Africa', x, 46, { width: 360 });
    doc.text(input.vatNumber ? `VAT ${input.vatNumber}` : 'VAT number not on file', x, 62, {
      width: 360,
    });

    const heading = titleFor(input.document.kind);
    doc.fillColor('#1c1917').fontSize(22).text(heading, 48, 108);
    doc.fontSize(11).fillColor('#44403c');
    doc.text(input.document.number ?? 'Draft', 360, 112, { width: 180, align: 'right' });
    const dateLine = input.document.issuedOn
      ? `Date ${formatSaDate(input.document.issuedOn)}`
      : 'Not Issued';
    const extra =
      input.document.kind === 'invoice'
        ? `Due ${input.document.dueOn ? formatSaDate(input.document.dueOn) : ''}`
        : input.document.kind === 'quote'
          ? `Valid Until ${input.document.validUntil ? formatSaDate(input.document.validUntil) : 'Open'}`
          : input.document.invoiceNumber
            ? `Tax Invoice ${input.document.invoiceNumber}`
            : '';
    doc.text([dateLine, extra].filter(Boolean).join('   '), 360, 130, {
      width: 180,
      align: 'right',
    });

    doc.fillColor('#1c1917').fontSize(12).text(input.document.customerName, 48, 160);
    doc.fontSize(10).fillColor('#44403c');
    doc.text(input.document.customerAddress || 'No billing address', 48, 178, { width: 280 });
    doc.text(
      input.document.customerVat
        ? `Customer VAT ${input.document.customerVat}`
        : 'Customer is not registered for VAT',
      48,
      doc.y + 2,
      { width: 280 },
    );
    if (input.document.customerContact) {
      doc.text(input.document.customerContact, 48, doc.y + 2, { width: 280 });
    }

    let y = Math.max(doc.y + 18, 250);
    doc.rect(48, y, 500, 18).fill('#f5f5f4');
    doc.fillColor('#1c1917').fontSize(8);
    const showDiscount = input.document.lines.some((line) => line.discount !== '0.00');
    const headers = showDiscount
      ? ['Description', 'Qty', 'Price', 'Discount', 'VAT', 'Total']
      : ['Description', 'Qty', 'Price', 'VAT', 'Total'];
    const widths = showDiscount ? [190, 50, 65, 65, 60, 70] : [220, 55, 75, 70, 80];
    let cursor = 52;
    headers.forEach((header, index) => {
      doc.text(header, cursor, y + 5, { width: (widths[index] ?? 40) - 6, lineBreak: false });
      cursor += widths[index] ?? 40;
    });
    y += 22;
    doc.fillColor('#292524').fontSize(9);
    for (const line of input.document.lines) {
      if (y > 720) {
        doc.addPage();
        y = 48;
      }
      cursor = 52;
      const price = formatZar(money(BigInt(line.unitPrice.replace('.', ''))));
      const discount =
        line.discount === '0.00' ? '' : formatZar(money(BigInt(line.discount.replace('.', ''))));
      const cells = showDiscount
        ? [line.description, line.quantity, price, discount, line.vat.label, line.total.label]
        : [line.description, line.quantity, price, line.vat.label, line.total.label];
      cells.forEach((cell, index) => {
        doc.text(cell, cursor, y, { width: (widths[index] ?? 40) - 6 });
        cursor += widths[index] ?? 40;
      });
      y = doc.y + 6;
    }

    y = Math.max(y + 12, doc.y + 8);
    const totals = [
      ['Net', input.document.net.label],
      ['VAT', input.document.vat.label],
      ['Total', input.document.total.label],
    ];
    if (input.document.allocated && input.document.allocated.cents !== '0') {
      totals.push(['Amount Paid', input.document.allocated.label]);
    }
    if (input.document.balance) {
      totals.push(['Amount Due', input.document.balance.label]);
    }
    for (const [label, value] of totals) {
      doc.fontSize(label === 'Total' || label === 'Amount Due' ? 12 : 10);
      doc.fillColor('#1c1917').text(label ?? '', 330, y, { width: 90 });
      doc.text(value ?? '', 420, y, { width: 120, align: 'right' });
      y += label === 'Total' ? 20 : 16;
    }

    if (input.document.notes) {
      doc
        .fontSize(9)
        .fillColor('#44403c')
        .text(input.document.notes, 48, y + 8, { width: 260 });
    }
    if (input.bank && (input.bank.bank_name || input.bank.account_number)) {
      const bankY = y + 8;
      doc.fontSize(9).fillColor('#1c1917').text('Banking Details', 48, bankY);
      doc
        .fillColor('#44403c')
        .text(
          [
            input.bank.account_name,
            input.bank.bank_name,
            input.bank.account_number ? `Account ${input.bank.account_number}` : '',
            input.bank.branch_code ? `Branch ${input.bank.branch_code}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          48,
          bankY + 14,
          { width: 240 },
        );
    }
    doc.end();
  });
}
