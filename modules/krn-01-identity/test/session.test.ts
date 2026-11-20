import { afterEach, describe, expect, it } from 'vitest';
import { sessionTtlSeconds } from '../src/session';

describe('session lifetime', () => {
  const previous = process.env.SESSION_TTL_SECONDS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.SESSION_TTL_SECONDS;
    } else {
      process.env.SESSION_TTL_SECONDS = previous;
    }
  });

  it('defaults to 15 minutes and refuses a long-lived session', () => {
    delete process.env.SESSION_TTL_SECONDS;
    expect(sessionTtlSeconds()).toBe(900);
    process.env.SESSION_TTL_SECONDS = '86400';
    expect(() => sessionTtlSeconds()).toThrow(/60 to 3600/);
  });
});
