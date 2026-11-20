import {
  fieldTypeLabel,
  slugFieldKey,
  type CustomFieldDefinition,
  type FieldType,
  type FormulaDisplay,
} from '@omnivate/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Form,
  SelectField,
  Skeleton,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';
import { FormulaEditor, type FormulaInput } from './FormulaEditor';

type EntityGroup = {
  key: string;
  label: string;
  fields: CustomFieldDefinition[];
  inputs?: FormulaInput[];
};

const TYPES: FieldType[] = [
  'text',
  'number',
  'money',
  'date',
  'select',
  'multi_select',
  'checkbox',
  'calculated',
];

export function FieldsPanel({ tenantId }: { tenantId: string }) {
  const notify = useToast();
  const [entities, setEntities] = useState<EntityGroup[] | null>(null);
  const [problem, setProblem] = useState('');
  const [draft, setDraft] = useState({
    entityType: '',
    label: '',
    fieldType: 'text' as FieldType,
    required: false,
    description: '',
    choices: '',
    formula: '',
    formulaPlaces: 0,
    formulaDisplay: 'money' as FormulaDisplay,
    formulaUnit: '',
  });

  async function load() {
    const { status, body } = await api(`/control/tenants/${tenantId}/fields`);
    if (status !== 200 || !body || typeof body !== 'object' || !('entities' in body)) {
      setProblem(errorMessage(body, 'Custom fields could not be loaded.'));
      setEntities([]);
      return;
    }
    const next = (body as { entities: EntityGroup[] }).entities;
    setEntities(next);
    setProblem('');
    setDraft((current) => ({
      ...current,
      entityType: current.entityType || next[0]?.key || '',
    }));
  }

  useEffect(() => {
    void load();
  }, [tenantId]);

  function choices(): { value: string; label: string }[] {
    return draft.choices
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label) => ({ value: slugFieldKey(label), label }));
  }

  async function addField() {
    const { status, body } = await api(`/control/tenants/${tenantId}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        entityType: draft.entityType,
        fieldKey: slugFieldKey(draft.label),
        label: draft.label,
        fieldType: draft.fieldType,
        required: draft.required,
        description: draft.description,
        options:
          draft.fieldType === 'select' || draft.fieldType === 'multi_select' ? choices() : [],
        formula: draft.fieldType === 'calculated' ? draft.formula : null,
        formulaPlaces: draft.fieldType === 'calculated' ? draft.formulaPlaces : null,
        formulaDisplay: draft.fieldType === 'calculated' ? draft.formulaDisplay : null,
        formulaUnit: draft.fieldType === 'calculated' ? draft.formulaUnit : '',
      }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The field was not added.'), tone: 'bad' });
      return;
    }
    notify({ title: 'Field added.' });
    setDraft((current) => ({
      ...current,
      label: '',
      description: '',
      choices: '',
      required: false,
    }));
    await load();
  }

  async function archive(id: string) {
    const { status, body } = await api(`/control/tenants/${tenantId}/fields/${id}/archive`, {
      method: 'POST',
      body: '{}',
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'That field was not archived.'), tone: 'bad' });
      return;
    }
    notify({ title: 'Field archived.' });
    await load();
  }

  async function restore(id: string) {
    const { status, body } = await api(`/control/tenants/${tenantId}/fields/${id}/restore`, {
      method: 'POST',
      body: '{}',
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'That field was not restored.'), tone: 'bad' });
      return;
    }
    await load();
  }

  async function saveLabel(
    field: CustomFieldDefinition,
    label: string,
    required: boolean,
    formula?: { formula: string; places: number; display: FormulaDisplay; unit: string },
  ) {
    const { status, body } = await api(`/control/tenants/${tenantId}/fields/${field.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        label,
        required: field.fieldType === 'calculated' ? false : required,
        description: field.description,
        formula: formula?.formula,
        formulaPlaces: formula?.places,
        formulaDisplay: formula?.display,
        formulaUnit: formula?.unit,
      }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The field was not saved.'), tone: 'bad' });
      return;
    }
    notify({ title: 'Field saved.' });
    await load();
  }

  async function move(entity: EntityGroup, field: CustomFieldDefinition, direction: -1 | 1) {
    const active = entity.fields.filter((item) => !item.archived);
    const index = active.findIndex((item) => item.id === field.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= active.length) {
      return;
    }
    const order = active.map((item) => item.id);
    const [item] = order.splice(index, 1);
    if (!item) {
      return;
    }
    order.splice(next, 0, item);
    const { status, body } = await api(`/control/tenants/${tenantId}/fields/reorder`, {
      method: 'POST',
      body: JSON.stringify({ entityType: entity.key, fieldIds: order }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The order was not saved.'), tone: 'bad' });
      return;
    }
    await load();
  }

  if (!entities) {
    return <Skeleton lines={5} />;
  }
  if (problem) {
    return (
      <Card title="Custom Fields">
        <p>{problem}</p>
      </Card>
    );
  }

  return (
    <div className="ui-stack">
      {entities.flatMap((entity) => {
        const active = entity.fields.filter((field) => !field.archived);
        const calculated = entity.fields.filter((field) => field.fieldType === 'calculated');
        return calculated.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            inputs={entity.inputs ?? []}
            others={entity.fields
              .filter(
                (item) => item.fieldType === 'calculated' && item.id !== field.id && item.formula,
              )
              .map((item) => ({
                key: item.fieldKey,
                label: item.label,
                formula: item.formula ?? '',
              }))}
            canMoveUp={!field.archived && active[0]?.id !== field.id}
            canMoveDown={!field.archived && active[active.length - 1]?.id !== field.id}
            onSave={(label, required, formula) => void saveLabel(field, label, required, formula)}
            onArchive={() => void archive(field.id)}
            onRestore={() => void restore(field.id)}
            onMove={(direction) => void move(entity, field, direction)}
          />
        ));
      })}
      <Card title="Add A Field">
        <Form onSubmit={() => void addField()}>
          <SelectField
            label="Record"
            value={draft.entityType}
            onChange={(value) => setDraft((current) => ({ ...current, entityType: value }))}
          >
            {entities.map((entity) => (
              <option key={entity.key} value={entity.key}>
                {entity.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Field Name"
            value={draft.label}
            onChange={(value) => setDraft((current) => ({ ...current, label: value }))}
          />
          <SelectField
            label="Type"
            value={draft.fieldType}
            onChange={(value) =>
              setDraft((current) => ({ ...current, fieldType: value as FieldType }))
            }
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {fieldTypeLabel(type)}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Help Text"
            value={draft.description}
            onChange={(value) => setDraft((current) => ({ ...current, description: value }))}
          />
          {draft.fieldType === 'calculated' ? (
            <FormulaEditor
              inputs={(
                entities.find((entity) => entity.key === draft.entityType)?.inputs ?? []
              ).filter((input) => input.key !== slugFieldKey(draft.label))}
              formula={draft.formula}
              places={draft.formulaPlaces}
              display={draft.formulaDisplay}
              unit={draft.formulaUnit}
              selfKey={slugFieldKey(draft.label) || 'calculated'}
              selfLabel={draft.label || 'Calculated'}
              others={(entities.find((entity) => entity.key === draft.entityType)?.fields ?? [])
                .filter((field) => field.fieldType === 'calculated' && field.formula)
                .map((field) => ({
                  key: field.fieldKey,
                  label: field.label,
                  formula: field.formula ?? '',
                }))}
              onChange={(next) =>
                setDraft((current) => ({
                  ...current,
                  formula: next.formula,
                  formulaPlaces: next.places,
                  formulaDisplay: next.display,
                  formulaUnit: next.unit,
                }))
              }
            />
          ) : null}
          {draft.fieldType === 'select' || draft.fieldType === 'multi_select' ? (
            <label className="ui-field">
              <span>Choices, One Per Line</span>
              <textarea
                value={draft.choices}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, choices: event.target.value }))
                }
              />
            </label>
          ) : null}
          <label className="ui-check">
            <input
              type="checkbox"
              checked={draft.required}
              onChange={(event) =>
                setDraft((current) => ({ ...current, required: event.target.checked }))
              }
            />
            <span>Required</span>
          </label>
          <Button type="submit">Add Field</Button>
        </Form>
      </Card>
      {entities.length === 0 ? (
        <Card>
          <EmptyState
            title="No Record Types Yet"
            body="A module has to register a record before a field can be added."
          />
        </Card>
      ) : null}
      {entities.map((entity) => {
        const active = entity.fields.filter((field) => !field.archived);
        const plain = entity.fields.filter((field) => field.fieldType !== 'calculated');
        return (
          <Card key={entity.key} title={entity.label}>
            {plain.length === 0 ? <p>No Fields Yet.</p> : null}
            {plain.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                inputs={entity.inputs ?? []}
                others={[]}
                canMoveUp={!field.archived && active[0]?.id !== field.id}
                canMoveDown={!field.archived && active[active.length - 1]?.id !== field.id}
                onSave={(label, required, formula) =>
                  void saveLabel(field, label, required, formula)
                }
                onArchive={() => void archive(field.id)}
                onRestore={() => void restore(field.id)}
                onMove={(direction) => void move(entity, field, direction)}
              />
            ))}
          </Card>
        );
      })}
    </div>
  );
}

function FieldRow({
  field,
  inputs,
  others,
  canMoveUp,
  canMoveDown,
  onSave,
  onArchive,
  onRestore,
  onMove,
}: {
  field: CustomFieldDefinition;
  inputs: FormulaInput[];
  others: { key: string; label: string; formula: string }[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (
    label: string,
    required: boolean,
    formula?: { formula: string; places: number; display: FormulaDisplay; unit: string },
  ) => void;
  onArchive: () => void;
  onRestore: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [required, setRequired] = useState(field.required);
  const [formula, setFormula] = useState({
    formula: field.formula ?? '',
    places: field.formulaPlaces ?? 0,
    display: (field.formulaDisplay ?? 'number') as FormulaDisplay,
    unit: field.formulaUnit ?? '',
  });
  const actions = (
    <div className="ui-actions">
      {!field.archived ? (
        <>
          <Button variant="secondary" disabled={!canMoveUp} onClick={() => onMove(-1)}>
            Move Up
          </Button>
          <Button variant="secondary" disabled={!canMoveDown} onClick={() => onMove(1)}>
            Move Down
          </Button>
          <Button variant="secondary" onClick={onArchive}>
            Archive
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={onRestore}>
          Restore
        </Button>
      )}
    </div>
  );

  if (field.fieldType === 'calculated') {
    return (
      <Card>
        <div className="field-card-head">
          <div className="field-card-title">
            <h2>{field.label}</h2>
            <Badge tone="neutral">{fieldTypeLabel(field.fieldType)}</Badge>
            {field.archived ? <Badge tone="warn">Archived</Badge> : null}
          </div>
          {actions}
        </div>
        {!field.archived ? (
          <Form
            onSubmit={() => {
              onSave(label, false, formula);
            }}
          >
            <TextField label="Name" value={label} onChange={setLabel} />
            <FormulaEditor
              inputs={inputs.filter((input) => input.key !== field.fieldKey)}
              formula={formula.formula}
              places={formula.places}
              display={formula.display}
              unit={formula.unit}
              selfKey={field.fieldKey}
              selfLabel={label}
              others={others}
              onChange={setFormula}
            />
            <Button type="submit">Save Field</Button>
          </Form>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="ui-field-line">
      <div>
        <strong>{field.label}</strong>{' '}
        <Badge tone="neutral">{fieldTypeLabel(field.fieldType)}</Badge>
        {field.archived ? <Badge tone="warn">Archived</Badge> : null}
        {field.required ? <Badge>Required</Badge> : null}
        {!field.archived ? (
          <Form
            onSubmit={() => {
              onSave(label, required);
            }}
          >
            <TextField label="Name" value={label} onChange={setLabel} />
            <label className="ui-check">
              <input
                type="checkbox"
                checked={required}
                onChange={(event) => setRequired(event.target.checked)}
              />
              <span>Required</span>
            </label>
            <Button type="submit">Save Field</Button>
          </Form>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
