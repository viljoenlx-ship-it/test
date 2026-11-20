import type { TenantTransaction } from '@omnivate/kernel';
import type { ModuleId } from '@omnivate/shared';

export type FieldKind =
  'text' | 'email' | 'phone' | 'vat' | 'date' | 'money' | 'quantity' | 'choice';

export type ImportField = {
  key: string;
  label: string;
  required: boolean;
  kind: FieldKind;
  hint: string;
  aliases: readonly string[];
};

export type RowValues = Record<string, string>;

export type ImportActorContext = {
  userId: string | null;
  operatorId: string | null;
  requestIp: string | null;
  userAgent: string | null;
};

export type ApplyOptions = {
  vatTreatment: 'inclusive' | 'exclusive' | 'not_applicable';
  vatRateBasisPoints: number;
  actor: ImportActorContext;
};

export type AppliedWrite = {
  recordId: string;
  generationAfter: number;
  movementCountAfter: number;
  beforeData: Record<string, unknown> | null;
  deltaQuantityMilli: bigint;
  deltaValueCents: bigint;
};

export type UndoRow = {
  status: 'created' | 'updated';
  rowNumber: number;
  recordId: string;
  beforeData: Record<string, unknown> | null;
  deltaQuantityMilli: bigint;
  deltaValueCents: bigint;
};

export type FileKey = {
  kind: string;
  key: string;
  /** Plain message without the "Row N:" prefix. */
  message: (otherRow: number) => string;
};

/**
 * One kind of spreadsheet a company can import.
 * The module that owns the records supplies the fields, the checks, and the writes.
 */
export type ImportTarget = {
  id: string;
  moduleId: ModuleId;
  label: string;
  summary: string;
  needsVatChoice: boolean;
  fields: readonly ImportField[];
  allowUser(tx: TenantTransaction, userId: string): Promise<boolean>;
  denial: string;
  validate(values: RowValues): string[];
  /**
   * Checks that need the whole file, such as a trial balance that must add up.
   * Returned messages are attached to those rows and stop the import.
   */
  reviewBatch?(rows: { rowNumber: number; values: RowValues; invalid: boolean }[]): {
    rowNumber: number;
    message: string;
  }[];
  /** Checks that need data loaded for the company, such as branch names. */
  contextIssues(index: unknown, values: RowValues): string[];
  loadIndex(tx: TenantTransaction): Promise<unknown>;
  matchExisting(
    index: unknown,
    values: RowValues,
  ): { id: string; label: string; message: string } | null;
  fileKeys(values: RowValues): FileKey[];
  findExisting(
    tx: TenantTransaction,
    values: RowValues,
  ): Promise<{ id: string; label: string } | null>;
  createMany(
    tx: TenantTransaction,
    batchId: string,
    rows: { id: string; values: RowValues }[],
    options: ApplyOptions,
  ): Promise<AppliedWrite[]>;
  updateOne(
    tx: TenantTransaction,
    batchId: string,
    recordId: string,
    values: RowValues,
    options: ApplyOptions,
  ): Promise<AppliedWrite>;
  touchedRowNumbers(tx: TenantTransaction, batchId: string): Promise<number[]>;
  undo(
    tx: TenantTransaction,
    batchId: string,
    rows: UndoRow[],
    actor: ImportActorContext,
  ): Promise<void>;
  exportTable(tx: TenantTransaction): Promise<string[][]>;
};

export function textValue(values: RowValues, key: string): string {
  return (values[key] ?? '').trim();
}
