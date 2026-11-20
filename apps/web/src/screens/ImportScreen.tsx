import { ImportWizard, type ImportCaller } from '@omnivate/ui';
import { useMemo } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

function callerFor(base: string): ImportCaller {
  return {
    async request(path, init) {
      const response = await fetch(`${API_BASE}${base}${path}`, {
        method: init?.method ?? 'GET',
        credentials: 'include',
        headers: init?.json ? { 'content-type': 'application/json' } : undefined,
        body: init?.form ?? (init?.json ? JSON.stringify(init.json) : undefined),
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = { message: text };
        }
      }
      return { status: response.status, body };
    },
    async download(path, filename) {
      const response = await fetch(`${API_BASE}${base}${path}`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('The file could not be downloaded.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  };
}

export function ImportScreen() {
  const caller = useMemo(() => callerFor('/krn'), []);
  return <ImportWizard caller={caller} />;
}
