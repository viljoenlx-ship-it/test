import { PageHeader } from '@omnivate/ui';

const DESK_SLUGS = new Set(['people', 'branches', 'approvals', 'portals', 'import']);

/** Setup screens that stay on a desk. Sales, stock, contacts, and reports stay on the phone. */
export function isDeskOnlyPath(path: string): boolean {
  if (path === '/users' || path.startsWith('/users/')) return true;
  if (path === '/branches' || path.startsWith('/branches/')) return true;
  if (path === '/import' || path.startsWith('/import/')) return true;
  if (path === '/ledger' || path.startsWith('/ledger/')) return true;
  if (path.startsWith('/settings')) return true;
  if (path === '/reports/new') return true;
  if (path === '/stock/new' || /^\/stock\/items\/[^/]+\/edit$/.test(path)) return true;
  if (path === '/contacts/new' || /^\/contacts\/[^/]+\/edit$/.test(path)) return true;
  const slug = /^\/modules\/([a-z0-9-]+)$/.exec(path)?.[1];
  return slug !== undefined && DESK_SLUGS.has(slug);
}

/** Shown when a phone opens a screen that belongs at a desk. */
export function ComputerScreen() {
  return (
    <div className="ui-desk-note">
      <PageHeader title="On A Computer" />
      <h2>Open This On A Computer</h2>
      <p>
        People, branches, and the rest of the setup stay at a desk. On the phone you can sell, check
        stock, snap a document, and look up a contact.
      </p>
    </div>
  );
}
