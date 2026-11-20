import { audit, registerWorkflowAction, type WorkflowActionContext } from './actions';
import { WorkflowError } from './errors';
import { audienceUserIds } from './notifications';
import { notifications } from './tables';

async function runNotify(context: WorkflowActionContext): Promise<void> {
  const title = typeof context.config.title === 'string' ? context.config.title.trim() : '';
  const body = typeof context.config.body === 'string' ? context.config.body.trim() : '';
  if (title.length < 1 || body.length < 1) {
    throw new WorkflowError('An alert needs a title and a message.');
  }
  const people = await audienceUserIds(context.tx, context.actorId, context.config);
  for (const userId of people) {
    await context.tx.db.insert(notifications).values({
      tenantId: context.tx.tenantId,
      userId,
      ruleId: context.ruleId,
      title: title.slice(0, 120),
      body: body.slice(0, 500),
      entityType: context.entityType,
      entityId: context.entityId,
    });
  }
}

async function runAudit(context: WorkflowActionContext): Promise<void> {
  const message = typeof context.config.message === 'string' ? context.config.message.trim() : '';
  if (message.length < 1) {
    throw new WorkflowError('A log entry needs a message.');
  }
  await audit(context.tx, {
    action: 'workflow.rule.logged',
    entityType: context.entityType,
    entityId: context.entityId,
    actorId: context.actorId,
    beforeData: null,
    afterData: { message, rule: context.ruleName, kind: 'workflow-log' },
    requestIp: context.requestIp,
    userAgent: context.userAgent,
  });
}

registerWorkflowAction({
  kind: 'notify',
  label: 'In-app alert',
  sendsExternally: false,
  run: runNotify,
});

registerWorkflowAction({
  kind: 'audit',
  label: 'Log entry',
  sendsExternally: false,
  run: runAudit,
});
