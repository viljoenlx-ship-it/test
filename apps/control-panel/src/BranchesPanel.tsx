import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Form,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';

type Branch = {
  id: string;
  name: string;
  code: string;
  city: string | null;
  legalEntityName: string;
  active: boolean;
  isHeadOffice: boolean;
};

type Entity = { id: string; name: string; isPrimary: boolean; archivedAt: string | null };

type Page = {
  multiBranch: boolean;
  canEdit: boolean;
  canStructure: boolean;
  branches: Branch[];
  entities: Entity[];
};

export function BranchesPanel({ tenantId }: { tenantId: string }) {
  const notify = useToast();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('');
  const [archiveId, setArchiveId] = useState<string | null>(null);

  async function load() {
    const { status, body } = await api(`/control/tenants/${tenantId}/branches`);
    if (status !== 200 || !body || typeof body !== 'object') {
      setError(errorMessage(body, 'Branches did not load.'));
      return;
    }
    setPage(body as Page);
    setError('');
  }

  useEffect(() => {
    void load();
  }, [tenantId]);

  if (!page) {
    return error ? (
      <p className="ui-error" role="alert">
        {error}
      </p>
    ) : (
      <EmptyState title="Loading" body="Fetching branches." />
    );
  }

  const base = `/control/tenants/${tenantId}`;

  return (
    <div className="ui-stack">
      {error ? (
        <p className="ui-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card title="More Than One Branch">
        <p>
          {page.multiBranch
            ? 'This company can work from more than one branch. People pick the branch in the company app.'
            : 'This company works from Head Office only. People do not see a branch picker.'}
        </p>
        {page.canStructure ? (
          <Button
            variant={page.multiBranch ? 'secondary' : 'primary'}
            onClick={() => {
              void api(`${base}/multi-branch`, {
                method: 'POST',
                body: JSON.stringify({ enabled: !page.multiBranch }),
              }).then(async ({ status, body }) => {
                if (status >= 400) {
                  setError(errorMessage(body, 'The setting was not saved.'));
                  return;
                }
                notify({
                  title: page.multiBranch
                    ? 'The company is back to Head Office only.'
                    : 'More than one branch is now allowed.',
                });
                await load();
              });
            }}
          >
            {page.multiBranch ? 'Use Head Office Only' : 'Allow More Than One Branch'}
          </Button>
        ) : null}
      </Card>
      <Card title="Branches">
        <DataTable
          rows={page.branches}
          getRowId={(row) => row.id}
          emptyTitle="No branches yet"
          emptyBody="Head Office is created with the company."
          columns={[
            {
              key: 'name',
              header: 'Branch',
              sortValue: (row) => row.name,
              cell: (row) => (
                <div>
                  <strong>{row.name}</strong>
                  <div className="ui-hint">
                    {row.code}
                    {row.city ? ` · ${row.city}` : ''}
                  </div>
                </div>
              ),
            },
            { key: 'entity', header: 'Legal Entity', cell: (row) => row.legalEntityName },
            {
              key: 'status',
              header: 'Status',
              cell: (row) =>
                row.isHeadOffice ? (
                  <Badge tone="info">Head Office</Badge>
                ) : row.active ? (
                  <Badge tone="ok">Active</Badge>
                ) : (
                  <Badge tone="neutral">Inactive</Badge>
                ),
            },
            {
              key: 'archive',
              header: '',
              cell: (row) =>
                page.canStructure && !row.isHeadOffice ? (
                  <Button variant="ghost" onClick={() => setArchiveId(row.id)}>
                    Archive
                  </Button>
                ) : null,
            },
          ]}
        />
        {page.canEdit && page.multiBranch ? (
          <Form
            onSubmit={() => {
              void api(`${base}/branches`, {
                method: 'POST',
                body: JSON.stringify({
                  name,
                  code,
                  city,
                  country: 'ZA',
                  active: true,
                }),
              }).then(async ({ status, body }) => {
                if (status >= 400) {
                  setError(errorMessage(body, 'The branch was not saved.'));
                  return;
                }
                setName('');
                setCode('');
                setCity('');
                notify({ title: 'Branch added.' });
                await load();
              });
            }}
          >
            <TextField label="Branch Name" value={name} onChange={setName} required />
            <TextField
              label="Code"
              value={code}
              onChange={(value) => setCode(value.toUpperCase())}
              hint="Short code such as DBN."
              required
            />
            <TextField label="City" value={city} onChange={setCity} />
            <Button type="submit">Add Branch</Button>
          </Form>
        ) : null}
        <ConfirmDialog
          open={archiveId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setArchiveId(null);
            }
          }}
          title="Archive this branch?"
          body="The branch stays on the record. It is not deleted. People can no longer choose it."
          confirmLabel="Archive"
          onConfirm={() => {
            const id = archiveId;
            setArchiveId(null);
            if (!id) {
              return;
            }
            void api(`${base}/branches/${id}/archive`, { method: 'POST', body: '{}' }).then(
              async ({ status, body }) => {
                if (status >= 400) {
                  setError(errorMessage(body, 'The branch was not archived.'));
                  return;
                }
                notify({ title: 'Branch archived. It was not deleted.' });
                void load();
              },
            );
          }}
        />
        <p className="ui-hint">
          Legal entities:{' '}
          {page.entities
            .filter((entity) => !entity.archivedAt)
            .map((entity) => entity.name)
            .join(', ') || 'None yet'}
          . Invoices between entities are not available yet.
        </p>
      </Card>
    </div>
  );
}
