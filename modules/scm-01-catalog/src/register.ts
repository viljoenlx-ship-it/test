import type { FastifyInstance } from 'fastify';
import { tenantId, withTenant } from '@omnivate/kernel';
import { registerBuiltinReader, registerEntityType } from '@omnivate/module-krn-04';
import {
  adjustStock,
  dashboard,
  decideAdjustment,
  getItem,
  getLabelSettings,
  issueStock,
  labelFor,
  listBranches,
  listItems,
  listPending,
  lowStock,
  readStockNumbers,
  receiveStock,
  reverseMovement,
  saveItem,
  saveLabelSettings,
  setItemStatus,
  transferStock,
  valuation,
  type ItemWrite,
} from './catalog';
import {
  findScannedItem,
  getGoodsReceipt,
  listGoodsReceipts,
  previewGoodsReceiptLabels,
  printGoodsReceiptLabels,
  receiveGoods,
} from './goods-receipts';
import { assignItemBarcode } from './item-barcodes';
import {
  HttpError,
  readBody,
  readBool,
  readPacks,
  readSerials,
  readText,
  requireActor,
  route,
} from './http';

registerEntityType({
  key: 'scm.item',
  moduleId: 'SCM-01',
  label: 'Stock Item',
  description:
    'A catalog item. On hand, reorder level, and prices can feed a formula or an automation.',
  numericFields: [
    { key: 'on_hand', label: 'On Hand', kind: 'decimal' },
    { key: 'reorder_level', label: 'Reorder Level', kind: 'decimal' },
    { key: 'selling_price', label: 'Selling Price', kind: 'money' },
    { key: 'cost', label: 'Cost', kind: 'money' },
  ],
});

registerBuiltinReader('scm.item', readStockNumbers);

function itemWrite(body: Record<string, unknown>): ItemWrite {
  const kind = readText(body.kind);
  if (kind !== 'stock' && kind !== 'service' && kind !== 'non_stock') {
    throw new HttpError(400, 'bad_request', 'Choose stock, a service, or non-stock.');
  }
  return {
    kind,
    sku: readText(body.code),
    barcode: readText(body.barcode),
    name: readText(body.name),
    description: readText(body.description),
    category: readText(body.category),
    baseUom: readText(body.unit),
    baseUomPlural: readText(body.unitPlural),
    cost: readText(body.cost),
    sellingPrice: readText(body.sellingPrice),
    reorderLevel: readText(body.reorderLevel),
    trackBatches: readBool(body.trackBatches),
    trackSerials: readBool(body.trackSerials),
    uoms: readPacks(body.units),
  };
}

function readReceiptLines(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'bad_request', 'Add at least one line.');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, 'bad_request', 'A receipt line was not an object.');
    }
    const row = entry as Record<string, unknown>;
    return moveFrom(row);
  });
}

function readPrintLines(value: unknown): { lineId: string; copies: number }[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'bad_request', 'Choose the labels to print.');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, 'bad_request', 'A label line was not an object.');
    }
    const row = entry as Record<string, unknown>;
    const copies = typeof row.copies === 'number' ? row.copies : Number(row.copies);
    return { lineId: readText(row.lineId), copies };
  });
}

function moveFrom(body: Record<string, unknown>) {
  return {
    itemId: readText(body.itemId),
    branchId: readText(body.branchId),
    quantity: readText(body.quantity),
    uomName: readText(body.unit),
    unitCost: readText(body.cost),
    reason: readText(body.reason),
    batchCode: readText(body.batchCode),
    expiresOn: readText(body.expiresOn),
    serials: readSerials(body.serials),
    toBranchId: readText(body.toBranchId),
  };
}

/** Registers SCM-01 on the shared Fastify app. It does not listen on its own port. */
export async function registerScm01(app: FastifyInstance): Promise<void> {
  app.get(
    '/scm/dashboard',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) => dashboard(tx, actor));
      await reply.send(body);
    }),
  );

  app.get(
    '/scm/branches',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) => listBranches(tx, actor));
      await reply.send(body);
    }),
  );

  app.get(
    '/scm/items',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const query = request.query as { filter?: string; q?: string };
      const filter =
        query.filter === 'low' || query.filter === 'archived' ? query.filter : 'active';
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        listItems(tx, actor, filter, typeof query.q === 'string' ? query.q : ''),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/scm/items',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveItem(tx, actor, null, itemWrite(readBody(request))),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/scm/items/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) => getItem(tx, actor, id));
      await reply.send(body);
    }),
  );

  app.patch(
    '/scm/items/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const payload = readBody(request);
      const body = await withTenant(tenantId(actor.tenantId), async (tx) => {
        if (payload.status === 'archived' || payload.status === 'active') {
          return setItemStatus(tx, actor, id, payload.status);
        }
        return saveItem(tx, actor, id, itemWrite(payload));
      });
      await reply.send(body);
    }),
  );

  app.get(
    '/scm/items/:id/label',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) => labelFor(tx, actor, id));
      await reply.send(body);
    }),
  );

  app.get(
    '/scm/low-stock',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) => lowStock(tx, actor));
      await reply.send(body);
    }),
  );

  app.get(
    '/scm/valuation',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) => valuation(tx, actor));
      await reply.send(body);
    }),
  );

  app.get(
    '/scm/adjustments',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) => listPending(tx, actor));
      await reply.send(body);
    }),
  );

  app.post(
    '/scm/receive',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        receiveStock(tx, actor, moveFrom(readBody(request))),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/scm/scan',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const query = request.query as { code?: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        findScannedItem(tx, actor, typeof query.code === 'string' ? query.code : ''),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/scm/items/:id/barcode',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        assignItemBarcode(tx, actor, id, readText(readBody(request).barcode)),
      );
      await reply.send(body);
    }),
  );

  app.get(
    '/scm/goods-receipts',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) => listGoodsReceipts(tx, actor));
      await reply.send(body);
    }),
  );

  app.post(
    '/scm/goods-receipts',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const payload = readBody(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        receiveGoods(tx, actor, {
          branchId: readText(payload.branchId),
          note: readText(payload.note),
          supplierPartyId: readText(payload.supplierPartyId) || null,
          lines: readReceiptLines(payload.lines),
        }),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/scm/goods-receipts/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        getGoodsReceipt(tx, actor, id),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/scm/goods-receipts/:id/labels/preview',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        previewGoodsReceiptLabels(tx, actor, id),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/scm/goods-receipts/:id/labels',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        printGoodsReceiptLabels(tx, actor, id, readPrintLines(readBody(request).lines)),
      );
      await reply.code(201).send(body);
    }),
  );

  app.post(
    '/scm/issue',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        issueStock(tx, actor, moveFrom(readBody(request))),
      );
      await reply.code(201).send(body);
    }),
  );

  app.post(
    '/scm/adjust',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const payload = readBody(request);
      const direction = payload.direction === 'down' ? 'down' : 'up';
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        adjustStock(tx, actor, { ...moveFrom(payload), direction }),
      );
      await reply.code(body.pending ? 202 : 201).send(body);
    }),
  );

  app.post(
    '/scm/adjustments/:id/approve',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        decideAdjustment(tx, actor, id, 'approved'),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/scm/adjustments/:id/reject',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        decideAdjustment(tx, actor, id, 'rejected'),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/scm/transfer',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        transferStock(tx, actor, moveFrom(readBody(request))),
      );
      await reply.code(201).send(body);
    }),
  );

  app.post(
    '/scm/movements/:id/reverse',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const reason = readText(readBody(request).reason);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        reverseMovement(tx, actor, id, reason),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/scm/settings',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) => getLabelSettings(tx, actor));
      await reply.send(body);
    }),
  );

  app.put(
    '/scm/settings',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const payload = readBody(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveLabelSettings(tx, actor, {
          widthMm: readText(payload.widthMm),
          heightMm: readText(payload.heightMm),
          printer: readText(payload.printer),
        }),
      );
      await reply.send(body);
    }),
  );
}
