import { describe, expect, it } from 'vitest';
import {
  assertCanActivate,
  getModule,
  validateCustomValues,
  type CustomFieldDefinition,
} from '../src/index';

function field(
  partial: Partial<CustomFieldDefinition> & Pick<CustomFieldDefinition, 'fieldKey' | 'fieldType'>,
): CustomFieldDefinition {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    entityType: 'krn04.demo_record',
    entityLabel: 'Demo record',
    label: partial.fieldKey,
    required: false,
    description: '',
    sortOrder: 0,
    minLength: null,
    maxLength: null,
    minNumber: null,
    maxNumber: null,
    minCents: null,
    maxCents: null,
    options: [],
    archived: false,
    ...partial,
  };
}

describe('custom field values', () => {
  it('accepts text, cents, and a dropdown, and rejects a float and an unknown key', () => {
    const definitions = [
      field({ fieldKey: 'note', fieldType: 'text', required: true, maxLength: 20 }),
      field({ fieldKey: 'fee', fieldType: 'money', minCents: 0 }),
      field({
        fieldKey: 'size',
        fieldType: 'select',
        options: [
          { value: '8', label: '8' },
          { value: '9', label: '9' },
        ],
      }),
    ];

    const saved = validateCustomValues(definitions, { note: '  Nomsa  ', fee: '10.50', size: '8' });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.values).toEqual({ note: 'Nomsa', fee: 1050, size: '8' });
    }

    const bad = validateCustomValues(definitions, { note: 'Nomsa', fee: 10.5, extra: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.map((error) => error.fieldKey).sort()).toEqual(['extra', 'fee']);
    }
  });

  it('keeps a required checkbox ticked and ignores an archived field', () => {
    const definitions = [
      field({ fieldKey: 'agreed', fieldType: 'checkbox', required: true }),
      field({ fieldKey: 'old', fieldType: 'text', archived: true }),
    ];
    const missing = validateCustomValues(definitions, { agreed: false });
    expect(missing.ok).toBe(false);
    const kept = validateCustomValues(definitions, { agreed: true, old: 'nope' });
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.values).toEqual({ agreed: true });
    }
  });
});

describe('KRN-04 catalog', () => {
  it('depends only on identity', () => {
    expect(getModule('KRN-04').prerequisites).toEqual(['KRN-01']);
    expect(() => assertCanActivate(new Set(), 'KRN-04')).toThrow(/Cannot activate KRN-04/);
    expect(() => assertCanActivate(new Set(['KRN-01']), 'KRN-04')).not.toThrow();
  });
});
