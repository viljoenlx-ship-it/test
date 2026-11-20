import { describe, expect, it } from 'vitest';
import { describeActivity, relativeTime } from '../src/activity';

describe('activity phrases', () => {
  it('hides raw event codes', () => {
    expect(describeActivity('platform.login.succeeded').title).toBe('Signed in');
    expect(describeActivity('platform.mfa.enrolled').title).toBe('Set up authenticator');
    expect(describeActivity('identity.role.assigned', { roles: ['branch_manager'] }).title).toBe(
      'Changed role to Manager',
    );
    expect(describeActivity('identity.module.activated', { moduleId: 'SAL-03' }).title).toBe(
      'Switched on Point Of Sale',
    );
    expect(describeActivity('workflow.pipeline.updated').title).toBe('Updated the stages');
    expect(describeActivity('krn06.import.completed', { target: 'Contacts' }).title).toBe(
      'Imported contacts',
    );
    expect(describeActivity('platform.user.password_reset').title).toBe('Reset a password');
    expect(describeActivity('platform.preview.opened').title).toBe('Opened a read-only preview');
    expect(describeActivity('mystery.event').title).not.toContain('mystery');
  });

  it('says how long ago something happened', () => {
    const now = Date.parse('2026-11-19T12:00:00.000Z');
    expect(relativeTime('2026-11-19T11:58:00.000Z', now)).toBe('2 min ago');
    expect(relativeTime('2026-11-19T11:59:40.000Z', now)).toBe('Just now');
  });
});
