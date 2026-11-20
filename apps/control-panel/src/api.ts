const API_BASE = '/api';

export async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : init?.body
          ? { 'content-type': 'application/json' }
          : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  return { status: response.status, body };
}

export function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return fallback;
}
