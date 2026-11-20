import {
  ACCESS_ROLES,
  plainRoleName,
  type CustomFieldDefinition,
  type CustomFieldValue,
} from '@omnivate/shared';
import {
  Badge,
  Button,
  Card,
  CustomFieldsForm,
  DialogFrame,
  EmptyState,
  Form,
  PageHeader,
  SelectField,
  Skeleton,
  Switch,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';

type Stage = { key: string; label: string; kind: string; origin: 'base' | 'company' };
type Move = {
  key: string;
  from: string;
  to: string;
  label: string;
  origin: 'base' | 'company';
  makerChecker: boolean;
};
type RecordRow = {
  entityId: string;
  stateKey: string;
  stateLabel: string;
  history: { label: string; from: string; to: string }[];
};
type Pipeline = {
  id: string;
  machineKey: string;
  entityType: string;
  entityLabel: string;
  label: string;
  archived: boolean;
  states: Stage[];
  transitions: Move[];
  records: RecordRow[];
};
type Rule = {
  id: string;
  name: string;
  entityType: string;
  triggerKind: 'event' | 'transition';
  eventKey: string | null;
  machineKey: string | null;
  transitionKey: string | null;
  conditions: unknown[];
  actionKind: string;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
  archived: boolean;
  summary: string;
};

const emptyAlert = {
  id: '',
  name: '',
  pipelineId: '',
  transitionKey: '',
  whenSaved: false,
  title: '',
  body: '',
  roleKey: 'tenant_owner',
  action: 'notify' as 'notify' | 'audit',
};

export function PipelinesScreen() {
  const notify = useToast();
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [problem, setProblem] = useState('');
  const [stageOpen, setStageOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [stage, setStage] = useState({ pipelineId: '', name: '', from: '' });
  const [alert, setAlert] = useState(emptyAlert);
  const [fieldGroups, setFieldGroups] = useState<
    { key: string; fields: CustomFieldDefinition[] }[]
  >([]);
  const [samples, setSamples] = useState<
    { entityType: string; entityId: string; values: Record<string, CustomFieldValue> }[]
  >([]);

  async function load() {
    const { status, body } = await api('/krn/workflows/pipelines');
    if (status === 401) {
      setProblem('Sign in to see approvals.');
      setPipelines([]);
      return;
    }
    if (status === 403) {
      setProblem('Owners, managers, and accountants can open approvals.');
      setPipelines([]);
      return;
    }
    if (status !== 200 || !body || typeof body !== 'object') {
      setProblem(errorMessage(body, 'Approvals could not be loaded.'));
      setPipelines([]);
      return;
    }
    const payload = body as { canEdit: boolean; pipelines: Pipeline[]; rules: Rule[] };
    setCanEdit(payload.canEdit);
    setPipelines(payload.pipelines);
    setRules(payload.rules);
    setProblem('');
    const fields = await api('/krn/workflows/fields');
    if (
      fields.status === 200 &&
      fields.body &&
      typeof fields.body === 'object' &&
      'entities' in fields.body
    ) {
      const payloadFields = fields.body as {
        entities: { key: string; fields: CustomFieldDefinition[] }[];
        samples: {
          entityType: string;
          entityId: string;
          values: Record<string, CustomFieldValue>;
        }[];
      };
      setFieldGroups(payloadFields.entities);
      setSamples(payloadFields.samples ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function move(pipeline: Pipeline, record: RecordRow, transitionKey: string) {
    const { status, body } = await api('/krn/workflows/move', {
      method: 'POST',
      body: JSON.stringify({
        machineKey: pipeline.machineKey,
        entityId: record.entityId,
        transitionKey,
      }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'That move was not made.'), tone: 'bad' });
      return;
    }
    notify({ title: 'Record moved.' });
    await load();
  }

  function openStage(pipeline: Pipeline) {
    setStage({
      pipelineId: pipeline.id,
      name: '',
      from: pipeline.states[0]?.key ?? '',
    });
    setStageOpen(true);
  }

  async function addStage(pipeline: Pipeline) {
    const key = stage.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    const extraStates = pipeline.states
      .filter((item) => item.origin === 'company')
      .map((item) => ({ key: item.key, label: item.label, kind: item.kind }));
    extraStates.push({ key, label: stage.name.trim(), kind: 'open' });
    const extraTransitions = pipeline.transitions
      .filter((item) => item.origin === 'company')
      .map((item) => ({
        key: item.key,
        from: item.from,
        to: item.to,
        label: item.label,
        permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
      }));
    extraTransitions.push({
      key: `to_${key}`.slice(0, 40),
      from: stage.from,
      to: key,
      label: `Move to ${stage.name.trim()}`,
      permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
    });
    const { status, body } = await api(`/krn/workflows/pipelines/${pipeline.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ extraStates, extraTransitions }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'That stage was not added.'), tone: 'bad' });
      return;
    }
    setStageOpen(false);
    notify({ title: 'Stage added. The original stages stay.' });
    await load();
  }

  function openNewAlert(pipeline: Pipeline) {
    setAlert({ ...emptyAlert, pipelineId: pipeline.id });
    setAlertOpen(true);
  }

  function openEditAlert(rule: Rule, pipeline: Pipeline) {
    const config = rule.actionConfig;
    setAlert({
      id: rule.id,
      name: rule.name,
      pipelineId: pipeline.id,
      transitionKey: rule.transitionKey ?? '',
      whenSaved: rule.triggerKind === 'event',
      title: typeof config.title === 'string' ? config.title : '',
      body:
        typeof config.body === 'string'
          ? config.body
          : typeof config.message === 'string'
            ? config.message
            : '',
      roleKey: typeof config.roleKey === 'string' ? config.roleKey : 'tenant_owner',
      action: rule.actionKind === 'audit' ? 'audit' : 'notify',
    });
    setAlertOpen(true);
  }

  async function saveAlert(pipeline: Pipeline) {
    const payload = {
      name: alert.name,
      entityType: pipeline.entityType,
      triggerKind: alert.whenSaved ? 'event' : 'transition',
      eventKey: alert.whenSaved ? 'fields.saved' : null,
      machineKey: alert.whenSaved ? null : pipeline.machineKey,
      transitionKey: alert.whenSaved ? null : alert.transitionKey,
      conditions: [],
      actionKind: alert.action,
      actionConfig:
        alert.action === 'notify'
          ? {
              title: alert.title || alert.name,
              body: alert.body,
              audience: 'role',
              roleKey: alert.roleKey,
            }
          : { message: alert.body },
      enabled: true,
    };
    const path = alert.id ? `/krn/workflows/rules/${alert.id}` : '/krn/workflows/rules';
    const { status, body } = await api(path, {
      method: alert.id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'That alert was not saved.'), tone: 'bad' });
      return;
    }
    setAlertOpen(false);
    notify({ title: 'Alert saved.' });
    await load();
  }

  async function setEnabled(rule: Rule, enabled: boolean) {
    const { status, body } = await api(`/krn/workflows/rules/${rule.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: rule.name,
        entityType: rule.entityType,
        triggerKind: rule.triggerKind,
        eventKey: rule.eventKey,
        machineKey: rule.machineKey,
        transitionKey: rule.transitionKey,
        conditions: rule.conditions,
        actionKind: rule.actionKind,
        actionConfig: rule.actionConfig,
        enabled,
      }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'That alert was not updated.'), tone: 'bad' });
      return;
    }
    await load();
  }

  if (!pipelines) {
    return <Skeleton lines={6} />;
  }

  const stagePipeline = pipelines.find((item) => item.id === stage.pipelineId) ?? pipelines[0];
  const alertPipeline = pipelines.find((item) => item.id === alert.pipelineId) ?? pipelines[0];
  const visibleRules = rules.filter((rule) => !rule.archived);
  const firstPipeline = pipelines[0];

  return (
    <>
      <PageHeader
        title="Approvals"
        description="The stages a record moves through, and the alerts that follow."
      />
      {problem ? (
        <Card>
          <EmptyState title="Approvals" body={problem} />
        </Card>
      ) : null}
      {pipelines.length === 0 && !problem ? (
        <Card>
          <EmptyState
            title="No stages yet"
            body="Stages show up here when a part of Omnivate uses them. You can add more."
          />
        </Card>
      ) : null}
      {pipelines.map((pipeline) => (
        <Card key={pipeline.id} title={showLabel(pipeline.label)}>
          <p className="ui-hint">{showLabel(pipeline.entityLabel)}</p>
          <div className="ui-flow">
            {pipeline.states.map((item, index) => (
              <span className="ui-flow-step" key={item.key}>
                {index > 0 ? (
                  <span className="ui-flow-arrow" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <Badge tone={item.origin === 'company' ? 'warn' : 'neutral'}>
                  {showLabel(item.label)}
                </Badge>
              </span>
            ))}
          </div>
          <ul className="ui-move-list">
            {pipeline.transitions.map((item) => (
              <li key={item.key}>{moveSentence(pipeline, item)}</li>
            ))}
          </ul>
          {pipeline.records.map((record) => (
            <div key={record.entityId}>
              <p>
                Sample record is <strong>{record.stateLabel}</strong>.
              </p>
              <RecordFields
                fields={
                  fieldGroups.find((group) => group.key === pipeline.entityType)?.fields ?? []
                }
                values={
                  samples.find(
                    (sample) =>
                      sample.entityType === pipeline.entityType &&
                      sample.entityId === record.entityId,
                  )?.values ?? {}
                }
                disabled={!canEdit}
                onSave={async (values) => {
                  const saved = await api('/krn/workflows/values', {
                    method: 'POST',
                    body: JSON.stringify({
                      entityType: pipeline.entityType,
                      entityId: record.entityId,
                      values,
                    }),
                  });
                  if (saved.status >= 400) {
                    notify({
                      title: errorMessage(saved.body, 'Those details were not saved.'),
                      tone: 'bad',
                    });
                    return;
                  }
                  notify({ title: 'Details saved.' });
                  await load();
                }}
              />
              {canEdit ? (
                <div className="ui-stage-row">
                  {pipeline.transitions
                    .filter((item) => item.from === record.stateKey)
                    .map((item) => (
                      <Button
                        key={item.key}
                        variant="secondary"
                        onClick={() => void move(pipeline, record, item.key)}
                      >
                        {showLabel(item.label)}
                      </Button>
                    ))}
                </div>
              ) : null}
            </div>
          ))}
          {canEdit ? (
            <Button variant="secondary" onClick={() => openStage(pipeline)}>
              Add Stage
            </Button>
          ) : null}
        </Card>
      ))}
      <Card title="Alerts">
        <p className="ui-hint">Alerts stay in the app. Nothing is emailed or sent to WhatsApp.</p>
        {visibleRules.length === 0 ? <p>No alerts yet.</p> : null}
        {visibleRules.map((rule) => {
          const pipeline =
            pipelines.find((item) => item.machineKey === rule.machineKey) ?? pipelines[0];
          return (
            <div className="ui-field-line" key={rule.id}>
              <div>
                <strong>{rule.name}</strong>
                <p className="ui-hint">{plainSummary(rule)}</p>
              </div>
              {canEdit ? (
                <span className="ui-icon-row">
                  <Switch
                    label={`${rule.name} is ${rule.enabled ? 'on' : 'off'}`}
                    checked={rule.enabled}
                    onChange={(checked) => void setEnabled(rule, checked)}
                  />
                  {pipeline ? (
                    <Button variant="ghost" onClick={() => openEditAlert(rule, pipeline)}>
                      Edit
                    </Button>
                  ) : null}
                </span>
              ) : (
                <Badge tone={rule.enabled ? 'ok' : 'neutral'}>{rule.enabled ? 'On' : 'Off'}</Badge>
              )}
            </div>
          );
        })}
        {canEdit && firstPipeline ? (
          <div className="ui-fit">
            <Button variant="secondary" onClick={() => openNewAlert(firstPipeline)}>
              Add Alert
            </Button>
          </div>
        ) : null}
      </Card>
      <DialogFrame
        open={stageOpen}
        onOpenChange={setStageOpen}
        title="Add A Stage"
        description="The stages that came with Omnivate stay. This adds one of yours."
      >
        {stagePipeline ? (
          <Form
            onSubmit={() => {
              void addStage(stagePipeline);
            }}
          >
            <TextField
              label="Stage Name"
              value={stage.name}
              onChange={(value) => setStage((current) => ({ ...current, name: value }))}
            />
            <SelectField
              label="Move Here From"
              value={stage.from}
              onChange={(value) => setStage((current) => ({ ...current, from: value }))}
            >
              {stagePipeline.states.map((item) => (
                <option key={item.key} value={item.key}>
                  {showLabel(item.label)}
                </option>
              ))}
            </SelectField>
            <div className="ui-form-submit">
              <Button type="submit">Add Stage</Button>
            </div>
          </Form>
        ) : null}
      </DialogFrame>
      <DialogFrame
        open={alertOpen}
        onOpenChange={setAlertOpen}
        title={alert.id ? 'Edit Alert' : 'Add An Alert'}
        description="Choose when it runs, and whether people see it or it is only written to the log."
      >
        {alertPipeline ? (
          <Form
            onSubmit={() => {
              void saveAlert(alertPipeline);
            }}
          >
            <TextField
              label="Alert Name"
              value={alert.name}
              onChange={(value) => setAlert((current) => ({ ...current, name: value }))}
            />
            <label className="ui-check">
              <input
                type="checkbox"
                checked={alert.whenSaved}
                onChange={(event) =>
                  setAlert((current) => ({ ...current, whenSaved: event.target.checked }))
                }
              />
              <span>Run When The Details Are Saved</span>
            </label>
            {alert.whenSaved ? null : (
              <SelectField
                label="When This Move Happens"
                value={alert.transitionKey}
                onChange={(value) => setAlert((current) => ({ ...current, transitionKey: value }))}
              >
                <option value="">Choose A Move</option>
                {alertPipeline.transitions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {showLabel(item.label)}
                  </option>
                ))}
              </SelectField>
            )}
            <SelectField
              label="Then"
              value={alert.action}
              onChange={(value) =>
                setAlert((current) => ({ ...current, action: value as 'notify' | 'audit' }))
              }
            >
              <option value="notify">Show An In-App Alert</option>
              <option value="audit">Write A Log Entry</option>
            </SelectField>
            {alert.action === 'notify' ? (
              <SelectField
                label="Who Sees It"
                value={alert.roleKey}
                onChange={(value) => setAlert((current) => ({ ...current, roleKey: value }))}
              >
                {ACCESS_ROLES.map((role) => (
                  <option key={role.key} value={role.key}>
                    {plainRoleName(role)}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <TextField
              label={alert.action === 'notify' ? 'Message' : 'Log Message'}
              value={alert.body}
              onChange={(value) => setAlert((current) => ({ ...current, body: value }))}
            />
            <div className="ui-form-submit">
              <Button type="submit">Save Alert</Button>
            </div>
          </Form>
        ) : null}
      </DialogFrame>
    </>
  );
}

function RecordFields({
  fields,
  values,
  disabled,
  onSave,
}: {
  fields: CustomFieldDefinition[];
  values: Record<string, CustomFieldValue>;
  disabled: boolean;
  onSave: (values: Record<string, CustomFieldValue | null>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, CustomFieldValue | null | undefined>>(values);
  const stamp = JSON.stringify(values);
  useEffect(() => {
    setDraft(values);
  }, [stamp, values]);
  const active = fields.filter((field) => !field.archived);
  if (active.length === 0) {
    return null;
  }
  return (
    <Form
      onSubmit={() => {
        const payload: Record<string, CustomFieldValue | null> = {};
        for (const field of active) {
          if (field.fieldType === 'calculated') {
            continue;
          }
          payload[field.fieldKey] = draft[field.fieldKey] ?? null;
        }
        void onSave(payload);
      }}
    >
      <CustomFieldsForm
        fields={fields}
        values={draft}
        disabled={disabled}
        onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
      />
      {disabled ? null : (
        <div className="ui-fit">
          <Button type="submit">Save Details</Button>
        </div>
      )}
    </Form>
  );
}

function showLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('.')) {
    return 'That Stage';
  }
  return trimmed.replace(/_/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function labelOf(pipeline: Pipeline, key: string): string {
  const found = pipeline.states.find((item) => item.key === key)?.label;
  return found ? showLabel(found) : 'That Stage';
}

function moveSentence(pipeline: Pipeline, move: Move): string {
  const from = labelOf(pipeline, move.from);
  const to = labelOf(pipeline, move.to);
  const checker = move.makerChecker ? ' Someone else must approve.' : '';
  return `From ${from} to ${to}.${checker}`;
}

function plainSummary(rule: Rule): string {
  const when =
    rule.triggerKind === 'event'
      ? 'When the extra details are saved'
      : `When someone uses ${rule.transitionKey?.replaceAll('_', ' ') ?? 'a move'}`;
  const then = rule.actionKind === 'notify' ? 'show an in-app alert' : 'write a log entry';
  const conditions = rule.conditions.length > 0 ? ', if the conditions match' : '';
  return `${when}${conditions}, ${then}.`;
}
