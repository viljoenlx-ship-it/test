// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

describe('foundation screen', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.history.pushState({}, '', '/');
  });

  it('shows a calm home page when the service is up', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'ok',
        service: 'omnivate-api',
        database: 'up',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg',
        vatStandardRateBasisPoints: 1500,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Omnivate' })).toBeTruthy();
    expect(screen.queryByText('Preview')).toBeNull();
    expect(screen.queryByText(/Light theme/i)).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Everything is running');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('shows a plain message when the service is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          status: 'degraded',
          service: 'omnivate-api',
          database: 'down',
          currency: 'ZAR',
          timeZone: 'Africa/Johannesburg',
          vatStandardRateBasisPoints: 1500,
        }),
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Something needs attention');
    });
  });

  it('keeps sign-in focused, with demo accounts only for a preview', () => {
    vi.stubEnv('VITE_PREVIEW', 'true');
    window.history.pushState({}, '', '/login');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(screen.getByText('Demo Accounts')).toBeTruthy();
    expect(screen.queryByText(/not from a header/i)).toBeNull();
  });
});
