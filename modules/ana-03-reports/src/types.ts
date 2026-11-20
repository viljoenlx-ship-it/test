import type { ModuleId, ReportAggregate, ReportFieldType } from '@omnivate/shared';

/** A join the source allows. The SQL is fixed on the source. The user cannot add one. */
export type ReportJoin = {
  key: string;
  label: string;
};

export type FormulaSlot = {
  sql: string;
  kind: 'money' | 'number';
};

export type ReportField = {
  key: string;
  label: string;
  type: ReportFieldType;
  /** Whitelisted SQL expression. Never taken from a request. */
  expr: string;
  aggregations: readonly ReportAggregate[];
  filterable: boolean;
  groupable: boolean;
  sensitive?: 'cost';
  display?: 'action';
};

export type ReportSource = {
  key: string;
  label: string;
  description: string;
  moduleId: ModuleId;
  /** The grant required to run this source. Admin on the same scope also qualifies. */
  read: { scope: string; moduleId: ModuleId };
  fromSql: string;
  joins: readonly ReportJoin[];
  fields: ReportField[];
  entityType?: string;
  customJoin?: string;
  formulaFields?: Record<string, FormulaSlot>;
  /** Formula keys that make a calculated field a cost. */
  sensitiveFormulaKeys?: readonly string[];
  defaultColumns: readonly string[];
};

export class ReportError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'ReportError';
  }
}

const UNSAFE = /;|--|\/\*|\*\//;

/** Registry expressions only. A request never reaches this with its own SQL. */
export function assertSafeExpr(expr: string): string {
  if (
    expr.length < 1 ||
    expr.length > 600 ||
    UNSAFE.test(expr) ||
    !/^[A-Za-z0-9_.,\s'():<>=!*+\-/|%]+$/.test(expr)
  ) {
    throw new ReportError('A report field was not registered safely.');
  }
  return expr;
}
