import { ImportWizard, Skeleton, type ImportCaller } from '@omnivate/ui';
import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

const API_BASE = '/api';

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

export function CompanyImport({ id }: { id: string }) {
  const caller = useMemo(() => callerFor(`/control/tenants/${id}`), [id]);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api(`/control/tenants/${id}`).then(({ status, body }) => {
      if (
        cancelled ||
        status !== 200 ||
        !body ||
        typeof body !== 'object' ||
        !('companyName' in body)
      ) {
        return;
      }
      const companyName = (body as { companyName?: unknown }).companyName;
      if (typeof companyName === 'string') {
        setName(companyName);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!name) {
    return <Skeleton lines={6} />;
  }
  return <ImportWizard caller={caller} companyName={name} />;
}
