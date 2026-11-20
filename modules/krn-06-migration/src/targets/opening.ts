import { sql } from 'drizzle-orm';
import { hasPermission, type TenantTransaction } from '@omnivate/kernel';
import {
  ensureChart,
  ledgerIsOn,
  partyIdForCode,
  postOpeningTrial,
  postSupplierOpening,
  reverseJournal,
  savePartyCode,
  trialAlreadyPosted,
} from '@omnivate/module-fin-01';
import { createParty } from '@omnivate/module-krn-02';
import { importOpeningInvoice, issueCreditNote } from '@omnivate/module-o2c';
import { centsToDecimal, parseEmail, parseSaDate, parseSaMoney } from '../sa-format';
import { textValue, type ApplyOptions, type ImportTarget, type RowValues } from '../target';
import { oneOf, rowsOf } from '../db';

type BooksActor = {
  userId: string;
  requestIp: string | null;
  userAgent: string | null;
};

async function booksActor(
  tx: TenantTransaction,
  actor: ApplyOptions['actor'],
): Promise<BooksActor> {
  let userId = actor.userId;
  if (!userId) {
    const row = await oneOf<{ id: string }>(
      tx,
      sql`SELECT ur.user_id AS id
          FROM user_roles AS ur
          INNER JOIN roles AS r ON r.id = ur.role_id
          INNER JOIN memberships AS m ON m.user_id = ur.user_id AND m.tenant_id = ur.tenant_id
          WHERE r.key = 'tenant_owner' AND m.status = 'active'
          LIMIT 1`,
    );
    if (!row) {
      throw new Error('This company needs an owner before opening balances can be imported.');
    }
    userId = row.id;
  }
  return { userId, requestIp: actor.requestIp, userAgent: actor.userAgent };
}

async function allowBooks(tx: TenantTransaction, userId: string): Promise<boolean> {
  if (!(await ledgerIsOn(tx))) {
    return false;
  }
  if (
    await hasPermission(tx, userId, { scope: 'fin.ledger', action: 'post', moduleId: 'FIN-01' })
  ) {
    return true;
  }
  return hasPermission(tx, userId, { scope: 'krn', action: 'admin', moduleId: 'KRN-06' });
}

function moneyOf(raw: string, label: string): { cents: bigint } | { error: string } {
  if (!raw.trim()) {
    return { cents: 0n };
  }
  const parsed = parseSaMoney(raw);
  if (!parsed.ok) {
    return { error: `${label} is not a valid amount. ${parsed.message}` };
  }
  if (parsed.value < 0n) {
    return { error: `${label} cannot be negative.` };
  }
  return { cents: parsed.value };
}

function dateOf(raw: string, label: string): { iso: string } | { error: string } {
  const parsed = parseSaDate(raw);
  if (!parsed.ok) {
    return { error: `${label}. ${parsed.message}` };
  }
  return { iso: parsed.value };
}

type CustomerIndex = {
  byCode: Map<string, { id: string; label: string }>;
  byInvoice: Map<string, { id: string; label: string }>;
};

function customerIndex(value: unknown): CustomerIndex {
  return value as CustomerIndex;
}

export function openingCustomersTarget(): ImportTarget {
  return {
    id: 'opening-customers',
    moduleId: 'KRN-06',
    label: 'Customer Opening Balances',
    summary: 'Customers and the invoices they still owe, with the original dates.',
    needsVatChoice: false,
    denial: 'Only an owner or an accountant can import opening balances.',
    fields: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        kind: 'text',
        hint: 'Your code for this customer. The same code on a later import is the same customer.',
        aliases: ['customer code', 'account code', 'account'],
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        kind: 'text',
        hint: 'The customer name.',
        aliases: ['customer', 'customer name', 'debtor'],
      },
      {
        key: 'vat',
        label: 'VAT Number',
        required: false,
        kind: 'vat',
        hint: '10 digits, starting with 4. Leave blank if they are not registered.',
        aliases: ['vat', 'vat no', 'tax number'],
      },
      {
        key: 'email',
        label: 'Email',
        required: false,
        kind: 'email',
        hint: 'Optional.',
        aliases: ['e-mail', 'email address'],
      },
      {
        key: 'phone',
        label: 'Phone',
        required: false,
        kind: 'phone',
        hint: 'Optional.',
        aliases: ['telephone', 'mobile', 'cell'],
      },
      {
        key: 'invoice_number',
        label: 'Invoice Number',
        required: false,
        kind: 'text',
        hint: 'The number from the old system. Blank uses OPEN and the customer code.',
        aliases: ['invoice', 'document', 'number', 'reference'],
      },
      {
        key: 'invoice_date',
        label: 'Invoice Date',
        required: false,
        kind: 'date',
        hint: 'The original invoice date, for example 28/02/2026.',
        aliases: ['date', 'issued', 'tax date'],
      },
      {
        key: 'due_date',
        label: 'Due Date',
        required: false,
        kind: 'date',
        hint: 'When it was due. Blank uses the invoice date.',
        aliases: ['due', 'payment due'],
      },
      {
        key: 'amount',
        label: 'Amount',
        required: false,
        kind: 'money',
        hint: 'What they still owe, including VAT. Blank adds the customer with nothing owing.',
        aliases: ['balance', 'opening balance', 'outstanding', 'debit'],
      },
    ],
    allowUser: allowBooks,
    validate(values) {
      return customerIssues(values);
    },
    contextIssues() {
      return [];
    },
    async loadIndex(tx) {
      const codes = await rowsOf<{ code: string; party_id: string; name: string }>(
        tx,
        sql`
          SELECT c.code, c.party_id, p.display_name AS name
          FROM fin01_party_codes AS c
          JOIN parties AS p ON p.id = c.party_id
          WHERE c.role = 'customer'
        `,
      );
      const invoices = await rowsOf<{ id: string; number: string; name: string }>(
        tx,
        sql`
          SELECT id, number, customer_name AS name
          FROM o2c_documents
          WHERE kind = 'invoice' AND number IS NOT NULL
        `,
      );
      const byCode = new Map<string, { id: string; label: string }>();
      for (const row of codes) {
        byCode.set(row.code.toLowerCase(), { id: row.party_id, label: row.name });
      }
      const byInvoice = new Map<string, { id: string; label: string }>();
      for (const row of invoices) {
        byInvoice.set(row.number.toLowerCase(), { id: row.id, label: row.name });
      }
      return { byCode, byInvoice };
    },
    matchExisting(index, values) {
      const number = invoiceNumber(values);
      if (number) {
        const hit = customerIndex(index).byInvoice.get(number.toLowerCase());
        if (hit) {
          return { ...hit, message: `Invoice ${number} is already on the books (${hit.label}).` };
        }
      }
      const amount = textValue(values, 'amount');
      if (!amount) {
        const code = textValue(values, 'code').toLowerCase();
        const hit = code ? customerIndex(index).byCode.get(code) : undefined;
        if (hit) {
          return {
            ...hit,
            message: `A customer with code ${textValue(values, 'code')} already exists (${hit.label}).`,
          };
        }
      }
      return null;
    },
    fileKeys(values) {
      const number = invoiceNumber(values);
      if (number) {
        return [
          {
            kind: 'invoice',
            key: number.toLowerCase(),
            message: (otherRow: number) => `This invoice number is also on row ${otherRow}.`,
          },
        ];
      }
      const code = textValue(values, 'code').toLowerCase();
      if (!code) return [];
      return [
        {
          kind: 'code',
          key: code,
          message: (otherRow: number) => `This customer code is also on row ${otherRow}.`,
        },
      ];
    },
    async findExisting(tx, values) {
      const number = invoiceNumber(values);
      if (!number) return null;
      const row = await oneOf<{ id: string; name: string }>(
        tx,
        sql`SELECT id, customer_name AS name FROM o2c_documents WHERE kind = 'invoice' AND lower(number) = lower(${number})`,
      );
      return row ? { id: row.id, label: row.name } : null;
    },
    async createMany(tx, _batchId, rows, options) {
      const actor = await booksActor(tx, options.actor);
      const applied = [];
      for (const row of rows) {
        const parsed = readCustomer(row.values);
        if ('error' in parsed) throw new Error(parsed.error);
        let partyId = await partyIdForCode(tx, 'customer', parsed.code);
        let createdParty = false;
        if (!partyId) {
          const party = await createParty(tx, actor, partyInput(parsed, 'customer'));
          partyId = party.id;
          createdParty = true;
          await savePartyCode(tx, { partyId, role: 'customer', code: parsed.code });
        }
        let recordId = partyId;
        if (parsed.amount > 0n && parsed.invoiceNumber && parsed.invoiceDate) {
          recordId = await importOpeningInvoice(tx, actor, {
            partyId,
            number: parsed.invoiceNumber,
            issuedOn: parsed.invoiceDate,
            dueOn: parsed.dueDate ?? parsed.invoiceDate,
            amountCents: parsed.amount,
          });
        }
        applied.push({
          recordId,
          generationAfter: 1,
          movementCountAfter: 0,
          beforeData: { invoiceId: recordId === partyId ? null : recordId, createdParty, partyId },
          deltaQuantityMilli: 0n,
          deltaValueCents: parsed.amount,
        });
      }
      return applied;
    },
    async updateOne(tx, _batchId, recordId, values) {
      const parsed = readCustomer(values);
      if ('error' in parsed) throw new Error(parsed.error);
      return {
        recordId,
        generationAfter: 1,
        movementCountAfter: 0,
        beforeData: null,
        deltaQuantityMilli: 0n,
        deltaValueCents: 0n,
      };
    },
    async touchedRowNumbers() {
      return [];
    },
    async undo(tx, _batchId, rows, actor) {
      const user = await booksActor(tx, actor);
      for (const row of rows) {
        const saved = row.beforeData ?? {};
        const invoiceId = typeof saved.invoiceId === 'string' ? saved.invoiceId : null;
        if (!invoiceId) continue;
        const lines = await rowsOf<{ id: string; quantity: string }>(
          tx,
          sql`
            SELECT id, quantity::text AS quantity
            FROM o2c_lines
            WHERE document_id = ${invoiceId} AND archived_at IS NULL
          `,
        );
        if (lines.length === 0) continue;
        await issueCreditNote(
          tx,
          user,
          invoiceId,
          lines.map((line) => ({ lineId: line.id, quantity: line.quantity })),
        );
      }
    },
    async exportTable() {
      return [
        [
          'Code',
          'Name',
          'VAT Number',
          'Email',
          'Phone',
          'Invoice Number',
          'Invoice Date',
          'Due Date',
          'Amount',
        ],
      ];
    },
  };
}

function invoiceNumber(values: RowValues): string {
  const explicit = textValue(values, 'invoice_number');
  if (explicit) return explicit;
  const amount = textValue(values, 'amount');
  const code = textValue(values, 'code');
  if (amount && code) return `OPEN-${code}`;
  return '';
}

function customerIssues(values: RowValues): string[] {
  const errors: string[] = [];
  const code = textValue(values, 'code');
  const name = textValue(values, 'name');
  if (!code) errors.push('Code is required.');
  else if (code.length > 40) errors.push('Code is too long.');
  if (!name) errors.push('Name is required.');
  else if (name.length < 2) errors.push('Name should be at least 2 characters.');
  else if (name.length > 160) errors.push('Name is too long.');
  const vat = textValue(values, 'vat').replace(/\s/g, '');
  if (vat && !/^4\d{9}$/.test(vat)) {
    errors.push('A South African VAT number is 10 digits and starts with 4.');
  }
  const email = textValue(values, 'email');
  if (email && !parseEmail(email).ok) errors.push('Email does not look valid.');
  const phone = textValue(values, 'phone');
  if (phone.length > 40) errors.push('Phone is too long.');
  const amount = moneyOf(textValue(values, 'amount'), 'Amount');
  if ('error' in amount) errors.push(amount.error);
  const cents = 'cents' in amount ? amount.cents : 0n;
  if (cents > 0n) {
    const issued = textValue(values, 'invoice_date');
    if (!issued) errors.push('Enter the invoice date for an amount owing.');
    else {
      const parsed = dateOf(issued, 'Invoice date');
      if ('error' in parsed) errors.push(parsed.error);
    }
    const due = textValue(values, 'due_date');
    if (due) {
      const parsed = dateOf(due, 'Due date');
      if ('error' in parsed) errors.push(parsed.error);
    }
  }
  return errors;
}

function readCustomer(values: RowValues):
  | { error: string }
  | {
      code: string;
      name: string;
      vat: string;
      email: string;
      phone: string;
      amount: bigint;
      invoiceNumber: string;
      invoiceDate: string | null;
      dueDate: string | null;
    } {
  const errors = customerIssues(values);
  if (errors.length > 0) return { error: errors[0] ?? 'This row is not valid.' };
  const amount = moneyOf(textValue(values, 'amount'), 'Amount');
  const issuedRaw = textValue(values, 'invoice_date');
  const dueRaw = textValue(values, 'due_date');
  const issued = issuedRaw ? dateOf(issuedRaw, 'Invoice date') : null;
  const due = dueRaw ? dateOf(dueRaw, 'Due date') : null;
  return {
    code: textValue(values, 'code'),
    name: textValue(values, 'name'),
    vat: textValue(values, 'vat').replace(/\s/g, ''),
    email: textValue(values, 'email'),
    phone: textValue(values, 'phone'),
    amount: 'cents' in amount ? amount.cents : 0n,
    invoiceNumber: invoiceNumber(values),
    invoiceDate: issued && 'iso' in issued ? issued.iso : null,
    dueDate: due && 'iso' in due ? due.iso : null,
  };
}

function partyInput(
  parsed: { name: string; vat: string; email: string; phone: string },
  role: 'customer' | 'supplier',
) {
  const channels = [
    ...(parsed.email
      ? [
          {
            kind: 'email' as const,
            value: parsed.email.toLowerCase(),
            label: null,
            isPrimary: true,
          },
        ]
      : []),
    ...(parsed.phone
      ? [{ kind: 'phone' as const, value: parsed.phone, label: null, isPrimary: true }]
      : []),
  ];
  return {
    booksImport: true,
    kind: 'organisation',
    displayName: parsed.name,
    roles: [role],
    vatNumber: parsed.vat,
    popiaConsent: false,
    confirmDuplicate: true,
    channels,
    addresses: [],
    contacts: [],
    tags: [],
  };
}

type SupplierIndex = { byCode: Map<string, { id: string; label: string }> };

export function openingSuppliersTarget(): ImportTarget {
  return {
    id: 'opening-suppliers',
    moduleId: 'KRN-06',
    label: 'Supplier Opening Balances',
    summary: 'Suppliers and what you still owe them.',
    needsVatChoice: false,
    denial: 'Only an owner or an accountant can import opening balances.',
    fields: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        kind: 'text',
        hint: 'Your code for this supplier.',
        aliases: ['supplier code', 'account code', 'account'],
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        kind: 'text',
        hint: 'The supplier name.',
        aliases: ['supplier', 'supplier name', 'creditor'],
      },
      {
        key: 'vat',
        label: 'VAT Number',
        required: false,
        kind: 'vat',
        hint: '10 digits, starting with 4. Leave blank if they are not registered.',
        aliases: ['vat', 'vat no'],
      },
      {
        key: 'amount',
        label: 'Amount',
        required: true,
        kind: 'money',
        hint: 'What you still owe them.',
        aliases: ['balance', 'opening balance', 'outstanding', 'credit'],
      },
      {
        key: 'as_at',
        label: 'As At',
        required: true,
        kind: 'date',
        hint: 'The date of this opening balance, for example 28/02/2026.',
        aliases: ['date', 'as at date', 'balance date'],
      },
    ],
    allowUser: allowBooks,
    validate(values) {
      return supplierIssues(values);
    },
    contextIssues() {
      return [];
    },
    async loadIndex(tx) {
      const codes = await rowsOf<{ code: string; party_id: string; name: string }>(
        tx,
        sql`
          SELECT c.code, c.party_id, p.display_name AS name
          FROM fin01_party_codes AS c
          JOIN parties AS p ON p.id = c.party_id
          WHERE c.role = 'supplier'
        `,
      );
      const byCode = new Map<string, { id: string; label: string }>();
      for (const row of codes)
        byCode.set(row.code.toLowerCase(), { id: row.party_id, label: row.name });
      return { byCode };
    },
    matchExisting(index, values) {
      const code = textValue(values, 'code').toLowerCase();
      const hit = code ? (index as SupplierIndex).byCode.get(code) : undefined;
      if (!hit) return null;
      return { ...hit, message: `A supplier with this code already exists (${hit.label}).` };
    },
    fileKeys(values) {
      const code = textValue(values, 'code').toLowerCase();
      if (!code) return [];
      return [
        {
          kind: 'code',
          key: code,
          message: (otherRow: number) => `This supplier code is also on row ${otherRow}.`,
        },
      ];
    },
    async findExisting(tx, values) {
      const id = await partyIdForCode(tx, 'supplier', textValue(values, 'code'));
      return id ? { id, label: textValue(values, 'name') } : null;
    },
    async createMany(tx, _batchId, rows, options) {
      const actor = await booksActor(tx, options.actor);
      const applied = [];
      for (const row of rows) {
        const parsed = readSupplier(row.values);
        if ('error' in parsed) throw new Error(parsed.error);
        let partyId = await partyIdForCode(tx, 'supplier', parsed.code);
        if (!partyId) {
          const party = await createParty(tx, actor, partyInput(parsed, 'supplier'));
          partyId = party.id;
          await savePartyCode(tx, { partyId, role: 'supplier', code: parsed.code });
        }
        await postSupplierOpening(tx, actor, {
          partyId,
          name: parsed.name,
          amountCents: parsed.amount,
          asAt: parsed.asAt,
        });
        applied.push({
          recordId: partyId,
          generationAfter: 1,
          movementCountAfter: 0,
          beforeData: {
            partyId,
            amount: parsed.amount.toString(),
            asAt: parsed.asAt,
            name: parsed.name,
          },
          deltaQuantityMilli: 0n,
          deltaValueCents: parsed.amount,
        });
      }
      return applied;
    },
    async updateOne(tx, _batchId, recordId, values, options) {
      const parsed = readSupplier(values);
      if ('error' in parsed) throw new Error(parsed.error);
      const actor = await booksActor(tx, options.actor);
      await postSupplierOpening(tx, actor, {
        partyId: recordId,
        name: parsed.name,
        amountCents: parsed.amount,
        asAt: parsed.asAt,
      });
      return {
        recordId,
        generationAfter: 2,
        movementCountAfter: 0,
        beforeData: null,
        deltaQuantityMilli: 0n,
        deltaValueCents: parsed.amount,
      };
    },
    async touchedRowNumbers() {
      return [];
    },
    async undo(tx, _batchId, rows, actor) {
      const user = await booksActor(tx, actor);
      for (const row of rows) {
        const saved = row.beforeData ?? {};
        if (
          typeof saved.partyId !== 'string' ||
          typeof saved.name !== 'string' ||
          typeof saved.asAt !== 'string'
        ) {
          continue;
        }
        await postSupplierOpening(tx, user, {
          partyId: saved.partyId,
          name: saved.name,
          amountCents: 0n,
          asAt: saved.asAt,
        });
      }
    },
    async exportTable() {
      return [['Code', 'Name', 'VAT Number', 'Amount', 'As At']];
    },
  };
}

function supplierIssues(values: RowValues): string[] {
  const errors: string[] = [];
  const code = textValue(values, 'code');
  const name = textValue(values, 'name');
  if (!code) errors.push('Code is required.');
  else if (code.length > 40) errors.push('Code is too long.');
  if (!name) errors.push('Name is required.');
  else if (name.length < 2) errors.push('Name should be at least 2 characters.');
  const vat = textValue(values, 'vat').replace(/\s/g, '');
  if (vat && !/^4\d{9}$/.test(vat)) {
    errors.push('A South African VAT number is 10 digits and starts with 4.');
  }
  const amount = moneyOf(textValue(values, 'amount'), 'Amount');
  if ('error' in amount) errors.push(amount.error);
  else if (amount.cents <= 0n) errors.push('Enter the amount you owe.');
  const asAt = textValue(values, 'as_at');
  if (!asAt) errors.push('Enter the as-at date.');
  else {
    const parsed = dateOf(asAt, 'As-at date');
    if ('error' in parsed) errors.push(parsed.error);
  }
  return errors;
}

function readSupplier(values: RowValues):
  | { error: string }
  | {
      code: string;
      name: string;
      vat: string;
      email: string;
      phone: string;
      amount: bigint;
      asAt: string;
    } {
  const errors = supplierIssues(values);
  if (errors[0]) return { error: errors[0] };
  const amount = moneyOf(textValue(values, 'amount'), 'Amount');
  const asAt = dateOf(textValue(values, 'as_at'), 'As-at date');
  if (!('cents' in amount) || !('iso' in asAt)) return { error: 'This row is not valid.' };
  return {
    code: textValue(values, 'code'),
    name: textValue(values, 'name'),
    vat: textValue(values, 'vat').replace(/\s/g, ''),
    email: '',
    phone: '',
    amount: amount.cents,
    asAt: asAt.iso,
  };
}

type TrialIndex = { postedOn: Map<string, string> };

export function openingTrialTarget(): ImportTarget {
  return {
    id: 'opening-trial-balance',
    moduleId: 'FIN-01',
    label: 'Opening Trial Balance',
    summary: 'Account code, debit, and credit. The file has to balance.',
    needsVatChoice: false,
    denial: 'Only an owner or an accountant can import a trial balance.',
    fields: [
      {
        key: 'code',
        label: 'Account Code',
        required: true,
        kind: 'text',
        hint: 'The code from the chart of accounts, for example 1000.',
        aliases: ['account', 'code', 'gl code'],
      },
      {
        key: 'debit',
        label: 'Debit',
        required: false,
        kind: 'money',
        hint: 'Leave blank when this line is a credit.',
        aliases: ['dr', 'debit amount'],
      },
      {
        key: 'credit',
        label: 'Credit',
        required: false,
        kind: 'money',
        hint: 'Leave blank when this line is a debit.',
        aliases: ['cr', 'credit amount'],
      },
      {
        key: 'as_at',
        label: 'As At',
        required: true,
        kind: 'date',
        hint: 'The same date on every row. For example 28/02/2026.',
        aliases: ['date', 'as at date', 'balance date'],
      },
    ],
    allowUser: allowBooks,
    validate(values) {
      return trialIssues(values);
    },
    reviewBatch(rows) {
      const usable = rows.filter((row) => !row.invalid);
      if (usable.length === 0) return [];
      let debit = 0n;
      let credit = 0n;
      const dates = new Set<string>();
      for (const row of usable) {
        const parsed = readTrialLine(row.values);
        if ('error' in parsed) continue;
        debit += parsed.debit;
        credit += parsed.credit;
        dates.add(parsed.asAt);
      }
      const messages: { rowNumber: number; message: string }[] = [];
      if (dates.size > 1) {
        for (const row of usable) {
          messages.push({
            rowNumber: row.rowNumber,
            message: 'Use one as-at date for the whole file.',
          });
        }
      }
      if (debit !== credit) {
        const text = `This trial balance does not balance. Debits are ${centsToDecimal(debit)} and credits are ${centsToDecimal(credit)}.`;
        for (const row of usable) messages.push({ rowNumber: row.rowNumber, message: text });
      }
      return messages;
    },
    contextIssues(index, values) {
      const code = textValue(values, 'code');
      if (!code) return [];
      const accounts = index as { codes: Set<string> };
      if (!accounts.codes?.has(code)) {
        return [`Account ${code} is not on the chart.`];
      }
      return [];
    },
    async loadIndex(tx) {
      await ensureChart(tx);
      const accounts = await rowsOf<{ code: string }>(
        tx,
        sql`SELECT code FROM fin01_accounts WHERE active = true`,
      );
      const posted = new Map<string, string>();
      const journals = await rowsOf<{ id: string; source_key: string }>(
        tx,
        sql`SELECT id, source_key FROM fin01_journals WHERE source_key LIKE 'trial:%'`,
      );
      for (const journal of journals) {
        posted.set(journal.source_key.slice('trial:'.length), journal.id);
      }
      return { codes: new Set(accounts.map((row) => row.code)), postedOn: posted };
    },
    matchExisting(index, values) {
      const asAt = textValue(values, 'as_at');
      const parsed = asAt ? parseSaDate(asAt) : null;
      if (!parsed || !parsed.ok) return null;
      const hit = (index as TrialIndex).postedOn.get(parsed.value);
      if (!hit) return null;
      return {
        id: hit,
        label: parsed.value,
        message: `An opening trial balance is already posted for ${parsed.value}.`,
      };
    },
    fileKeys(values) {
      const code = textValue(values, 'code');
      if (!code) return [];
      return [
        {
          kind: 'code',
          key: code,
          message: (otherRow: number) => `Account ${code} is also on row ${otherRow}.`,
        },
      ];
    },
    async findExisting(tx, values) {
      const parsed = parseSaDate(textValue(values, 'as_at'));
      if (!parsed.ok) return null;
      const id = await trialAlreadyPosted(tx, parsed.value);
      return id ? { id, label: parsed.value } : null;
    },
    async createMany(tx, _batchId, rows, options) {
      const actor = await booksActor(tx, options.actor);
      const lines = rows.map((row) => {
        const parsed = readTrialLine(row.values);
        if ('error' in parsed) throw new Error(parsed.error);
        return parsed;
      });
      const dates = new Set(lines.map((line) => line.asAt));
      if (dates.size !== 1) throw new Error('Use one as-at date for the whole file.');
      const asAt = lines[0]?.asAt ?? '';
      let debit = 0n;
      let credit = 0n;
      for (const line of lines) {
        debit += line.debit;
        credit += line.credit;
      }
      if (debit !== credit) {
        throw new Error(
          `This trial balance does not balance. Debits are ${centsToDecimal(debit)} and credits are ${centsToDecimal(credit)}.`,
        );
      }
      const journalId = await postOpeningTrial(tx, actor, {
        asAt,
        lines: lines.map((line) => ({
          code: line.code,
          debitCents: line.debit,
          creditCents: line.credit,
        })),
      });
      const recordId = journalId ?? (await trialAlreadyPosted(tx, asAt)) ?? rows[0]?.id ?? asAt;
      return rows.map(() => ({
        recordId,
        generationAfter: 1,
        movementCountAfter: 0,
        beforeData: { journalId: recordId },
        deltaQuantityMilli: 0n,
        deltaValueCents: 0n,
      }));
    },
    async updateOne(_tx, _batchId, _recordId) {
      throw new Error(
        'That opening trial balance is already posted. Reverse the journal before importing it again.',
      );
    },
    async touchedRowNumbers() {
      return [];
    },
    async undo(tx, _batchId, rows, actor) {
      const user = await booksActor(tx, actor);
      const journalId = rows
        .map((row) => row.beforeData?.journalId)
        .find((id) => typeof id === 'string');
      if (typeof journalId !== 'string') return;
      await reverseJournal(tx, user, journalId);
    },
    async exportTable() {
      return [['Account Code', 'Debit', 'Credit', 'As At']];
    },
  };
}

function trialIssues(values: RowValues): string[] {
  const errors: string[] = [];
  const code = textValue(values, 'code');
  if (!/^[0-9]{3,8}$/.test(code)) errors.push('Account code is 3 to 8 digits.');
  const debit = moneyOf(textValue(values, 'debit'), 'Debit');
  const credit = moneyOf(textValue(values, 'credit'), 'Credit');
  if ('error' in debit) errors.push(debit.error);
  if ('error' in credit) errors.push(credit.error);
  if ('cents' in debit && 'cents' in credit) {
    if (debit.cents > 0n && credit.cents > 0n) errors.push('Enter a debit or a credit, not both.');
    if (debit.cents === 0n && credit.cents === 0n) errors.push('Enter a debit or a credit.');
  }
  const asAt = textValue(values, 'as_at');
  if (!asAt) errors.push('Enter the as-at date.');
  else {
    const parsed = dateOf(asAt, 'As-at date');
    if ('error' in parsed) errors.push(parsed.error);
  }
  return errors;
}

function readTrialLine(
  values: RowValues,
): { error: string } | { code: string; debit: bigint; credit: bigint; asAt: string } {
  const errors = trialIssues(values);
  if (errors[0]) return { error: errors[0] };
  const debit = moneyOf(textValue(values, 'debit'), 'Debit');
  const credit = moneyOf(textValue(values, 'credit'), 'Credit');
  const asAt = dateOf(textValue(values, 'as_at'), 'As-at date');
  if (!('cents' in debit) || !('cents' in credit) || !('iso' in asAt)) {
    return { error: 'This row is not valid.' };
  }
  return {
    code: textValue(values, 'code'),
    debit: debit.cents,
    credit: credit.cents,
    asAt: asAt.iso,
  };
}
