import { sql } from 'drizzle-orm';
import { appendAuditEvent, type TenantTransaction } from '@omnivate/kernel';
import type { CustomFieldValue } from '@omnivate/shared';
import { WorkflowError } from './errors';

/**
 * Actions a rule may run. notify and audit are built in.
 * A later module can register another action with the same shape.
 * sendsExternally must stay false: this module does not email or message WhatsApp.
 */

export type WorkflowActionContext = {
  tx: TenantTransaction;
  ruleId: string;
  ruleName: string;
  entityType: string;
  entityId: string;
  actorId: string;
  eventKey: string | null;
  machineKey: string | null;
  transitionKey: string | null;
  fromState: string | null;
  toState: string | null;
  fields: Record<string, CustomFieldValue>;
  config: Record<string, unknown>;
  requestIp: string | null;
  userAgent: string | null;
};

export type WorkflowActionHandler = {
  kind: string;
  label: string;
  sendsExternally: boolean;
  run: (context: WorkflowActionContext) => Promise<void>;
};

const handlers = new Map<string, WorkflowActionHandler>();

const RESERVED_EXTERNAL = new Set(['email', 'whatsapp', 'sms', 'webhook', 'http']);

export function registerWorkflowAction(handler: WorkflowActionHandler): void {
  if (handler.sendsExternally || RESERVED_EXTERNAL.has(handler.kind)) {
    throw new WorkflowError(
      'Email, WhatsApp, and other outside messages are not available yet. Use an in-app alert or a log entry.',
    );
  }
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(handler.kind)) {
    throw new WorkflowError('An action kind uses lowercase letters and underscores.');
  }
  handlers.set(handler.kind, handler);
}

export function listWorkflowActions(): { kind: string; label: string }[] {
  return [...handlers.values()]
    .map((handler) => ({ kind: handler.kind, label: handler.label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getWorkflowAction(kind: string): WorkflowActionHandler | undefined {
  return handlers.get(kind);
}

export async function setCurrentUser(tx: TenantTransaction, userId: string): Promise<void> {
  await tx.db.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
}

export async function audit(
  tx: TenantTransaction,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    actorId: string | null;
    operatorId?: string | null;
    beforeData: Record<string, unknown> | null;
    afterData: Record<string, unknown> | null;
    requestIp: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await appendAuditEvent(tx, {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.operatorId ? null : input.actorId,
    operatorId: input.operatorId ?? null,
    actorKind: input.operatorId ? 'operator' : 'user',
    beforeData: input.beforeData,
    afterData: input.afterData,
    requestIp: input.requestIp,
    userAgent: input.userAgent,
  });
}

type Actor = {
  actorId: string;
  requestIp: string | null;
  userAgent: string | null;
};

export type { Actor };
