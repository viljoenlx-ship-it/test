export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as unknown;
  return { status: response.status, body };
}

export function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return fallback;
}

export async function upload(path: string, file: File): Promise<{ status: number; body: unknown }> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body,
    credentials: 'include',
  });
  const payload = (await response.json()) as unknown;
  return { status: response.status, body: payload };
}

export type Navigate = (to: string) => void;
