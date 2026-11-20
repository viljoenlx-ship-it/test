// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

describe('contacts screen', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('shows a helpful empty state', async () => {
    window.history.pushState({}, '', '/contacts');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/auth/session')) {
          return { ok: false, status: 401, json: async () => ({ message: 'Sign in again.' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ parties: [], canEdit: true, canViewIdentity: false }),
        };
      }),
    );

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Contacts' })).toBeTruthy();
    expect(await screen.findByText('No contacts yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Contact' })).toBeTruthy();
  });
});
