import { sql } from 'drizzle-orm';
import { hasPermission, type TenantTransaction } from '@omnivate/kernel';
import { barcodeTextError } from '@omnivate/shared';
import { listImportBranches, type ImportBranch } from '@omnivate/module-krn-03';
import {
  importOpeningStock,
  itemImportStamps,
  listItemsForImport,
  reverseMovement,
  setItemStatus,
  type StockImportRow,
} from '@omnivate/module-scm-01';
import { asNumber, asRecord, oneOf, rowsOf } from '../db';
import type { ItemDraft } from '../ports';
import {
  centsToDecimal,
  exclusiveFromInclusive,
  extendedCostCents,
  milliToDecimal,
  parseSaMoney,
  parseSaQuantity,
} from '../sa-format';
import { textValue, type ApplyOptions, type ImportTarget, type RowValues } from '../target';

type StockIndex = {
  bySku: Map<string, { id: string; label: string; barcode: string }>;
  byBarcode: Map<string, { id: string; sku: string; label: string }>;
  branches: ImportBranch[];
};

function resolveBranch(branches: ImportBranch[], raw: string): { id: string } | { error: string } {
  const name = raw.trim();
  if (!name) {
    const head = branches.find((branch) => branch.isHeadOffice);
    if (!head) {
      return { error: 'This company has no Head Office branch.' };
    }
    return { id: head.id };
  }
  const key = name.toLowerCase();
  const hit = branches.find(
    (branch) => branch.name.toLowerCase() === key || branch.code.toLowerCase() === key,
  );
  if (!hit) {
    return {
      error: `Branch “${name}” was not found. Leave it blank to use Head Office.`,
    };
  }
  return { id: hit.id };
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function draftFrom(
  values: RowValues,
  options: ApplyOptions,
): { draft: ItemDraft | null; errors: string[] } {
  const errors: string[] = [];
  const sku = textValue(values, 'sku');
  if (!sku) {
    errors.push('SKU is required.');
  } else if (sku.length > 40) {
    errors.push('SKU is too long.');
  }

  const name = textValue(values, 'name');
  if (!name) {
    errors.push('Name is required.');
  } else if (name.length > 200) {
    errors.push('Name is too long.');
  }

  const unit = optional(textValue(values, 'unit')) ?? 'each';
  if (unit.length > 20) {
    errors.push('Unit is too long.');
  }

  const description = optional(textValue(values, 'description'));
  if (description && description.length > 500) {
    errors.push('Description is too long.');
  }

  const quantityRaw = textValue(values, 'quantity');
  let quantityMilli = 0n;
  if (quantityRaw) {
    const parsed = parseSaQuantity(quantityRaw);
    if (!parsed.ok) {
      errors.push(parsed.message);
    } else {
      quantityMilli = parsed.value;
    }
  }

  const costRaw = textValue(values, 'unit_cost');
  let costCents = 0n;
  if (costRaw) {
    const parsed = parseSaMoney(costRaw);
    if (!parsed.ok) {
      errors.push(`Unit cost is not a valid amount. ${parsed.message}`);
    } else if (parsed.value < 0n) {
      errors.push('Unit cost cannot be negative.');
    } else {
      costCents =
        options.vatTreatment === 'inclusive'
          ? exclusiveFromInclusive(parsed.value, options.vatRateBasisPoints)
          : parsed.value;
    }
  } else if (quantityMilli > 0n) {
    errors.push('Unit cost is required when there is opening stock.');
  }

  const barcodeRaw = textValue(values, 'barcode');
  let barcode: string | null = null;
  if (barcodeRaw) {
    const problem = barcodeTextError(barcodeRaw);
    if (problem) {
      errors.push(problem);
    } else {
      barcode = barcodeRaw;
    }
  }

  const sellingRaw = textValue(values, 'selling_price');
  let sellingPriceCents: bigint | null = null;
  if (sellingRaw) {
    const parsed = parseSaMoney(sellingRaw);
    if (!parsed.ok) {
      errors.push(`Selling price is not a valid amount. ${parsed.message}`);
    } else if (parsed.value < 0n) {
      errors.push('Selling price cannot be negative.');
    } else {
      sellingPriceCents =
        options.vatTreatment === 'inclusive'
          ? exclusiveFromInclusive(parsed.value, options.vatRateBasisPoints)
          : parsed.value;
    }
  }

  if (errors.length > 0 || !sku || !name) {
    return { draft: null, errors };
  }

  return {
    draft: {
      sku,
      name,
      unit,
      description,
      costCents,
      quantityMilli,
      branchId: null,
      barcode,
      sellingPriceCents,
    },
    errors,
  };
}

function requireDraft(values: RowValues, options: ApplyOptions): ItemDraft {
  const parsed = draftFrom(values, options);
  if (!parsed.draft) {
    throw new Error(parsed.errors[0] ?? 'This row is not valid.');
  }
  return parsed.draft;
}

function asIndex(index: unknown): StockIndex {
  return index as StockIndex;
}

export function createStockTarget(): ImportTarget {
  const defaultOptions: ApplyOptions = {
    vatTreatment: 'exclusive',
    vatRateBasisPoints: 1500,
    actor: { userId: null, operatorId: null, requestIp: null, userAgent: null },
  };

  return {
    id: 'stock-items',
    moduleId: 'SCM-01',
    label: 'Stock Items',
    summary: 'Products, barcodes, prices, and an opening quantity at each branch.',
    needsVatChoice: true,
    denial: 'Only an owner or a manager can import stock.',
    fields: [
      {
        key: 'sku',
        label: 'SKU',
        required: true,
        kind: 'text',
        hint: 'The code you already use for this item.',
        aliases: ['item code', 'code', 'stock code', 'product code'],
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        kind: 'text',
        hint: 'What the item is called.',
        aliases: ['item name', 'product', 'product name', 'stock item'],
      },
      {
        key: 'unit',
        label: 'Unit',
        required: false,
        kind: 'text',
        hint: 'each, kg, litre, ream, and so on. Blank means each.',
        aliases: ['uom', 'unit of measure'],
      },
      {
        key: 'description',
        label: 'Description',
        required: false,
        kind: 'text',
        hint: 'Optional extra detail.',
        aliases: ['details', 'long description'],
      },
      {
        key: 'quantity',
        label: 'Opening Quantity',
        required: false,
        kind: 'quantity',
        hint: 'How many you have on hand today. Blank means zero.',
        aliases: ['qty', 'quantity', 'on hand', 'opening qty', 'opening stock', 'soh'],
      },
      {
        key: 'branch',
        label: 'Branch',
        required: false,
        kind: 'text',
        hint: 'Branch name or code. Blank means Head Office.',
        aliases: ['branch name', 'branch code', 'location', 'warehouse'],
      },
      {
        key: 'unit_cost',
        label: 'Unit Cost',
        required: false,
        kind: 'money',
        hint: 'Cost per unit. You choose whether this includes VAT.',
        aliases: ['cost', 'cost price', 'unit price', 'price', 'opening cost'],
      },
      {
        key: 'barcode',
        label: 'Barcode',
        required: false,
        kind: 'text',
        hint: 'The code on the label. Blank keeps the barcode the item already has.',
        aliases: ['bar code', 'ean', 'gtin', 'scan code'],
      },
      {
        key: 'selling_price',
        label: 'Selling Price',
        required: false,
        kind: 'money',
        hint: 'The price you charge, before VAT is added on the invoice. The VAT choice applies here too.',
        aliases: ['sell price', 'selling', 'retail price', 'list price'],
      },
    ],

    async allowUser(tx, userId) {
      if (await hasPermission(tx, userId, { scope: 'krn', action: 'admin', moduleId: 'KRN-06' })) {
        return true;
      }
      const manager = await oneOf<{ ok: number }>(
        tx,
        sql`SELECT 1 AS ok
            FROM user_roles AS ur
            JOIN roles AS r ON r.id = ur.role_id
            WHERE ur.user_id = ${userId}::uuid
              AND r.key = 'branch_manager'
            LIMIT 1`,
      );
      return manager !== null;
    },

    validate(values) {
      return draftFrom(values, defaultOptions).errors;
    },

    contextIssues(index, values) {
      const branches = asIndex(index).branches ?? [];
      const issues: string[] = [];
      const resolved = resolveBranch(branches, textValue(values, 'branch'));
      if ('error' in resolved) {
        issues.push(resolved.error);
      }
      const barcode = textValue(values, 'barcode').toLowerCase();
      const sku = textValue(values, 'sku').toLowerCase();
      const hit = barcode ? asIndex(index).byBarcode.get(barcode) : undefined;
      if (hit && hit.sku.toLowerCase() !== sku) {
        issues.push(`This barcode is already used by ${hit.label}.`);
      }
      return issues;
    },

    async loadIndex(tx) {
      const items = await listItemsForImport(tx);
      const bySku = new Map<string, { id: string; label: string; barcode: string }>();
      const byBarcode = new Map<string, { id: string; sku: string; label: string }>();
      for (const item of items) {
        if (item.status !== 'active') {
          continue;
        }
        bySku.set(item.sku.toLowerCase(), {
          id: item.id,
          label: item.name,
          barcode: item.barcode ?? '',
        });
        if (item.barcode) {
          byBarcode.set(item.barcode.toLowerCase(), {
            id: item.id,
            sku: item.sku,
            label: item.name,
          });
        }
      }
      return { bySku, byBarcode, branches: await listImportBranches(tx) };
    },

    matchExisting(index, values) {
      const sku = textValue(values, 'sku');
      if (!sku) {
        return null;
      }
      const hit = asIndex(index).bySku.get(sku.toLowerCase());
      if (!hit) {
        return null;
      }
      return { ...hit, message: `A stock item with this SKU already exists (${hit.label}).` };
    },

    fileKeys(values) {
      const sku = textValue(values, 'sku');
      if (!sku) {
        return [];
      }
      const keys = [
        {
          kind: 'sku',
          key: sku.toLowerCase(),
          message: (otherRow: number) => `This SKU is also on row ${otherRow}.`,
        },
      ];
      const barcode = textValue(values, 'barcode');
      if (barcode) {
        keys.push({
          kind: 'barcode',
          key: barcode.toLowerCase(),
          message: (otherRow: number) => `This barcode is also on row ${otherRow}.`,
        });
      }
      return keys;
    },

    async findExisting(tx, values) {
      const sku = textValue(values, 'sku').toLowerCase();
      if (!sku) {
        return null;
      }
      const item = (await listItemsForImport(tx)).find(
        (row) => row.status === 'active' && row.sku.toLowerCase() === sku,
      );
      return item ? { id: item.id, label: item.name } : null;
    },

    async createMany(tx, _batchId, rows, options) {
      const branches = await listImportBranches(tx);
      const actor = await stockActor(tx, options.actor);
      const applied = [];
      for (const row of rows) {
        const draft = requireDraft(row.values, options);
        const branch = resolveBranch(branches, textValue(row.values, 'branch'));
        if ('error' in branch) {
          throw new Error(branch.error);
        }
        const written = await importOpeningStock(tx, actor, {
          itemId: null,
          sku: draft.sku,
          name: draft.name,
          unit: draft.unit,
          description: draft.description ?? '',
          unitCost: centsToDecimal(draft.costCents),
          quantity: milliToDecimal(draft.quantityMilli),
          branchId: branch.id,
          barcode: draft.barcode ?? null,
          sellingPrice:
            draft.sellingPriceCents == null ? null : centsToDecimal(draft.sellingPriceCents),
        });
        applied.push({
          recordId: written.itemId,
          generationAfter: 1,
          movementCountAfter: written.movementId ? 1 : 0,
          beforeData: {
            updatedAt: written.updatedAt,
            movementId: written.movementId,
            movementCount: written.movementId ? 1 : 0,
            restore: null,
          },
          deltaQuantityMilli: draft.quantityMilli,
          deltaValueCents: extendedCostCents(draft.quantityMilli, draft.costCents),
        });
      }
      return applied;
    },

    async updateOne(tx, _batchId, recordId, values, options) {
      const current = (await listItemsForImport(tx)).find((row) => row.id === recordId);
      if (!current || current.status !== 'active') {
        throw new Error('That stock item was not found.');
      }
      const draft = requireDraft(values, options);
      const branch = resolveBranch(await listImportBranches(tx), textValue(values, 'branch'));
      if ('error' in branch) {
        throw new Error(branch.error);
      }
      const currentMilli = onHandMilli(current.onHand);
      const delta = draft.quantityMilli - currentMilli;
      const actor = await stockActor(tx, options.actor);
      const written = await importOpeningStock(tx, actor, {
        itemId: recordId,
        sku: draft.sku,
        name: draft.name,
        unit: draft.unit,
        description: draft.description ?? '',
        unitCost: centsToDecimal(draft.costCents),
        quantity: milliToDecimal(delta),
        branchId: branch.id,
        barcode: draft.barcode ?? null,
        sellingPrice:
          draft.sellingPriceCents == null ? null : centsToDecimal(draft.sellingPriceCents),
      });
      return {
        recordId,
        generationAfter: 2,
        movementCountAfter: current.movementCount + (written.movementId ? 1 : 0),
        beforeData: {
          updatedAt: written.updatedAt,
          movementId: written.movementId,
          movementCount: current.movementCount + (written.movementId ? 1 : 0),
          restore: {
            sku: current.sku,
            name: current.name,
            unit: current.unit,
            description: current.description,
            unitCost: centsToDecimal(current.costCents),
          },
        },
        deltaQuantityMilli: delta,
        deltaValueCents: 0n,
      };
    },

    async touchedRowNumbers(tx, batchId) {
      const stored = await rowsOf<{
        rowNumber: number;
        recordId: string | null;
        beforeData: unknown;
      }>(
        tx,
        sql`SELECT row_number AS "rowNumber", record_id AS "recordId", before_data AS "beforeData"
            FROM krn06_import_rows
            WHERE batch_id = ${batchId}::uuid AND status IN ('created', 'updated')
            ORDER BY row_number`,
      );
      const ids = stored.map((row) => row.recordId).filter((id): id is string => Boolean(id));
      const stamps = new Map(
        (await itemImportStamps(tx, ids)).map((row) => [row.id, row] as const),
      );
      const touched: number[] = [];
      for (const row of stored) {
        const saved = asRecord(row.beforeData);
        const stamp = row.recordId ? stamps.get(row.recordId) : undefined;
        const same =
          stamp &&
          stamp.status === 'active' &&
          stamp.updatedAt === saved.updatedAt &&
          stamp.movementCount === asNumber(saved.movementCount);
        if (!same) {
          touched.push(asNumber(row.rowNumber));
        }
        if (touched.length >= 8) {
          break;
        }
      }
      return touched;
    },

    async undo(tx, _batchId, rows, actor) {
      const user = await stockActor(tx, actor);
      const updates = rows
        .filter((row) => row.status === 'updated')
        .sort((left, right) => right.rowNumber - left.rowNumber);
      for (const row of updates) {
        const saved = asRecord(row.beforeData);
        const movementId = typeof saved.movementId === 'string' ? saved.movementId : null;
        if (movementId) {
          await reverseMovement(tx, user, movementId, 'Undo import');
        }
        const restore = asRecord(saved.restore);
        if (typeof restore.sku === 'string' && typeof restore.name === 'string') {
          await importOpeningStock(tx, user, {
            itemId: row.recordId,
            sku: restore.sku,
            name: restore.name,
            unit: typeof restore.unit === 'string' ? restore.unit : 'each',
            description: typeof restore.description === 'string' ? restore.description : '',
            unitCost: typeof restore.unitCost === 'string' ? restore.unitCost : '0.00',
            quantity: '0',
            branchId:
              (await listImportBranches(tx)).find((branch) => branch.isHeadOffice)?.id ?? '',
          });
        }
      }
      for (const row of rows.filter((item) => item.status === 'created')) {
        const saved = asRecord(row.beforeData);
        const movementId = typeof saved.movementId === 'string' ? saved.movementId : null;
        if (movementId) {
          await reverseMovement(tx, user, movementId, 'Undo import');
        }
        await setItemStatus(tx, user, row.recordId, 'archived');
      }
    },

    async exportTable(tx) {
      const items = (await listItemsForImport(tx)).filter((item) => item.status === 'active');
      const branches = await listImportBranches(tx);
      const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
      return [
        [
          'SKU',
          'Name',
          'Unit',
          'Description',
          'Opening quantity',
          'Unit cost',
          'Branch',
          'Barcode',
          'Selling price',
        ],
        ...items.map((item) => [
          item.sku,
          item.name,
          item.unit,
          item.description,
          item.onHand,
          centsToDecimal(item.costCents),
          branchName.get('') ?? '',
          item.barcode ?? '',
          centsToDecimal(item.sellingPriceCents),
        ]),
      ];
    },
  };
}

function onHandMilli(value: string): bigint {
  const parsed = parseSaQuantity(value);
  return parsed.ok ? parsed.value : 0n;
}

async function stockActor(
  tx: TenantTransaction,
  actor: { userId: string | null; requestIp: string | null; userAgent: string | null },
) {
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
      throw new Error('This company needs an owner before stock can be imported.');
    }
    userId = row.id;
  }
  return { userId, requestIp: actor.requestIp, userAgent: actor.userAgent };
}

export type { StockImportRow, TenantTransaction };
