import { ACCESS_ROLES, plainRoleName } from '@omnivate/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Form,
  SelectField,
  Skeleton,
  Switch,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';
import { FormulaEditor, type FormulaInput } from './FormulaEditor';

type Condition = {
  fieldKey: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  otherField: string | null;
  value: string | null;
};

type Action =
  | {
      kind: 'set_field';
      fieldKey: string;
      mode: 'value' | 'formula';
      value: string | null;
      formula: string | null;
    }
  | {
      kind: 'notify';
      audience: 'role' | 'user';
      roleKey: string | null;
      userId: string | null;
      title: string;
      body: string;
    }
  | { kind: 'move_stage'; machineKey: string; toState: string };

type Run = { id: string; status: string; summary: string; occurredAt: string };

type Rule = {
  id: string;
  name: string;
  entityType: string;
  triggerKind: 'created' | 'field_changed';
  fieldKey: string | null;
  conditions: Condition[];
  actions: Action[];
  enabled: boolean;
  archived: boolean;
  summary: string;
  runs: Run[];
};

type Stage = {
  machineKey: string;
  entityType: string;
  label: string;
  states: { key: string; label: string }[];
};

type Payload = {
  entities: { key: string; label: string; inputs: FormulaInput[] }[];
  rules: Rule[];
  people: { id: string; name: string; email: string }[];
  stages: Stage[];
};

const emptyCondition = (): Condition => ({
  fieldKey: '',
  op: 'lt',
  otherField: null,
  value: '',
});

const emptyAction = (): Action => ({
  kind: 'notify',
  audience: 'role',
  roleKey: 'branch_manager',
  userId: null,
  title: '',
  body: '',
});

export function AutomationsPanel({ tenantId }: { tenantId: string }) {
  const notify = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [problem, setProblem] = useState('');

  async function load() {
    const { status, body } = await api(`/control/tenants/${tenantId}/automations`);
    if (status !== 200 || !body || typeof body !== 'object' || !('rules' in body)) {
      setProblem(errorMessage(body, 'Automations could not be loaded.'));
      setData({ entities: [], rules: [], people: [], stages: [] });
      return;
    }
    setData(body as Payload);
    setProblem('');
  }

  useEffect(() => {
    void load();
  }, [tenantId]);

  async function reorder(ids: string[]) {
    const { status, body } = await api(`/control/tenants/${tenantId}/automations/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The order was not saved.'), tone: 'bad' });
      return;
    }
    await load();
  }

  if (!data) {
    return <Skeleton lines={5} />;
  }
  if (problem) {
    return (
      <Card title="Automations">
        <p>{problem}</p>
      </Card>
    );
  }

  const active = data.rules.filter((rule) => !rule.archived);

  return (
    <div className="ui-stack">
      <p className="ui-hint">
        When a record is created or a field changes, and the conditions match, Omnivate runs the
        actions in order. A chain stops after 5 steps.
      </p>
      {active.length === 0 ? (
        <Card>
          <EmptyState
            title="No Automations Yet"
            body="Add one below. It stays off until you turn it on."
          />
        </Card>
      ) : null}
      {active.map((rule, index) => (
        <RuleCard
          key={rule.id}
          tenantId={tenantId}
          rule={rule}
          data={data}
          canUp={index > 0}
          canDown={index < active.length - 1}
          onSaved={load}
          onUp={() => {
            const ids = active.map((item) => item.id);
            const swap = ids[index - 1];
            const current = ids[index];
            if (!swap || !current) return;
            ids[index - 1] = current;
            ids[index] = swap;
            void reorder(ids);
          }}
          onDown={() => {
            const ids = active.map((item) => item.id);
            const swap = ids[index + 1];
            const current = ids[index];
            if (!swap || !current) return;
            ids[index + 1] = current;
            ids[index] = swap;
            void reorder(ids);
          }}
        />
      ))}
      <Card title="Add An Automation">
        <RuleForm
          data={data}
          initial={{
            name: '',
            entityType: data.entities[0]?.key ?? '',
            triggerKind: 'field_changed',
            fieldKey: data.entities[0]?.inputs[0]?.key ?? '',
            conditions: [emptyCondition()],
            actions: [emptyAction()],
            enabled: true,
          }}
          submitLabel="Add Automation"
          onSubmit={async (draft) => {
            const { status, body } = await api(`/control/tenants/${tenantId}/automations`, {
              method: 'POST',
              body: JSON.stringify(draft),
            });
            if (status >= 400) {
              notify({ title: errorMessage(body, 'The automation was not added.'), tone: 'bad' });
              return false;
            }
            notify({ title: 'Automation added.' });
            await load();
            return true;
          }}
        />
      </Card>
    </div>
  );
}

function RuleCard({
  tenantId,
  rule,
  data,
  canUp,
  canDown,
  onSaved,
  onUp,
  onDown,
}: {
  tenantId: string;
  rule: Rule;
  data: Payload;
  canUp: boolean;
  canDown: boolean;
  onSaved: () => Promise<void>;
  onUp: () => void;
  onDown: () => void;
}) {
  const notify = useToast();
  return (
    <Card title={rule.name}>
      <RuleForm
        data={data}
        initial={rule}
        submitLabel="Save Automation"
        onSubmit={async (draft) => {
          const saved = await api(`/control/tenants/${tenantId}/automations/${rule.id}`, {
            method: 'PATCH',
            body: JSON.stringify(draft),
          });
          if (saved.status >= 400) {
            notify({
              title: errorMessage(saved.body, 'The automation was not saved.'),
              tone: 'bad',
            });
            return false;
          }
          notify({ title: 'Automation saved.' });
          await onSaved();
          return true;
        }}
      />
      <div className="ui-actions">
        <Button variant="secondary" disabled={!canUp} onClick={onUp}>
          Move Up
        </Button>
        <Button variant="secondary" disabled={!canDown} onClick={onDown}>
          Move Down
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void api(`/control/tenants/${tenantId}/automations/${rule.id}/archive`, {
              method: 'POST',
              body: '{}',
            }).then(({ status, body }) => {
              if (status >= 400) {
                notify({
                  title: errorMessage(body, 'That automation was not archived.'),
                  tone: 'bad',
                });
                return;
              }
              void onSaved();
            });
          }}
        >
          Archive
        </Button>
      </div>
      <h3>Last 20 Runs</h3>
      {rule.runs.length === 0 ? <p className="ui-hint">This automation has not run yet.</p> : null}
      <ul className="run-log">
        {rule.runs.map((run) => (
          <li key={run.id}>
            <Badge
              tone={run.status === 'ran' ? 'ok' : run.status === 'stopped' ? 'bad' : 'neutral'}
            >
              {run.status === 'ran' ? 'Ran' : run.status === 'stopped' ? 'Stopped' : 'Skipped'}
            </Badge>
            <span>{run.summary}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RuleForm({
  data,
  initial,
  submitLabel,
  onSubmit,
}: {
  data: Payload;
  initial: Omit<Rule, 'id' | 'archived' | 'summary' | 'runs'>;
  submitLabel: string;
  onSubmit: (draft: Omit<Rule, 'id' | 'archived' | 'summary' | 'runs'>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initial);
  const entity = data.entities.find((item) => item.key === draft.entityType) ?? data.entities[0];
  const inputs = entity?.inputs ?? [];
  const stages = data.stages.filter((stage) => stage.entityType === (entity?.key ?? ''));

  function setTrigger(value: string) {
    if (value === 'created') {
      setDraft((current) => ({ ...current, triggerKind: 'created', fieldKey: null }));
      return;
    }
    setDraft((current) => ({ ...current, triggerKind: 'field_changed', fieldKey: value }));
  }

  return (
    <Form
      onSubmit={() => {
        void onSubmit(draft);
      }}
    >
      <TextField
        label="Name"
        value={draft.name}
        onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
      />
      <div className="sentence-line">
        <SelectField
          label="When"
          value={draft.entityType}
          onChange={(value) => setDraft((current) => ({ ...current, entityType: value }))}
        >
          {data.entities.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Happens"
          value={draft.triggerKind === 'created' ? 'created' : (draft.fieldKey ?? '')}
          onChange={setTrigger}
        >
          <option value="created">Is Created</option>
          {inputs.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label} Changes
            </option>
          ))}
        </SelectField>
      </div>
      {draft.conditions.map((condition, index) => (
        <div className="sentence-line" key={index}>
          <SelectField
            label={index === 0 ? 'And' : 'And'}
            value={condition.fieldKey}
            onChange={(value) => updateCondition(index, { fieldKey: value })}
          >
            <option value="">Choose A Field</option>
            {inputs.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Compare"
            value={condition.op}
            onChange={(value) => updateCondition(index, { op: value as Condition['op'] })}
          >
            <option value="eq">Is</option>
            <option value="neq">Is Not</option>
            <option value="gt">Is Greater Than</option>
            <option value="gte">Is At Least</option>
            <option value="lt">Is Less Than</option>
            <option value="lte">Is At Most</option>
          </SelectField>
          <SelectField
            label="Than"
            value={condition.otherField ?? 'value'}
            onChange={(value) =>
              updateCondition(
                index,
                value === 'value'
                  ? { otherField: null, value: condition.value ?? '' }
                  : { otherField: value, value: null },
              )
            }
          >
            <option value="value">A Number</option>
            {inputs.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </SelectField>
          {condition.otherField ? null : (
            <TextField
              label="Number"
              value={condition.value ?? ''}
              onChange={(value) => updateCondition(index, { value })}
            />
          )}
          <Button
            variant="ghost"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                conditions: current.conditions.filter((_, item) => item !== index),
              }))
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        onClick={() =>
          setDraft((current) => ({
            ...current,
            conditions: [...current.conditions, emptyCondition()],
          }))
        }
      >
        Add Condition
      </Button>
      {draft.actions.map((action, index) => (
        <ActionEditor
          key={index}
          action={action}
          inputs={inputs}
          stages={stages}
          people={data.people}
          onChange={(next) =>
            setDraft((current) => ({
              ...current,
              actions: current.actions.map((item, itemIndex) =>
                itemIndex === index ? next : item,
              ),
            }))
          }
          onRemove={() =>
            setDraft((current) => ({
              ...current,
              actions: current.actions.filter((_, item) => item !== index),
            }))
          }
        />
      ))}
      <Button
        variant="secondary"
        onClick={() =>
          setDraft((current) => ({ ...current, actions: [...current.actions, emptyAction()] }))
        }
      >
        Add Action
      </Button>
      <div className="turn-on">
        <span>Turn On</span>
        <Switch
          label="Turn On"
          checked={draft.enabled}
          onChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
        />
      </div>
      <Button type="submit">{submitLabel}</Button>
    </Form>
  );

  function updateCondition(index: number, patch: Partial<Condition>) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }
}

function ActionEditor({
  action,
  inputs,
  stages,
  people,
  onChange,
  onRemove,
}: {
  action: Action;
  inputs: FormulaInput[];
  stages: Stage[];
  people: { id: string; name: string }[];
  onChange: (action: Action) => void;
  onRemove: () => void;
}) {
  const settable = inputs.filter((field) => field.kind === 'number' || field.kind === 'money');
  return (
    <div className="sentence-builder">
      <div className="sentence-line">
        <SelectField
          label="Then"
          value={action.kind}
          onChange={(value) => {
            if (value === 'set_field') {
              onChange({
                kind: 'set_field',
                fieldKey: settable[0]?.key ?? '',
                mode: 'value',
                value: '',
                formula: null,
              });
            } else if (value === 'move_stage') {
              onChange({
                kind: 'move_stage',
                machineKey: stages[0]?.machineKey ?? '',
                toState: stages[0]?.states[0]?.key ?? '',
              });
            } else {
              onChange(emptyAction());
            }
          }}
        >
          <option value="set_field">Set A Field</option>
          <option value="notify">Send An Alert</option>
          <option value="move_stage">Move To A Stage</option>
        </SelectField>
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {action.kind === 'notify' ? (
        <>
          <SelectField
            label="To"
            value={
              action.audience === 'role'
                ? `role:${action.roleKey ?? ''}`
                : `user:${action.userId ?? ''}`
            }
            onChange={(value) => {
              if (value.startsWith('user:')) {
                onChange({ ...action, audience: 'user', userId: value.slice(5), roleKey: null });
              } else {
                onChange({ ...action, audience: 'role', roleKey: value.slice(5), userId: null });
              }
            }}
          >
            {ACCESS_ROLES.map((role) => (
              <option key={role.key} value={`role:${role.key}`}>
                {plainRoleName(role)}
              </option>
            ))}
            {people.map((person) => (
              <option key={person.id} value={`user:${person.id}`}>
                {person.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Title"
            value={action.title}
            onChange={(value) => onChange({ ...action, title: value })}
          />
          <TextField
            label="Message"
            value={action.body}
            onChange={(value) => onChange({ ...action, body: value })}
          />
        </>
      ) : null}
      {action.kind === 'set_field' ? (
        <>
          <SelectField
            label="Field"
            value={action.fieldKey}
            onChange={(value) => onChange({ ...action, fieldKey: value })}
          >
            {settable.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Using"
            value={action.mode}
            onChange={(value) =>
              onChange({ ...action, mode: value === 'formula' ? 'formula' : 'value' })
            }
          >
            <option value="value">A Value</option>
            <option value="formula">A Formula</option>
          </SelectField>
          {action.mode === 'formula' ? (
            <FormulaEditor
              inputs={inputs}
              formula={action.formula ?? ''}
              places={0}
              display="number"
              unit=""
              selfKey={action.fieldKey}
              selfLabel="Value"
              others={[]}
              onChange={(next) => onChange({ ...action, formula: next.formula })}
            />
          ) : (
            <TextField
              label="Value"
              value={action.value ?? ''}
              onChange={(value) => onChange({ ...action, value })}
            />
          )}
        </>
      ) : null}
      {action.kind === 'move_stage' ? (
        <>
          <SelectField
            label="Stages"
            value={action.machineKey}
            onChange={(value) => {
              const stage = stages.find((item) => item.machineKey === value);
              onChange({ ...action, machineKey: value, toState: stage?.states[0]?.key ?? '' });
            }}
          >
            {stages.map((stage) => (
              <option key={stage.machineKey} value={stage.machineKey}>
                {stage.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Stage"
            value={action.toState}
            onChange={(value) => onChange({ ...action, toState: value })}
          >
            {(stages.find((stage) => stage.machineKey === action.machineKey)?.states ?? []).map(
              (state) => (
                <option key={state.key} value={state.key}>
                  {state.label}
                </option>
              ),
            )}
          </SelectField>
        </>
      ) : null}
    </div>
  );
}
