import {
  formatZar,
  money,
  type CustomFieldDefinition,
  type CustomFieldValue,
} from '@omnivate/shared';
import { useState } from 'react';
import { SelectField, TextField } from './components';

/**
 * Renders the custom fields for any record. Callers pass the definitions and the
 * current values. Money is edited in rand and stored as whole cents.
 */
export function CustomFieldsForm({
  fields,
  values,
  onChange,
  errors,
  disabled,
}: {
  fields: readonly CustomFieldDefinition[];
  values: Record<string, CustomFieldValue | null | undefined>;
  onChange: (key: string, value: CustomFieldValue | null) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const visible = fields
    .filter((field) => !field.archived)
    .slice()
    .sort(
      (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label),
    );

  if (visible.length === 0) {
    return <p className="ui-hint">No extra fields on this record.</p>;
  }

  return (
    <div className="ui-custom-fields">
      {visible.map((field) => (
        <FieldControl
          key={field.id}
          field={field}
          value={values[field.fieldKey]}
          error={errors?.[field.fieldKey]}
          disabled={disabled}
          onChange={(value) => onChange(field.fieldKey, value)}
        />
      ))}
    </div>
  );
}

function FieldControl({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: CustomFieldDefinition;
  value: CustomFieldValue | null | undefined;
  error?: string;
  disabled?: boolean;
  onChange: (value: CustomFieldValue | null) => void;
}) {
  const hint = field.description || undefined;
  const required = field.required;

  if (field.fieldType === 'text') {
    return (
      <TextField
        label={mark(field.label, required)}
        hint={hint}
        error={error}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(next) => onChange(next === '' ? null : next)}
      />
    );
  }

  if (field.fieldType === 'number') {
    return (
      <TextField
        label={mark(field.label, required)}
        hint={hint ?? 'A number, such as 12 or 12.5'}
        error={error}
        inputMode="decimal"
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(next) => onChange(next.trim() === '' ? null : next.trim())}
      />
    );
  }

  if (field.fieldType === 'money') {
    return (
      <MoneyControl
        field={field}
        cents={typeof value === 'number' ? value : null}
        error={error}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (field.fieldType === 'calculated') {
    return (
      <TextField
        label={field.label}
        hint={field.description || 'Calculated. You cannot type this.'}
        value={calculatedText(field, value)}
        disabled
        onChange={() => undefined}
      />
    );
  }

  if (field.fieldType === 'date') {
    return (
      <TextField
        label={mark(field.label, required)}
        hint={hint}
        error={error}
        type="date"
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(next) => onChange(next === '' ? null : next)}
      />
    );
  }

  if (field.fieldType === 'select') {
    return (
      <SelectField
        label={mark(field.label, required)}
        hint={hint}
        error={error}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(next) => onChange(next === '' ? null : next)}
      >
        <option value="">Choose…</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value} disabled={disabled}>
            {titleWords(option.label)}
          </option>
        ))}
      </SelectField>
    );
  }

  if (field.fieldType === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className={error ? 'ui-field has-error' : 'ui-field'} disabled={disabled}>
        <legend>{mark(field.label, required)}</legend>
        <div className="ui-check-list">
          {field.options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label key={option.value} className="ui-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((item) => item !== option.value)
                      : [...selected, option.value];
                    onChange(next.length === 0 ? null : next);
                  }}
                />
                <span>{titleWords(option.label)}</span>
              </label>
            );
          })}
        </div>
        {error ? <small className="ui-error">{error}</small> : hint ? <small>{hint}</small> : null}
      </fieldset>
    );
  }

  return (
    <label className={error ? 'ui-field has-error ui-check' : 'ui-field ui-check'}>
      <span>
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? true : null)}
        />{' '}
        {mark(field.label, required)}
      </span>
      {error ? <small className="ui-error">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

function MoneyControl({
  field,
  cents,
  error,
  disabled,
  onChange,
}: {
  field: CustomFieldDefinition;
  cents: number | null;
  error?: string;
  disabled?: boolean;
  onChange: (value: CustomFieldValue | null) => void;
}) {
  const [text, setText] = useState(() => (cents === null ? '' : randFromCents(cents)));
  return (
    <TextField
      label={mark(field.label, field.required)}
      hint={field.description || 'Rand, such as 10.50'}
      error={error}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      onChange={(next) => {
        setText(next);
        const trimmed = next.trim();
        if (trimmed === '') {
          onChange(null);
          return;
        }
        const parsed = parseRand(trimmed);
        if (parsed !== null) {
          onChange(parsed);
        }
      }}
    />
  );
}

function calculatedText(
  field: CustomFieldDefinition,
  value: CustomFieldValue | null | undefined,
): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (field.formulaDisplay === 'money' && typeof value === 'number') {
    return formatZar(money(BigInt(value)));
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const unit = field.formulaUnit?.trim();
    return unit ? `${value} ${unit}` : String(value);
  }
  return '';
}

function titleWords(label: string): string {
  return label.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function mark(label: string, required: boolean): string {
  const titled = titleWords(label);
  return required ? `${titled} (Required)` : titled;
}

function randFromCents(cents: number): string {
  return formatZar(money(BigInt(cents)))
    .replace(/^R/, '')
    .replace(/\s/g, '');
}

function parseRand(value: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    return null;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? '').padEnd(2, '0') || '0');
  return sign * (whole * 100 + fraction);
}
