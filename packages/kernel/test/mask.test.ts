import { describe, expect, it } from 'vitest';
import { COUNSELING_PERMISSION } from '@omnivate/shared';
import { FIELD_MASK, maskFields } from '../src/mask';

describe('field masking', () => {
  const note = { id: '1', body: 'A private counseling note', topic: 'sleep' };

  it('hides the field when the permission is missing and shows it when present', () => {
    const hidden = maskFields(
      note,
      ['body'],
      new Set(['hrp.welfare.admin']),
      COUNSELING_PERMISSION,
    );
    expect(hidden.body).toBe(FIELD_MASK);
    expect(hidden.topic).toBe('sleep');

    const shown = maskFields(
      note,
      ['body'],
      new Set([COUNSELING_PERMISSION]),
      COUNSELING_PERMISSION,
    );
    expect(shown.body).toBe('A private counseling note');
  });
});
