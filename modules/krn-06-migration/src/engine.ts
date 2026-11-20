import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { appendAuditEvent, type TenantTransaction } from '@omnivate/kernel';
import { southAfricaPreset } from '@omnivate/shared';
import { matchColumns, normaliseHeader, unmappedRequired } from './columns';
import { asNumber, asRecord, asStringList, asStringMap, joined, oneOf, rowsOf } from './db';
import { csvFor, readUpload, workbookFor, TEMPLATE_NOTES, type Sheet } from './files';
import { targetById } from './targets';
import type { ApplyOptions, ImportTarget, RowValues, UndoRow } from './target';

const CHUNK = 800;

export type Actor = {
  kind: 'user' | 'operator';
  userId: string | null;
  operatorId: string | null;
};

export type RequestMeta = {
  requestIp: string | null;
  userAgent: string | null;
};

export type DuplicatePolicy = 'skip' | 'update';
export type VatTreatment = 'inclusive' | 'exclusive' | 'not_applicable';

export type BatchView = {
  id: string;
  targetId: string;
  targetLabel: string;
  fileName: string;
  status: string;
  duplicatePolicy: DuplicatePolicy;
  vatTreatment: VatTreatment;
  columns: { header: string; fieldKey: string | null }[];
  fields: { key: string; label: string; required: boolean }[];
  warnings: string[];
  counts: Counts;
  canUndo: boolean;
  createdAt: string;
  completedAt: string | null;
};

export type Counts = {
  total: number;
  ready: number;
  invalid: number;
  duplicate: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  processed: number;
};

type BatchRow = {
  id: string;
  targetId: string;
  fileName: string;
  status: string;
  duplicatePolicy: DuplicatePolicy;
  vatTreatment: VatTreatment;
  headers: string[];
  columnMap: Record<string, string | null>;
  createdAt: Date;
  completedAt: Date | null;
  actorKind: string;
};

const batchSelect = sql`
  id,
  target_id AS "targetId",
  file_name AS "fileName",
  status,
  duplicate_policy AS "duplicatePolicy",
  vat_treatment AS "vatTreatment",
  headers,
  column_map AS "columnMap",
  created_at AS "createdAt",
  completed_at AS "completedAt",
  actor_kind AS "actorKind"
`;

export async function createPreview(
  tx: TenantTransaction,
  input: {
    actor: Actor;
    target: ImportTarget;
    fileName: string;
    bytes: Buffer;
    duplicatePolicy: DuplicatePolicy;
    vatTreatment: VatTreatment;
  },
): Promise<BatchView> {
  const sheet = await readUpload(input.fileName, input.bytes);
  const saved = await loadSaved(tx, input.target.id);
  const columnMap = matchColumns(sheet.headers, input.target.fields, saved);
  const options = await applyOptions(tx, input.target, input.vatTreatment, {
    userId: input.actor.userId,
    operatorId: input.actor.operatorId,
    requestIp: null,
    userAgent: null,
  });
  const index = await input.target.loadIndex(tx);
  const prepared = assess(input.target, index, sheet, columnMap);
  const batchId = randomUUID();
  const fileName = input.fileName.split(/[/\\]/).pop()?.slice(0, 200) || 'import.csv';
  await tx.db.execute(sql`
    INSERT INTO krn06_import_batches (
      id, tenant_id, target_id, file_name, status, duplicate_policy, vat_treatment,
      vat_rate_basis_points, headers, column_map, actor_id, operator_id, actor_kind
    ) VALUES (
      ${batchId}::uuid,
      ${tx.tenantId}::uuid,
      ${input.target.id},
      ${fileName},
      'preview',
      ${input.duplicatePolicy},
      ${options.vatTreatment},
      ${options.vatRateBasisPoints},
      ${JSON.stringify(sheet.headers)}::jsonb,
      ${JSON.stringify(columnMap)}::jsonb,
      ${input.actor.userId}::uuid,
      ${input.actor.operatorId}::uuid,
      ${input.actor.kind}
    )
  `);
  await insertPrepared(tx, batchId, prepared);
  await rememberMap(tx, input.target.id, columnMap);
  return viewFor(tx, input.target, await lockBatch(tx, batchId));
}

export async function updateMapping(
  tx: TenantTransaction,
  input: {
    target: ImportTarget;
    batchId: string;
    columnMap: Record<string, string | null>;
    duplicatePolicy: DuplicatePolicy;
    vatTreatment: VatTreatment;
  },
): Promise<BatchView> {
  const batch = await lockBatch(tx, input.batchId);
  if (batch.targetId !== input.target.id) {
    throw new Error('That import does not match this choice.');
  }
  if (batch.status !== 'preview') {
    throw new Error('Columns can only be changed before the import starts.');
  }
  const allowed = new Set(input.target.fields.map((field) => field.key));
  const next: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const header of batch.headers) {
    const field = input.columnMap[header] ?? null;
    if (field && (!allowed.has(field) || used.has(field))) {
      next[header] = null;
      continue;
    }
    if (field) {
      used.add(field);
    }
    next[header] = field;
  }
  const options = await applyOptions(tx, input.target, input.vatTreatment, {
    userId: null,
    operatorId: null,
    requestIp: null,
    userAgent: null,
  });
  const stored = await rowsOf<{ rowNumber: number; raw: unknown }>(
    tx,
    sql`SELECT row_number AS "rowNumber", raw
        FROM krn06_import_rows
        WHERE batch_id = ${batch.id}::uuid
        ORDER BY row_number`,
  );
  const sheet: Sheet = {
    headers: batch.headers,
    rows: stored.map((row) => ({
      rowNumber: asNumber(row.rowNumber),
      cells: asStringMap(row.raw),
    })),
  };
  const index = await input.target.loadIndex(tx);
  const prepared = assess(input.target, index, sheet, next);
  await tx.db.execute(sql`DELETE FROM krn06_import_rows WHERE batch_id = ${batch.id}::uuid`);
  await tx.db.execute(sql`
    UPDATE krn06_import_batches SET
      column_map = ${JSON.stringify(next)}::jsonb,
      duplicate_policy = ${input.duplicatePolicy},
      vat_treatment = ${options.vatTreatment},
      vat_rate_basis_points = ${options.vatRateBasisPoints}
    WHERE id = ${batch.id}::uuid
  `);
  await insertPrepared(tx, batch.id, prepared);
  await rememberMap(tx, input.target.id, next);
  return viewFor(tx, input.target, await lockBatch(tx, batch.id));
}

export async function readBatch(
  tx: TenantTransaction,
  target: ImportTarget,
  batchId: string,
): Promise<BatchView> {
  const batch = await loadBatch(tx, batchId);
  if (batch.targetId !== target.id) {
    throw new Error('That import does not match this choice.');
  }
  return viewFor(tx, target, batch);
}

export async function advance(
  tx: TenantTransaction,
  input: { target: ImportTarget; batchId: string; actor: Actor; meta: RequestMeta },
): Promise<BatchView> {
  const batch = await lockBatch(tx, input.batchId);
  if (batch.targetId !== input.target.id) {
    throw new Error('That import does not match this choice.');
  }
  if (batch.status === 'undone') {
    throw new Error('This import was undone.');
  }
  if (batch.status === 'completed') {
    return viewFor(tx, input.target, batch);
  }
  if (batch.status === 'preview') {
    const counts = await countRows(tx, batch.id);
    if (counts.ready + counts.duplicate === 0) {
      throw new Error('There is nothing to import. Fix the rows in the file and upload it again.');
    }
    await tx.db.execute(sql`
      UPDATE krn06_import_batches SET status = 'running' WHERE id = ${batch.id}::uuid
    `);
  }

  const chunk = await rowsOf<DbImportRow>(
    tx,
    sql`SELECT id,
          row_number AS "rowNumber",
          status,
          values,
          existing_id AS "existingId"
        FROM krn06_import_rows
        WHERE batch_id = ${batch.id}::uuid
          AND status IN ('ready', 'duplicate')
        ORDER BY row_number
        LIMIT ${CHUNK}`,
  );

  if (chunk.length === 0) {
    await finish(tx, batch, input.actor, input.meta);
    return viewFor(tx, input.target, await lockBatch(tx, batch.id));
  }

  const options = await applyOptions(tx, input.target, batch.vatTreatment, {
    userId: input.actor.userId,
    operatorId: input.actor.operatorId,
    requestIp: input.meta.requestIp,
    userAgent: input.meta.userAgent,
  });
  if (batch.duplicatePolicy === 'skip') {
    const duplicates = chunk.filter((row) => row.status === 'duplicate').map((row) => row.id);
    if (duplicates.length > 0) {
      await tx.db.execute(sql`
        UPDATE krn06_import_rows
        SET status = 'skipped'
        WHERE id IN (${joined(duplicates.map((id) => sql`${id}::uuid`))})
      `);
    }
    const ready = chunk.filter((row) => row.status === 'ready');
    await writeCreates(tx, input.target, batch.id, ready, options);
  } else {
    await writeInOrder(tx, input.target, batch.id, chunk, options);
  }

  const remaining = await oneOf<{ count: number }>(
    tx,
    sql`SELECT count(*)::int AS count
        FROM krn06_import_rows
        WHERE batch_id = ${batch.id}::uuid AND status IN ('ready', 'duplicate')`,
  );
  if (asNumber(remaining?.count) === 0) {
    await finish(tx, batch, input.actor, input.meta);
  }
  return viewFor(tx, input.target, await lockBatch(tx, batch.id));
}

export async function undoImport(
  tx: TenantTransaction,
  input: { target: ImportTarget; batchId: string; actor: Actor; meta: RequestMeta },
): Promise<BatchView> {
  const batch = await lockBatch(tx, input.batchId);
  if (batch.targetId !== input.target.id) {
    throw new Error('That import does not match this choice.');
  }
  if (batch.status !== 'completed') {
    throw new Error('Only a finished import can be undone.');
  }
  const touched = await input.target.touchedRowNumbers(tx, batch.id);
  if (touched.length > 0) {
    const listed =
      touched.length === 1
        ? `Row ${touched[0]} has been changed since the import.`
        : `Rows ${touched.join(', ')} have been changed since the import.`;
    throw new Error(`This import cannot be undone. ${listed}`);
  }
  const written = await rowsOf<UndoSource>(
    tx,
    sql`SELECT row_number AS "rowNumber",
          status,
          record_id AS "recordId",
          before_data AS "beforeData",
          delta_quantity_milli AS "deltaQuantityMilli",
          delta_value_cents AS "deltaValueCents"
        FROM krn06_import_rows
        WHERE batch_id = ${batch.id}::uuid
          AND status IN ('created', 'updated')
        ORDER BY row_number`,
  );
  const undoRows: UndoRow[] = written.map((row) => ({
    status: row.status === 'updated' ? 'updated' : 'created',
    rowNumber: asNumber(row.rowNumber),
    recordId: String(row.recordId),
    beforeData: row.beforeData ? asRecord(row.beforeData) : null,
    deltaQuantityMilli: asBig(row.deltaQuantityMilli),
    deltaValueCents: asBig(row.deltaValueCents),
  }));
  await input.target.undo(tx, batch.id, undoRows, {
    userId: input.actor.userId,
    operatorId: input.actor.operatorId,
    requestIp: input.meta.requestIp,
    userAgent: input.meta.userAgent,
  });
  await tx.db.execute(sql`
    UPDATE krn06_import_rows
    SET status = 'undone'
    WHERE batch_id = ${batch.id}::uuid AND status IN ('created', 'updated')
  `);
  await tx.db.execute(sql`
    UPDATE krn06_import_batches
    SET status = 'undone', undone_at = now()
    WHERE id = ${batch.id}::uuid
  `);
  await appendAuditEvent(tx, {
    action: 'krn06.import.undone',
    entityType: 'import_batch',
    entityId: batch.id,
    actorId: input.actor.userId,
    operatorId: input.actor.operatorId,
    actorKind: input.actor.kind,
    beforeData: null,
    afterData: { target: input.target.label, fileName: batch.fileName, rows: undoRows.length },
    requestIp: input.meta.requestIp,
    userAgent: input.meta.userAgent,
  });
  return viewFor(tx, input.target, await lockBatch(tx, batch.id));
}

export async function listBatches(tx: TenantTransaction): Promise<
  {
    id: string;
    targetId: string;
    targetLabel: string;
    fileName: string;
    status: string;
    createdAt: string;
    created: number;
  }[]
> {
  const list = await rowsOf<{
    id: string;
    targetId: string;
    fileName: string;
    status: string;
    createdAt: Date;
    created: number;
  }>(
    tx,
    sql`SELECT b.id,
          b.target_id AS "targetId",
          b.file_name AS "fileName",
          b.status,
          b.created_at AS "createdAt",
          (
            SELECT count(*)::int FROM krn06_import_rows AS r
            WHERE r.batch_id = b.id AND r.status = 'created'
          ) AS created
        FROM krn06_import_batches AS b
        ORDER BY b.created_at DESC
        LIMIT 12`,
  );
  return list.map((row) => ({
    id: row.id,
    targetId: row.targetId,
    targetLabel: targetById(row.targetId)?.label ?? row.targetId,
    fileName: row.fileName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    created: asNumber(row.created),
  }));
}

export async function previewRows(
  tx: TenantTransaction,
  batchId: string,
): Promise<{ rowNumber: number; status: string; messages: string[]; values: RowValues }[]> {
  const list = await rowsOf<{
    rowNumber: number;
    status: string;
    messages: unknown;
    values: unknown;
  }>(
    tx,
    sql`SELECT row_number AS "rowNumber", status, messages, values
        FROM krn06_import_rows
        WHERE batch_id = ${batchId}::uuid
        ORDER BY CASE WHEN status IN ('invalid', 'failed', 'duplicate') THEN 0 ELSE 1 END,
          row_number
        LIMIT 40`,
  );
  return list.map((row) => ({
    rowNumber: asNumber(row.rowNumber),
    status: row.status,
    messages: asStringList(row.messages).map(
      (message) => `Row ${asNumber(row.rowNumber)}: ${message}`,
    ),
    values: asStringMap(row.values),
  }));
}

export async function errorReport(tx: TenantTransaction, batchId: string): Promise<string> {
  const list = await rowsOf<{ rowNumber: number; status: string; messages: unknown }>(
    tx,
    sql`SELECT row_number AS "rowNumber", status, messages
        FROM krn06_import_rows
        WHERE batch_id = ${batchId}::uuid
          AND status IN ('invalid', 'failed', 'skipped')
        ORDER BY row_number`,
  );
  const table = [
    ['Row', 'Result', 'What to fix'],
    ...list.map((row) => {
      const number = asNumber(row.rowNumber);
      const messages = asStringList(row.messages);
      const detail =
        messages.length > 0
          ? `Row ${number}: ${messages.join(' ')}`
          : row.status === 'skipped'
            ? `Row ${number}: Skipped because it matches a contact or item you already have.`
            : '';
      return [String(number), statusLabel(row.status), detail];
    }),
  ];
  if (table.length === 1) {
    table.push(['', 'Nothing to fix', 'Every row was accepted.']);
  }
  return csvFor(table);
}

export function templateTable(target: ImportTarget): string[][] {
  return [target.fields.map((field) => field.label)];
}

export async function templateWorkbook(target: ImportTarget): Promise<Buffer> {
  const notes = [
    ...TEMPLATE_NOTES,
    ...target.fields.map(
      (field) => `${field.label}${field.required ? ' (required)' : ''}: ${field.hint}`,
    ),
  ];
  if (target.needsVatChoice) {
    notes.push('Before you import, say whether the unit cost includes VAT or not.');
  }
  return workbookFor(target.label, templateTable(target), notes);
}

export async function exportWorkbook(target: ImportTarget, tx: TenantTransaction): Promise<Buffer> {
  const table = await target.exportTable(tx);
  return workbookFor(target.label, table, [
    'This is a copy of your records. You can edit it and import it again.',
  ]);
}

export async function exportCsv(target: ImportTarget, tx: TenantTransaction): Promise<string> {
  return csvFor(await target.exportTable(tx));
}

type Prepared = {
  rowNumber: number;
  raw: Record<string, string>;
  values: RowValues;
  status: string;
  messages: string[];
  existingId: string | null;
  existingLabel: string | null;
};

type DbImportRow = {
  id: string;
  rowNumber: number;
  status: string;
  values: unknown;
  existingId: string | null;
};

type UndoSource = {
  rowNumber: number;
  status: string;
  recordId: string | null;
  beforeData: unknown;
  deltaQuantityMilli: unknown;
  deltaValueCents: unknown;
};

function assess(
  target: ImportTarget,
  index: unknown,
  sheet: Sheet,
  columnMap: Record<string, string | null>,
): Prepared[] {
  const seen = new Map<string, number>();
  const prepared = sheet.rows.map((row) => {
    const values = mapValues(row.cells, columnMap);
    const messages = [...target.validate(values), ...target.contextIssues(index, values)];
    const invalid = messages.length > 0;
    const existing = target.matchExisting(index, values);
    if (existing) {
      messages.push(existing.message);
    }
    let inFile = false;
    for (const fileKey of target.fileKeys(values)) {
      const mapKey = `${fileKey.kind}:${fileKey.key}`;
      const prior = seen.get(mapKey);
      if (prior) {
        messages.push(fileKey.message(prior));
        inFile = true;
      } else {
        seen.set(mapKey, row.rowNumber);
      }
    }
    const status = invalid ? 'invalid' : existing || inFile ? 'duplicate' : 'ready';
    return {
      rowNumber: row.rowNumber,
      raw: row.cells,
      values,
      status,
      messages,
      existingId: existing?.id ?? null,
      existingLabel: existing?.label ?? null,
    };
  });
  if (!target.reviewBatch) {
    return prepared;
  }
  const extra = target.reviewBatch(
    prepared.map((row) => ({
      rowNumber: row.rowNumber,
      values: row.values,
      invalid: row.status === 'invalid',
    })),
  );
  for (const item of extra) {
    const row = prepared.find((candidate) => candidate.rowNumber === item.rowNumber);
    if (!row) {
      continue;
    }
    row.messages.push(item.message);
    if (row.status !== 'invalid') {
      row.status = 'invalid';
    }
  }
  return prepared;
}

function mapValues(
  cells: Record<string, string>,
  columnMap: Record<string, string | null>,
): RowValues {
  const values: RowValues = {};
  for (const [header, field] of Object.entries(columnMap)) {
    if (!field) {
      continue;
    }
    values[field] = cells[header] ?? '';
  }
  return values;
}

async function insertPrepared(
  tx: TenantTransaction,
  batchId: string,
  prepared: Prepared[],
): Promise<void> {
  for (let start = 0; start < prepared.length; start += 400) {
    const slice = prepared.slice(start, start + 400);
    const tuples = slice.map(
      (row) => sql`(
        ${randomUUID()}::uuid,
        ${tx.tenantId}::uuid,
        ${batchId}::uuid,
        ${row.rowNumber},
        ${JSON.stringify(row.raw)}::jsonb,
        ${JSON.stringify(row.values)}::jsonb,
        ${row.status},
        ${JSON.stringify(row.messages)}::jsonb,
        ${row.existingId}::uuid,
        ${row.existingLabel}
      )`,
    );
    await tx.db.execute(sql`
      INSERT INTO krn06_import_rows (
        id, tenant_id, batch_id, row_number, raw, values, status, messages, existing_id, existing_label
      )
      VALUES ${joined(tuples)}
    `);
  }
}

async function writeCreates(
  tx: TenantTransaction,
  target: ImportTarget,
  batchId: string,
  ready: DbImportRow[],
  options: ApplyOptions,
): Promise<void> {
  if (ready.length === 0) {
    return;
  }
  const created = ready.map((row) => ({
    importId: row.id,
    recordId: randomUUID(),
    values: asStringMap(row.values),
  }));
  const applied = await target.createMany(
    tx,
    batchId,
    created.map((row) => ({ id: row.recordId, values: row.values })),
    options,
  );
  const tuples = applied.map(
    (write, index) => sql`(
      ${created[index]?.importId}::uuid,
      ${write.recordId}::uuid,
      ${write.generationAfter}::int,
      ${write.movementCountAfter}::int,
      ${write.beforeData ? JSON.stringify(write.beforeData) : null}::jsonb,
      ${write.deltaQuantityMilli}::bigint,
      ${write.deltaValueCents}::bigint
    )`,
  );
  await tx.db.execute(sql`
    UPDATE krn06_import_rows AS r SET
      status = 'created',
      record_id = v.record_id,
      generation_after = v.generation_after,
      movement_count_after = v.movement_count_after,
      before_data = v.before_data,
      delta_quantity_milli = v.delta_quantity_milli,
      delta_value_cents = v.delta_value_cents
    FROM (VALUES ${joined(tuples)}) AS v(
      id, record_id, generation_after, movement_count_after, before_data,
      delta_quantity_milli, delta_value_cents
    )
    WHERE r.id = v.id
  `);
}

async function writeInOrder(
  tx: TenantTransaction,
  target: ImportTarget,
  batchId: string,
  chunk: DbImportRow[],
  options: ApplyOptions,
): Promise<void> {
  for (const row of chunk) {
    await tx.db.execute(sql`SAVEPOINT krn06_row`);
    try {
      if (row.status === 'duplicate') {
        let recordId = row.existingId;
        if (!recordId) {
          const found = await target.findExisting(tx, asStringMap(row.values));
          recordId = found?.id ?? null;
        }
        if (!recordId) {
          throw new Error('The earlier row in this file did not create a record to update.');
        }
        const applied = await target.updateOne(
          tx,
          batchId,
          recordId,
          asStringMap(row.values),
          options,
        );
        await storeWrite(tx, row.id, 'updated', applied);
      } else {
        const recordId = randomUUID();
        const applied = await target.createMany(
          tx,
          batchId,
          [{ id: recordId, values: asStringMap(row.values) }],
          options,
        );
        const write = applied[0];
        if (!write) {
          throw new Error('The row was not saved.');
        }
        await storeWrite(tx, row.id, 'created', write);
      }
      await tx.db.execute(sql`RELEASE SAVEPOINT krn06_row`);
    } catch (error) {
      await tx.db.execute(sql`ROLLBACK TO SAVEPOINT krn06_row`);
      const message = error instanceof Error ? error.message : 'This row could not be saved.';
      await tx.db.execute(sql`
        UPDATE krn06_import_rows
        SET status = 'failed', messages = ${JSON.stringify([message])}::jsonb
        WHERE id = ${row.id}::uuid
      `);
    }
  }
}

async function storeWrite(
  tx: TenantTransaction,
  importId: string,
  status: 'created' | 'updated',
  write: {
    recordId: string;
    generationAfter: number;
    movementCountAfter: number;
    beforeData: Record<string, unknown> | null;
    deltaQuantityMilli: bigint;
    deltaValueCents: bigint;
  },
): Promise<void> {
  await tx.db.execute(sql`
    UPDATE krn06_import_rows SET
      status = ${status},
      record_id = ${write.recordId}::uuid,
      generation_after = ${write.generationAfter},
      movement_count_after = ${write.movementCountAfter},
      before_data = ${write.beforeData ? JSON.stringify(write.beforeData) : null}::jsonb,
      delta_quantity_milli = ${write.deltaQuantityMilli},
      delta_value_cents = ${write.deltaValueCents}
    WHERE id = ${importId}::uuid
  `);
}

async function finish(
  tx: TenantTransaction,
  batch: BatchRow,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  const updated = await oneOf<{ id: string }>(
    tx,
    sql`UPDATE krn06_import_batches
        SET status = 'completed', completed_at = now()
        WHERE id = ${batch.id}::uuid AND status = 'running'
        RETURNING id`,
  );
  if (!updated) {
    return;
  }
  const counts = await countRows(tx, batch.id);
  const target = targetById(batch.targetId);
  await appendAuditEvent(tx, {
    action: 'krn06.import.completed',
    entityType: 'import_batch',
    entityId: batch.id,
    actorId: actor.userId,
    operatorId: actor.operatorId,
    actorKind: actor.kind,
    beforeData: null,
    afterData: {
      target: target?.label ?? batch.targetId,
      fileName: batch.fileName,
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
      failed: counts.failed,
      invalid: counts.invalid,
    },
    requestIp: meta.requestIp,
    userAgent: meta.userAgent,
  });
}

async function viewFor(
  tx: TenantTransaction,
  target: ImportTarget,
  batch: BatchRow,
): Promise<BatchView> {
  const counts = await countRows(tx, batch.id);
  const warnings = unmappedRequired(target.fields, batch.columnMap).map(
    (field) => `Choose which column is the ${field.label.toLowerCase()}.`,
  );
  const touched =
    batch.status === 'completed' && counts.created + counts.updated > 0
      ? await target.touchedRowNumbers(tx, batch.id)
      : [];
  return {
    id: batch.id,
    targetId: target.id,
    targetLabel: target.label,
    fileName: batch.fileName,
    status: batch.status,
    duplicatePolicy: batch.duplicatePolicy,
    vatTreatment: batch.vatTreatment,
    columns: batch.headers.map((header) => ({ header, fieldKey: batch.columnMap[header] ?? null })),
    fields: target.fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
    })),
    warnings,
    counts,
    canUndo:
      batch.status === 'completed' && counts.created + counts.updated > 0 && touched.length === 0,
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
  };
}

async function countRows(tx: TenantTransaction, batchId: string): Promise<Counts> {
  const list = await rowsOf<{ status: string; count: number }>(
    tx,
    sql`SELECT status, count(*)::int AS count
        FROM krn06_import_rows
        WHERE batch_id = ${batchId}::uuid
        GROUP BY status`,
  );
  const counts: Counts = {
    total: 0,
    ready: 0,
    invalid: 0,
    duplicate: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    processed: 0,
  };
  for (const row of list) {
    const count = asNumber(row.count);
    counts.total += count;
    if (row.status === 'ready') counts.ready = count;
    else if (row.status === 'invalid') counts.invalid = count;
    else if (row.status === 'duplicate') counts.duplicate = count;
    else if (row.status === 'created') counts.created = count;
    else if (row.status === 'updated') counts.updated = count;
    else if (row.status === 'skipped') counts.skipped = count;
    else if (row.status === 'failed') counts.failed = count;
  }
  counts.processed = counts.created + counts.updated + counts.skipped + counts.failed;
  return counts;
}

async function loadBatch(tx: TenantTransaction, batchId: string): Promise<BatchRow> {
  const row = await oneOf<Record<string, unknown>>(
    tx,
    sql`SELECT ${batchSelect}
        FROM krn06_import_batches
        WHERE id = ${batchId}::uuid`,
  );
  return parseBatch(row);
}

async function lockBatch(tx: TenantTransaction, batchId: string): Promise<BatchRow> {
  const row = await oneOf<Record<string, unknown>>(
    tx,
    sql`SELECT ${batchSelect}
        FROM krn06_import_batches
        WHERE id = ${batchId}::uuid
        FOR UPDATE`,
  );
  return parseBatch(row);
}

function parseBatch(row: Record<string, unknown> | null): BatchRow {
  if (!row) {
    throw new Error('That import was not found.');
  }
  return {
    id: String(row.id),
    targetId: String(row.targetId),
    fileName: String(row.fileName),
    status: String(row.status),
    duplicatePolicy: row.duplicatePolicy === 'update' ? 'update' : 'skip',
    vatTreatment:
      row.vatTreatment === 'inclusive' || row.vatTreatment === 'exclusive'
        ? row.vatTreatment
        : 'not_applicable',
    headers: asStringList(row.headers),
    columnMap: mapOrNull(row.columnMap),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
    completedAt: row.completedAt instanceof Date ? row.completedAt : null,
    actorKind: String(row.actorKind),
  };
}

function mapOrNull(value: unknown): Record<string, string | null> {
  const record = asRecord(value);
  const out: Record<string, string | null> = {};
  for (const [key, item] of Object.entries(record)) {
    out[key] = typeof item === 'string' ? item : null;
  }
  return out;
}

async function loadSaved(tx: TenantTransaction, targetId: string): Promise<Map<string, string>> {
  const list = await rowsOf<{ sourceHeader: string; fieldKey: string }>(
    tx,
    sql`SELECT source_header AS "sourceHeader", field_key AS "fieldKey"
        FROM krn06_saved_mappings
        WHERE target_id = ${targetId}`,
  );
  return new Map(list.map((row) => [row.sourceHeader, row.fieldKey]));
}

async function rememberMap(
  tx: TenantTransaction,
  targetId: string,
  columnMap: Record<string, string | null>,
): Promise<void> {
  const headers = Object.keys(columnMap)
    .map((header) => normaliseHeader(header))
    .filter(Boolean);
  if (headers.length > 0) {
    await tx.db.execute(sql`
      DELETE FROM krn06_saved_mappings
      WHERE target_id = ${targetId}
        AND source_header IN (${joined(headers.map((header) => sql`${header}`))})
    `);
  }
  const mapped = Object.entries(columnMap).filter((entry): entry is [string, string] => {
    return entry[1] !== null && normaliseHeader(entry[0]) !== '';
  });
  if (mapped.length === 0) {
    return;
  }
  const seen = new Set<string>();
  const tuples = mapped.flatMap(([header, field]) => {
    const source = normaliseHeader(header);
    if (seen.has(source)) {
      return [];
    }
    seen.add(source);
    return [
      sql`(
        ${tx.tenantId}::uuid,
        ${targetId},
        ${source},
        ${field}
      )`,
    ];
  });
  if (tuples.length === 0) {
    return;
  }
  await tx.db.execute(sql`
    INSERT INTO krn06_saved_mappings (tenant_id, target_id, source_header, field_key)
    VALUES ${joined(tuples)}
  `);
}

async function applyOptions(
  tx: TenantTransaction,
  target: ImportTarget,
  requested: VatTreatment,
  actor: ApplyOptions['actor'],
): Promise<ApplyOptions> {
  const row = await oneOf<{ rate: number }>(
    tx,
    sql`SELECT vat_rate_basis_points AS rate FROM tenants`,
  );
  const rate = asNumber(row?.rate) || southAfricaPreset.vatStandardRateBasisPoints;
  if (!target.needsVatChoice) {
    return { vatTreatment: 'not_applicable', vatRateBasisPoints: rate, actor };
  }
  return {
    vatTreatment: requested === 'inclusive' ? 'inclusive' : 'exclusive',
    vatRateBasisPoints: rate,
    actor,
  };
}

function statusLabel(status: string): string {
  if (status === 'invalid') return 'Needs a fix';
  if (status === 'failed') return 'Not saved';
  if (status === 'skipped') return 'Skipped';
  return status;
}

function asBig(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string' && value.trim() !== '') return BigInt(value);
  return 0n;
}
