// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CustomFieldsForm } from '@omnivate/ui';
import type { CustomFieldDefinition } from '@omnivate/shared';

const fields: CustomFieldDefinition[] = [
  {
    id: '00000000-0000-4000-8000-000000000010',
    entityType: 'krn04.sample_job',
    entityLabel: 'Sample job card',
    fieldKey: 'site_contact',
    label: 'Site contact',
    fieldType: 'text',
    required: true,
    description: 'Who to ask for.',
    sortOrder: 0,
    minLength: null,
    maxLength: 80,
    minNumber: null,
    maxNumber: null,
    minCents: null,
    maxCents: null,
    options: [],
    archived: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000011',
    entityType: 'krn04.sample_job',
    entityLabel: 'Sample job card',
    fieldKey: 'old_counter_code',
    label: 'Old counter code',
    fieldType: 'text',
    required: false,
    description: '',
    sortOrder: 1,
    minLength: null,
    maxLength: null,
    minNumber: null,
    maxNumber: null,
    minCents: null,
    maxCents: null,
    options: [],
    archived: true,
  },
];

describe('custom fields form', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows active fields and hides archived ones', () => {
    render(
      <CustomFieldsForm
        fields={fields}
        values={{ site_contact: 'Nomsa' }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText(/Site Contact/)).toBeTruthy();
    expect(screen.queryByLabelText(/Old counter code/)).toBeNull();
  });
});
