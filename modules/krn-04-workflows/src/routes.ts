import type { FastifyInstance } from 'fastify';
import { tenantId, withTenant } from '@omnivate/kernel';
import {
  isFieldType,
  isOptionValue,
  type FieldOption,
  type FieldType,
  type FormulaDisplay,
} from '@omnivate/shared';
import { listWorkflowActions } from './actions';
import {
  archiveFieldDefinition,
  restoreFieldDefinition,
  canEditFields,
  createFieldDefinition,
  listDefinitions,
  listDefinitionsForOperator,
  listSamples,
  loadFieldValues,
  mergeCalculated,
  reorderFields,
  type FieldAdmin,
  updateFieldDefinition,
  type FieldDraft,
} from './fields';
import {
  archiveAutomation,
  createAutomation,
  listAutomationPeople,
  listAutomationStages,
  listAutomations,
  reorderAutomations,
  updateAutomation,
  type AutomationAction,
  type AutomationCondition,
  type AutomationDraft,
} from './automations';
import { numericFieldList } from './fields';
import { getEntityType, listEntityTypes } from './registry';
import { archivePipeline, installMachine, listPipelines, updatePipelineExtras } from './machines';
import {
  archiveRule,
  createRule,
  listRules,
  moveRecord,
  saveCustomFields,
  updateRule,
  type RuleCondition,
  type RuleDraft,
} from './workflows';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from './notifications';
import { workflowSummary } from './summary';
import { HttpError, readBody, readUuid, requireOperator, requireSession, route } from './http';

function optionalInt(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new HttpError(400, 'bad_request', `Check ${label}.`);
  }
  return value;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'bad_request', 'Check the number limits.');
  }
  return value.trim();
}

function readOptions(value: unknown): FieldOption[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'bad_request', 'Add choices as a list.');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(400, 'bad_request', 'Each choice needs a name.');
    }
    const row = item as { value?: unknown; label?: unknown };
    if (typeof row.label !== 'string' || row.label.trim().length < 1) {
      throw new HttpError(400, 'bad_request', 'Each choice needs a name.');
    }
    const slug =
      typeof row.value === 'string' && isOptionValue(row.value)
        ? row.value
        : row.label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40);
    return { value: slug, label: row.label.trim() };
  });
}

function readFieldDraft(body: Record<string, unknown>): FieldDraft {
  if (typeof body.entityType !== 'string' || typeof body.fieldKey !== 'string') {
    throw new HttpError(400, 'bad_request', 'Choose the record and a field key.');
  }
  if (
    typeof body.label !== 'string' ||
    typeof body.fieldType !== 'string' ||
    !isFieldType(body.fieldType)
  ) {
    throw new HttpError(400, 'bad_request', 'Choose a field type.');
  }
  return {
    entityType: body.entityType,
    fieldKey: body.fieldKey,
    label: body.label,
    fieldType: body.fieldType as FieldType,
    required: body.required === true,
    description: typeof body.description === 'string' ? body.description : '',
    minLength: optionalInt(body.minLength, 'the minimum length'),
    maxLength: optionalInt(body.maxLength, 'the maximum length'),
    minNumber: optionalText(body.minNumber),
    maxNumber: optionalText(body.maxNumber),
    minCents: optionalInt(body.minCents, 'the minimum amount'),
    maxCents: optionalInt(body.maxCents, 'the maximum amount'),
    options: readOptions(body.options),
    ...readFormula(body),
  };
}

function readFormula(body: Record<string, unknown>): {
  formula: string | null;
  formulaPlaces: number | null;
  formulaDisplay: FormulaDisplay | null;
  formulaUnit: string;
} {
  if (body.fieldType !== 'calculated') {
    return { formula: null, formulaPlaces: null, formulaDisplay: null, formulaUnit: '' };
  }
  const display =
    body.formulaDisplay === 'money' || body.formulaDisplay === 'number'
      ? body.formulaDisplay
      : null;
  return {
    formula: typeof body.formula === 'string' ? body.formula : null,
    formulaPlaces: optionalInt(body.formulaPlaces, 'the rounding'),
    formulaDisplay: display,
    formulaUnit: typeof body.formulaUnit === 'string' ? body.formulaUnit : '',
  };
}

function readConditions(value: unknown): RuleCondition[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'bad_request', 'Conditions are a list.');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(400, 'bad_request', 'Check the conditions.');
    }
    const row = item as { source?: unknown; key?: unknown; op?: unknown; value?: unknown };
    if (row.source !== 'field' && row.source !== 'state') {
      throw new HttpError(400, 'bad_request', 'A condition looks at a field or the stage.');
    }
    if (typeof row.op !== 'string') {
      throw new HttpError(400, 'bad_request', 'Choose how to compare.');
    }
    return {
      source: row.source,
      key: typeof row.key === 'string' ? row.key : undefined,
      op: row.op as RuleCondition['op'],
      value: typeof row.value === 'string' ? row.value : undefined,
    };
  });
}

function readRule(body: Record<string, unknown>): RuleDraft {
  if (typeof body.name !== 'string' || typeof body.entityType !== 'string') {
    throw new HttpError(400, 'bad_request', 'Name the alert and choose a record.');
  }
  if (body.triggerKind !== 'event' && body.triggerKind !== 'transition') {
    throw new HttpError(400, 'bad_request', 'Choose when the alert runs.');
  }
  if (typeof body.actionKind !== 'string') {
    throw new HttpError(400, 'bad_request', 'Choose what the alert does.');
  }
  const config = body.actionConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new HttpError(400, 'bad_request', 'The alert is missing its message.');
  }
  return {
    name: body.name,
    entityType: body.entityType,
    triggerKind: body.triggerKind,
    eventKey: typeof body.eventKey === 'string' ? body.eventKey : null,
    machineKey: typeof body.machineKey === 'string' ? body.machineKey : null,
    transitionKey: typeof body.transitionKey === 'string' ? body.transitionKey : null,
    conditions: readConditions(body.conditions),
    actionKind: body.actionKind,
    actionConfig: config as Record<string, unknown>,
    enabled: body.enabled !== false,
  };
}

function readAutomation(body: Record<string, unknown>): AutomationDraft {
  if (typeof body.name !== 'string' || typeof body.entityType !== 'string') {
    throw new HttpError(400, 'bad_request', 'Name the automation and choose a record.');
  }
  if (body.triggerKind !== 'created' && body.triggerKind !== 'field_changed') {
    throw new HttpError(400, 'bad_request', 'Choose when the automation runs.');
  }
  if (!Array.isArray(body.conditions) || !Array.isArray(body.actions)) {
    throw new HttpError(400, 'bad_request', 'Add the conditions and the actions.');
  }
  return {
    name: body.name,
    entityType: body.entityType,
    triggerKind: body.triggerKind,
    fieldKey: typeof body.fieldKey === 'string' ? body.fieldKey : null,
    conditions: body.conditions.map(readAutomationCondition),
    actions: body.actions.map(readAutomationAction),
    enabled: body.enabled !== false,
  };
}

function readAutomationCondition(value: unknown): AutomationCondition {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'bad_request', 'Check the conditions.');
  }
  const row = value as { fieldKey?: unknown; op?: unknown; otherField?: unknown; value?: unknown };
  if (typeof row.fieldKey !== 'string' || typeof row.op !== 'string') {
    throw new HttpError(400, 'bad_request', 'Choose a field and how to compare it.');
  }
  return {
    fieldKey: row.fieldKey,
    op: row.op as AutomationCondition['op'],
    otherField: typeof row.otherField === 'string' && row.otherField ? row.otherField : null,
    value: typeof row.value === 'string' ? row.value : null,
  };
}

function readAutomationAction(value: unknown): AutomationAction {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'bad_request', 'Check the actions.');
  }
  const row = value as Record<string, unknown>;
  if (row.kind === 'set_field') {
    return {
      kind: 'set_field',
      fieldKey: typeof row.fieldKey === 'string' ? row.fieldKey : '',
      mode: row.mode === 'formula' ? 'formula' : 'value',
      value: typeof row.value === 'string' ? row.value : null,
      formula: typeof row.formula === 'string' ? row.formula : null,
    };
  }
  if (row.kind === 'notify') {
    return {
      kind: 'notify',
      audience: row.audience === 'user' ? 'user' : 'role',
      roleKey: typeof row.roleKey === 'string' ? row.roleKey : null,
      userId: typeof row.userId === 'string' ? row.userId : null,
      title: typeof row.title === 'string' ? row.title : '',
      body: typeof row.body === 'string' ? row.body : '',
    };
  }
  if (row.kind === 'move_stage') {
    return {
      kind: 'move_stage',
      machineKey: typeof row.machineKey === 'string' ? row.machineKey : '',
      toState: typeof row.toState === 'string' ? row.toState : '',
    };
  }
  throw new HttpError(400, 'bad_request', 'Choose an action.');
}

function operatorActor(operator: {
  id: string;
  requestIp: string | null;
  userAgent: string | null;
}): FieldAdmin {
  return {
    operatorId: operator.id,
    requestIp: operator.requestIp,
    userAgent: operator.userAgent,
  };
}

function groupEntities(definitions: Awaited<ReturnType<typeof listDefinitions>>) {
  const groups = new Map<
    string,
    { key: string; label: string; fromModule: boolean; fields: typeof definitions }
  >();
  for (const type of listEntityTypes()) {
    groups.set(type.key, { key: type.key, label: type.label, fromModule: true, fields: [] });
  }
  for (const field of definitions) {
    const current = groups.get(field.entityType) ?? {
      key: field.entityType,
      label: field.entityLabel,
      fromModule: false,
      fields: [],
    };
    current.fields.push(field);
    groups.set(field.entityType, current);
  }
  return [...groups.values()];
}

export function registerWorkflowRoutes(app: FastifyInstance): void {
  app.get(
    '/krn/workflows/fields',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = await withTenant(session.tenantId, async (tx) => {
        const definitions = await listDefinitions(tx, session.userId);
        return {
          canEdit: false,
          entities: groupEntities(definitions),
          samples: await listSamples(tx),
          actions: listWorkflowActions(),
        };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/krn/workflows/fields',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const draft = readFieldDraft(readBody(request));
      const field = await withTenant(session.tenantId, (tx) =>
        createFieldDefinition(tx, session.actor, draft),
      );
      await reply.code(201).send({ field });
    }),
  );

  app.patch(
    '/krn/workflows/fields/:id',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = readUuid((request.params as { id?: string }).id, 'field');
      const body = readBody(request);
      const field = await withTenant(session.tenantId, (tx) =>
        updateFieldDefinition(tx, session.actor, id, {
          label: typeof body.label === 'string' ? body.label : undefined,
          required: typeof body.required === 'boolean' ? body.required : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          options: body.options === undefined ? undefined : readOptions(body.options),
          minLength:
            body.minLength === undefined
              ? undefined
              : optionalInt(body.minLength, 'the minimum length'),
          maxLength:
            body.maxLength === undefined
              ? undefined
              : optionalInt(body.maxLength, 'the maximum length'),
          minNumber: body.minNumber === undefined ? undefined : optionalText(body.minNumber),
          maxNumber: body.maxNumber === undefined ? undefined : optionalText(body.maxNumber),
          minCents:
            body.minCents === undefined
              ? undefined
              : optionalInt(body.minCents, 'the minimum amount'),
          maxCents:
            body.maxCents === undefined
              ? undefined
              : optionalInt(body.maxCents, 'the maximum amount'),
        }),
      );
      await reply.send({ field });
    }),
  );

  app.post(
    '/krn/workflows/fields/:id/archive',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = readUuid((request.params as { id?: string }).id, 'field');
      await withTenant(session.tenantId, (tx) => archiveFieldDefinition(tx, session.actor, id));
      await reply.send({ archived: true });
    }),
  );

  app.post(
    '/krn/workflows/fields/:id/restore',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = readUuid((request.params as { id?: string }).id, 'field');
      await withTenant(session.tenantId, (tx) => restoreFieldDefinition(tx, session.actor, id));
      await reply.send({ archived: false });
    }),
  );

  app.post(
    '/krn/workflows/fields/reorder',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = readBody(request);
      if (typeof body.entityType !== 'string' || !Array.isArray(body.fieldIds)) {
        throw new HttpError(400, 'bad_request', 'Choose the order of the fields.');
      }
      const fieldIds = body.fieldIds.map((id) => readUuid(id, 'field'));
      await withTenant(session.tenantId, (tx) =>
        reorderFields(tx, session.actor, body.entityType as string, fieldIds),
      );
      await reply.send({ saved: true });
    }),
  );

  app.get(
    '/krn/workflows/values',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const query = request.query as { entityType?: unknown; entityId?: unknown };
      if (
        typeof query.entityType !== 'string' ||
        !/^[a-z][a-z0-9_.]{1,63}$/.test(query.entityType)
      ) {
        throw new HttpError(400, 'bad_request', 'Choose the record.');
      }
      const entityType = query.entityType;
      const entityId = readUuid(query.entityId, 'record');
      const body = await withTenant(session.tenantId, async (tx) => {
        const fields = (await listDefinitions(tx, session.userId)).filter(
          (field) => field.entityType === entityType && !field.archived,
        );
        const stored = await loadFieldValues(tx, entityType, entityId);
        const values = await mergeCalculated(tx, entityType, entityId, stored);
        return {
          fields,
          values,
          canEdit: await canEditFields(tx, session.userId),
        };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/krn/workflows/values',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = readBody(request);
      if (typeof body.entityType !== 'string' || typeof body.entityId !== 'string') {
        throw new HttpError(400, 'bad_request', 'Choose the record.');
      }
      const entityId = readUuid(body.entityId, 'record');
      const values =
        body.values && typeof body.values === 'object' && !Array.isArray(body.values)
          ? (body.values as Record<string, unknown>)
          : null;
      if (!values) {
        throw new HttpError(400, 'bad_request', 'Send the field values.');
      }
      const saved = await withTenant(session.tenantId, (tx) =>
        saveCustomFields(tx, session.actor, {
          entityType: body.entityType as string,
          entityId,
          values,
        }),
      );
      await reply.send({ values: saved });
    }),
  );

  app.get(
    '/krn/workflows/pipelines',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = await withTenant(session.tenantId, async (tx) => ({
        canEdit: await canEditFields(tx, session.userId),
        pipelines: await listPipelines(tx, session.userId),
        rules: await listRules(tx, session.userId),
        actions: listWorkflowActions(),
        machines: listEntityTypes().map((type) => ({ key: type.key, label: type.label })),
      }));
      await reply.send(body);
    }),
  );

  app.post(
    '/krn/workflows/pipelines',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = readBody(request);
      if (typeof body.machineKey !== 'string') {
        throw new HttpError(400, 'bad_request', 'Choose a pipeline.');
      }
      const pipeline = await withTenant(session.tenantId, (tx) =>
        installMachine(tx, session.actor, body.machineKey as string),
      );
      await reply.code(201).send({ pipeline });
    }),
  );

  app.patch(
    '/krn/workflows/pipelines/:id',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = readUuid((request.params as { id?: string }).id, 'pipeline');
      const body = readBody(request);
      if (body.baseStates !== undefined || body.baseTransitions !== undefined) {
        throw new HttpError(
          400,
          'bad_request',
          'Stages that came with the module stay on the pipeline.',
        );
      }
      if (!Array.isArray(body.extraStates) || !Array.isArray(body.extraTransitions)) {
        throw new HttpError(400, 'bad_request', 'Send the stages your company added.');
      }
      const pipeline = await withTenant(session.tenantId, (tx) =>
        updatePipelineExtras(tx, session.actor, id, {
          label: typeof body.label === 'string' ? body.label : undefined,
          extraStates: body.extraStates,
          extraTransitions: body.extraTransitions,
        }),
      );
      await reply.send({ pipeline });
    }),
  );

  app.post(
    '/krn/workflows/pipelines/:id/archive',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = readUuid((request.params as { id?: string }).id, 'pipeline');
      await withTenant(session.tenantId, (tx) => archivePipeline(tx, session.actor, id));
      await reply.send({ archived: true });
    }),
  );

  app.post(
    '/krn/workflows/move',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = readBody(request);
      if (
        typeof body.machineKey !== 'string' ||
        typeof body.entityId !== 'string' ||
        typeof body.transitionKey !== 'string'
      ) {
        throw new HttpError(400, 'bad_request', 'Choose the move.');
      }
      const result = await withTenant(session.tenantId, (tx) =>
        moveRecord(tx, session.actor, {
          machineKey: body.machineKey as string,
          entityId: readUuid(body.entityId, 'record'),
          transitionKey: body.transitionKey as string,
        }),
      );
      await reply.send(result);
    }),
  );

  app.post(
    '/krn/workflows/rules',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const draft = readRule(readBody(request));
      const rule = await withTenant(session.tenantId, (tx) => createRule(tx, session.actor, draft));
      await reply.code(201).send({ rule });
    }),
  );

  app.patch(
    '/krn/workflows/rules/:id',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = readUuid((request.params as { id?: string }).id, 'alert');
      const rule = await withTenant(session.tenantId, (tx) =>
        updateRule(tx, session.actor, id, readRule(readBody(request))),
      );
      await reply.send({ rule });
    }),
  );

  app.post(
    '/krn/workflows/rules/:id/archive',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = readUuid((request.params as { id?: string }).id, 'alert');
      await withTenant(session.tenantId, (tx) => archiveRule(tx, session.actor, id));
      await reply.send({ archived: true });
    }),
  );

  app.get(
    '/krn/workflows/notifications',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = await withTenant(session.tenantId, (tx) =>
        listNotifications(tx, session.userId),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/krn/workflows/notifications/read',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = readBody(request);
      await withTenant(session.tenantId, async (tx) => {
        if (body.all === true) {
          await markAllNotificationsRead(tx, session.actor);
          return;
        }
        await markNotificationRead(tx, session.actor, readUuid(body.id, 'alert'));
      });
      await reply.send({ read: true });
    }),
  );

  app.get(
    '/control/tenants/:tenantId/fields',
    route(async (request, reply) => {
      await requireOperator(request, 'tenants.read');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = await withTenant(tenantId(id), async (tx) => {
        const definitions = await listDefinitionsForOperator(tx);
        const entities = [];
        for (const entity of groupEntities(definitions)) {
          entities.push({
            ...entity,
            inputs: await numericFieldList(tx, entity.key),
          });
        }
        return { entities };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/control/tenants/:tenantId/fields',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const draft = readFieldDraft(readBody(request));
      const field = await withTenant(tenantId(id), (tx) =>
        createFieldDefinition(tx, operatorActor(operator), draft),
      );
      await reply.code(201).send({ field });
    }),
  );

  app.patch(
    '/control/tenants/:tenantId/fields/:id',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; id?: string };
      const companyId = readUuid(params.tenantId, 'company');
      const fieldId = readUuid(params.id, 'field');
      const body = readBody(request);
      const field = await withTenant(tenantId(companyId), (tx) =>
        updateFieldDefinition(tx, operatorActor(operator), fieldId, {
          label: typeof body.label === 'string' ? body.label : undefined,
          required: typeof body.required === 'boolean' ? body.required : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          options: body.options === undefined ? undefined : readOptions(body.options),
          formula:
            body.formula === undefined
              ? undefined
              : typeof body.formula === 'string'
                ? body.formula
                : null,
          formulaPlaces:
            body.formulaPlaces === undefined
              ? undefined
              : optionalInt(body.formulaPlaces, 'the rounding'),
          formulaDisplay:
            body.formulaDisplay === undefined
              ? undefined
              : body.formulaDisplay === 'money' || body.formulaDisplay === 'number'
                ? body.formulaDisplay
                : null,
          formulaUnit:
            body.formulaUnit === undefined
              ? undefined
              : typeof body.formulaUnit === 'string'
                ? body.formulaUnit
                : '',
        }),
      );
      await reply.send({ field });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/fields/:id/archive',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; id?: string };
      const companyId = readUuid(params.tenantId, 'company');
      const fieldId = readUuid(params.id, 'field');
      await withTenant(tenantId(companyId), (tx) =>
        archiveFieldDefinition(tx, operatorActor(operator), fieldId),
      );
      await reply.send({ archived: true });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/fields/:id/restore',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; id?: string };
      const companyId = readUuid(params.tenantId, 'company');
      const fieldId = readUuid(params.id, 'field');
      await withTenant(tenantId(companyId), (tx) =>
        restoreFieldDefinition(tx, operatorActor(operator), fieldId),
      );
      await reply.send({ archived: false });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/fields/reorder',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const companyId = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = readBody(request);
      if (typeof body.entityType !== 'string' || !Array.isArray(body.fieldIds)) {
        throw new HttpError(400, 'bad_request', 'Choose the order of the fields.');
      }
      const fieldIds = body.fieldIds.map((item) => readUuid(item, 'field'));
      await withTenant(tenantId(companyId), (tx) =>
        reorderFields(tx, operatorActor(operator), body.entityType as string, fieldIds),
      );
      await reply.send({ saved: true });
    }),
  );

  app.get(
    '/control/tenants/:tenantId/automations',
    route(async (request, reply) => {
      await requireOperator(request, 'tenants.read');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = await withTenant(tenantId(id), async (tx) => {
        const definitions = await listDefinitionsForOperator(tx);
        const entities = [];
        for (const entity of groupEntities(definitions)) {
          const registered = getEntityType(entity.key);
          entities.push({
            key: entity.key,
            label: entity.label,
            inputs: await numericFieldList(tx, entity.key),
            description: registered?.description ?? '',
          });
        }
        return {
          entities,
          rules: await listAutomations(tx),
          people: await listAutomationPeople(tx),
          stages: await listAutomationStages(tx),
        };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/control/tenants/:tenantId/automations',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const draft = readAutomation(readBody(request));
      const rule = await withTenant(tenantId(id), (tx) =>
        createAutomation(tx, operatorActor(operator), draft),
      );
      await reply.code(201).send({ rule });
    }),
  );

  app.patch(
    '/control/tenants/:tenantId/automations/:id',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; id?: string };
      const companyId = readUuid(params.tenantId, 'company');
      const ruleId = readUuid(params.id, 'automation');
      const draft = readAutomation(readBody(request));
      const rule = await withTenant(tenantId(companyId), (tx) =>
        updateAutomation(tx, operatorActor(operator), ruleId, draft),
      );
      await reply.send({ rule });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/automations/:id/archive',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; id?: string };
      const companyId = readUuid(params.tenantId, 'company');
      const ruleId = readUuid(params.id, 'automation');
      await withTenant(tenantId(companyId), (tx) =>
        archiveAutomation(tx, operatorActor(operator), ruleId),
      );
      await reply.send({ archived: true });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/automations/reorder',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const companyId = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = readBody(request);
      if (!Array.isArray(body.ids)) {
        throw new HttpError(400, 'bad_request', 'Choose the order of the automations.');
      }
      const ids = body.ids.map((item) => readUuid(item, 'automation'));
      await withTenant(tenantId(companyId), (tx) =>
        reorderAutomations(tx, operatorActor(operator), ids),
      );
      await reply.send({ saved: true });
    }),
  );

  app.get(
    '/control/tenants/:tenantId/workflows',
    route(async (request, reply) => {
      await requireOperator(request);
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const summary = await withTenant(tenantId(id), (tx) => workflowSummary(tx));
      await reply.send(summary);
    }),
  );
}
