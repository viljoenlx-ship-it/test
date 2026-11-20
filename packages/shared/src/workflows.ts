/**
 * KRN-04 field shapes shared by the API and the form component.
 * Money is integer cents. Numbers are decimal strings, never floats.
 * Validation here is the same check the server runs before it stores JSON.
 */

import { zarFromDecimal } from './money';

export const FIELD_TYPES = [
  'text',
  'number',
  'money',
  'date',
  'select',
  'multi_select',
  'checkbox',
  'calculated',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldOption = {
  value: string;
  label: string;
};

export type CustomFieldDefinition = {
  id: string;
  entityType: string;
  entityLabel: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  description: string;
  sortOrder: number;
  minLength: number | null;
  maxLength: number | null;
  minNumber: string | null;
  maxNumber: string | null;
  minCents: number | null;
  maxCents: number | null;
  options: FieldOption[];
  archived: boolean;
  /** Set only for a calculated field. The formula names other fields on the same record. */
  formula?: string | null;
  formulaPlaces?: number | null;
  formulaDisplay?: 'number' | 'money' | null;
  formulaUnit?: string | null;
};

/** Canonical value stored in JSON. Money is whole cents. Numbers stay strings. */
export type CustomFieldValue = string | number | boolean | string[];

export type FieldError = {
  fieldKey: string;
  message: string;
};

const FIELD_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const OPTION_VALUE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const NUMBER_VALUE = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/;
const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

export function fieldTypeLabel(type: FieldType): string {
  switch (type) {
    case 'text':
      return 'Text';
    case 'number':
      return 'Number';
    case 'money':
      return 'Money';
    case 'date':
      return 'Date';
    case 'select':
      return 'Dropdown';
    case 'multi_select':
      return 'Several Choices';
    case 'checkbox':
      return 'Yes Or No';
    case 'calculated':
      return 'Calculated';
  }
}

export function isFieldKey(value: string): boolean {
  return FIELD_KEY.test(value);
}

function scaleDecimal(value: string): bigint {
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = body.split('.');
  const scaled = BigInt(`${whole}${fraction.padEnd(4, '0')}`);
  return negative ? -scaled : scaled;
}

function isRealDate(value: string): boolean {
  const match = DATE_VALUE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function optionValues(definition: CustomFieldDefinition): Set<string> {
  return new Set(definition.options.map((option) => option.value));
}

function checkNumber(definition: CustomFieldDefinition, value: string): string | null {
  if (!NUMBER_VALUE.test(value)) {
    return 'Enter a number, such as 12 or 12.5.';
  }
  const scaled = scaleDecimal(value);
  if (definition.minNumber !== null && scaled < scaleDecimal(definition.minNumber)) {
    return `Enter at least ${definition.minNumber}.`;
  }
  if (definition.maxNumber !== null && scaled > scaleDecimal(definition.maxNumber)) {
    return `Enter at most ${definition.maxNumber}.`;
  }
  return null;
}

function centsBound(value: number | null): bigint | null {
  if (value === null) {
    return null;
  }
  return BigInt(value);
}

/**
 * Checks a bag of values against the active definitions.
 * Unknown keys are rejected. Archived definitions are ignored, and their
 * stored values are left out of the result so a later save does not revive them.
 * Empty optional fields are omitted. A required checkbox must be ticked.
 */
export function validateCustomValues(
  definitions: readonly CustomFieldDefinition[],
  raw: Record<string, unknown>,
): { ok: true; values: Record<string, CustomFieldValue> } | { ok: false; errors: FieldError[] } {
  const active = definitions.filter((definition) => !definition.archived);
  const known = new Set(definitions.map((definition) => definition.fieldKey));
  const errors: FieldError[] = [];

  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      errors.push({ fieldKey: key, message: 'That field is not on this record.' });
    }
  }

  const values: Record<string, CustomFieldValue> = {};

  for (const definition of active) {
    if (definition.fieldType === 'calculated') {
      const incoming = raw[definition.fieldKey];
      const supplied = incoming !== undefined && incoming !== null && incoming !== '';
      if (supplied) {
        errors.push({
          fieldKey: definition.fieldKey,
          message: `${definition.label} is calculated. You cannot type it.`,
        });
      }
      continue;
    }
    const incoming = raw[definition.fieldKey];
    const empty =
      incoming === undefined ||
      incoming === null ||
      incoming === '' ||
      (Array.isArray(incoming) && incoming.length === 0) ||
      (definition.fieldType === 'checkbox' && incoming === false);

    if (empty) {
      if (definition.required) {
        errors.push({
          fieldKey: definition.fieldKey,
          message:
            definition.fieldType === 'checkbox'
              ? `Tick ${definition.label}.`
              : `Enter ${definition.label}.`,
        });
      }
      continue;
    }

    const problem = checkValue(definition, incoming);
    if (problem) {
      errors.push({ fieldKey: definition.fieldKey, message: problem });
      continue;
    }
    values[definition.fieldKey] = canonical(definition, incoming);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, values };
}

function checkValue(definition: CustomFieldDefinition, incoming: unknown): string | null {
  switch (definition.fieldType) {
    case 'text': {
      if (typeof incoming !== 'string') {
        return 'Enter text.';
      }
      const text = incoming.trim();
      const min = definition.minLength ?? 0;
      const max = definition.maxLength ?? 500;
      if (text.length < min) {
        return `Use at least ${min} characters.`;
      }
      if (text.length > max) {
        return `Use at most ${max} characters.`;
      }
      return null;
    }
    case 'number': {
      if (typeof incoming !== 'string') {
        return 'Enter a number, such as 12 or 12.5.';
      }
      return checkNumber(definition, incoming.trim());
    }
    case 'money': {
      let cents: bigint;
      if (typeof incoming === 'number') {
        if (!Number.isSafeInteger(incoming)) {
          return 'Enter a rand amount such as 10.50.';
        }
        cents = BigInt(incoming);
      } else if (typeof incoming === 'string') {
        try {
          cents = zarFromDecimal(incoming.trim()).amountCents;
        } catch {
          return 'Enter a rand amount such as 10.50.';
        }
      } else {
        return 'Enter a rand amount such as 10.50.';
      }
      const min = centsBound(definition.minCents);
      const max = centsBound(definition.maxCents);
      if (min !== null && cents < min) {
        return 'That amount is below the minimum.';
      }
      if (max !== null && cents > max) {
        return 'That amount is above the maximum.';
      }
      return null;
    }
    case 'date': {
      if (typeof incoming !== 'string' || !isRealDate(incoming)) {
        return 'Choose a date.';
      }
      return null;
    }
    case 'select': {
      if (typeof incoming !== 'string' || !optionValues(definition).has(incoming)) {
        return 'Choose one of the options.';
      }
      return null;
    }
    case 'multi_select': {
      if (!Array.isArray(incoming) || incoming.some((item) => typeof item !== 'string')) {
        return 'Choose one or more options.';
      }
      const allowed = optionValues(definition);
      if (incoming.some((item) => !allowed.has(item))) {
        return 'Choose one or more options.';
      }
      if (new Set(incoming).size !== incoming.length) {
        return 'Choose each option once.';
      }
      return null;
    }
    case 'checkbox': {
      if (typeof incoming !== 'boolean') {
        return 'Choose yes or no.';
      }
      return null;
    }
    case 'calculated':
      return 'This field is calculated.';
  }
}

function canonical(definition: CustomFieldDefinition, incoming: unknown): CustomFieldValue {
  switch (definition.fieldType) {
    case 'text':
      return (incoming as string).trim();
    case 'number':
      return (incoming as string).trim();
    case 'money':
      if (typeof incoming === 'number') {
        return incoming;
      }
      return Number(zarFromDecimal((incoming as string).trim()).amountCents);
    case 'date':
    case 'select':
      return incoming as string;
    case 'multi_select':
      return [...(incoming as string[])];
    case 'checkbox':
      return incoming as boolean;
    case 'calculated':
      return '';
  }
}

export function slugFieldKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!isFieldKey(slug)) {
    return '';
  }
  return slug;
}

export function isOptionValue(value: string): boolean {
  return OPTION_VALUE.test(value);
}
