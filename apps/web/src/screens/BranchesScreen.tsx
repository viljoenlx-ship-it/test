import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DialogFrame,
  EmptyState,
  Form,
  MenuButton,
  PageHeader,
  SelectField,
  Skeleton,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../api';

const PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
  'Western Cape',
];

type Entity = {
  id: string;
  name: string;
  registrationNumber: string | null;
  vatNumber: string | null;
  isPrimary: boolean;
  archivedAt: string | null;
};

type Branch = {
  id: string;
  name: string;
  code: string;
  legalEntityId: string;
  legalEntityName: string;
  addressLine1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  active: boolean;
  isHeadOffice: boolean;
  archivedAt: string | null;
};

type Assignment = {
  id: string;
  userId: string;
  branchId: string;
  displayName: string;
  email: string;
  branchName: string;
};

type Person = { id: string; displayName: string; email: string };

type Page = {
  multiBranch: boolean;
  canEdit: boolean;
  canStructure: boolean;
  branches: Branch[];
  archived: Branch[];
  entities: Entity[];
  assignments: Assignment[];
  people: Person[];
};

type Draft = {
  name: string;
  code: string;
  legalEntityId: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  active: boolean;
};

const emptyDraft: Draft = {
  name: '',
  code: '',
  legalEntityId: '',
  addressLine1: '',
  city: '',
  province: '',
  postalCode: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  active: true,
};

function draftFrom(branch: Branch): Draft {
  return {
    name: branch.name,
    code: branch.code,
    legalEntityId: branch.legalEntityId,
    addressLine1: branch.addressLine1 ?? '',
    city: branch.city ?? '',
    province: branch.province ?? '',
    postalCode: branch.postalCode ?? '',
    contactName: branch.contactName ?? '',
    contactEmail: branch.contactEmail ?? '',
    contactPhone: branch.contactPhone ?? '',
    active: branch.active,
  };
}

function payload(draft: Draft, headOffice: boolean) {
  return {
    ...draft,
    country: 'ZA',
    active: headOffice ? true : draft.active,
    legalEntityId: draft.legalEntityId || null,
  };
}

export function BranchesScreen({ navigate }: { navigate: Navigate }) {
  const notify = useToast();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<null | {
    id: string | null;
    headOffice: boolean;
    draft: Draft;
  }>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [entityName, setEntityName] = useState('');
  const [addFor, setAddFor] = useState<Record<string, string>>({});

  async function load() {
    const { status, body } = await api('/krn/branches');
    if (status === 401) {
      setPage(null);
      setError('Sign in to see branches.');
      return;
    }
    if (status === 403) {
      setPage(null);
      setError('Your role cannot open branches.');
      return;
    }
    if (status !== 200 || !body || typeof body !== 'object') {
      setError(errorMessage(body, 'Branches did not load.'));
      return;
    }
    const next = body as Page;
    setPage(next);
    setError('');
  }

  async function revokeAccess(accessId: string) {
    const { status, body } = await api(`/krn/branch-access/${accessId}/revoke`, {
      method: 'POST',
      body: '{}',
    });
    if (status >= 400) {
      setError(errorMessage(body, 'The assignment was not removed.'));
      return;
    }
    notify({ title: 'Assignment removed.' });
    await load();
  }

  async function grantAccess(userId: string, branchId: string) {
    const { status, body } = await api('/krn/branch-access', {
      method: 'POST',
      body: JSON.stringify({ userId, branchId }),
    });
    if (status >= 400) {
      setError(errorMessage(body, 'The assignment was not saved.'));
      return;
    }
    notify({ title: 'Person assigned to the branch.' });
    await load();
  }

  useEffect(() => {
    let cancelled = false;
    load().catch(() => {
      if (!cancelled) {
        setError('The API is unreachable.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveBranch() {
    if (!editor) {
      return;
    }
    const path = editor.id ? `/krn/branches/${editor.id}` : '/krn/branches';
    const { status, body } = await api(path, {
      method: editor.id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload(editor.draft, editor.headOffice)),
    });
    if (status >= 400) {
      setError(errorMessage(body, 'The branch was not saved.'));
      return;
    }
    setEditor(null);
    notify({ title: editor.id ? 'Branch saved.' : 'Branch added.' });
    await load();
  }

  const liveEntities = (page?.entities ?? []).filter((entity) => !entity.archivedAt);

  return (
    <>
      <PageHeader
        title="Branches"
        description="Your company starts with one Head Office. Turn on more than one branch when you have a second shop or site."
      />
      {error ? (
        <p className="ui-error" role="alert">
          {error}{' '}
          {error.startsWith('Sign in') ? (
            <Button variant="secondary" onClick={() => navigate('/login')}>
              Sign In
            </Button>
          ) : null}
        </p>
      ) : null}
      {page === null && !error ? <Skeleton lines={5} /> : null}
      {page ? (
        <div className="ui-stack">
          <Card title="How Many Branches?">
            <p>
              {page.multiBranch
                ? 'People choose a branch in the header. Owners can work at every branch. Everyone else only sees the branches you assign.'
                : 'People work at Head Office only. There is no branch picker.'}
            </p>
            {page.canStructure ? (
              <Button
                variant={page.multiBranch ? 'secondary' : 'primary'}
                onClick={() => {
                  if (page.multiBranch) {
                    setConfirmOff(true);
                    return;
                  }
                  void api('/krn/multi-branch', {
                    method: 'POST',
                    body: JSON.stringify({ enabled: true }),
                  }).then(async ({ status, body }) => {
                    if (status >= 400) {
                      setError(errorMessage(body, 'The setting was not saved.'));
                      return;
                    }
                    notify({ title: 'More than one branch is now allowed.' });
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
                {
                  key: 'entity',
                  header: 'Legal Entity',
                  sortValue: (row) => row.legalEntityName,
                  cell: (row) => row.legalEntityName,
                },
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
                  key: 'actions',
                  header: '',
                  cell: (row) =>
                    page.canEdit ? (
                      <MenuButton
                        label={`Actions for ${row.name}`}
                        items={[
                          {
                            label: 'Edit',
                            onSelect: () =>
                              setEditor({
                                id: row.id,
                                headOffice: row.isHeadOffice,
                                draft: draftFrom(row),
                              }),
                          },
                          ...(page.canStructure && !row.isHeadOffice
                            ? [
                                {
                                  label: 'Archive',
                                  tone: 'danger' as const,
                                  onSelect: () => setArchiveId(row.id),
                                },
                              ]
                            : []),
                        ]}
                      />
                    ) : null,
                },
              ]}
            />
            {page.canEdit && page.multiBranch ? (
              <div className="ui-form-submit">
                <Button
                  onClick={() =>
                    setEditor({
                      id: null,
                      headOffice: false,
                      draft: {
                        ...emptyDraft,
                        legalEntityId: liveEntities.find((entity) => entity.isPrimary)?.id ?? '',
                      },
                    })
                  }
                >
                  Add A Branch
                </Button>
              </div>
            ) : null}
            {page.archived.length > 0 ? (
              <p className="ui-hint">
                Archived: {page.archived.map((row) => row.name).join(', ')}. Archived branches stay
                on the record.
              </p>
            ) : null}
          </Card>
          {page.multiBranch ? (
            <Card title="Who Works Where">
              <p>Each person is listed once. Add the branches they should see in the header.</p>
              {page.people.length === 0 ? (
                <EmptyState title="No people yet" body="Invite someone, then assign a branch." />
              ) : (
                <div>
                  {page.people.map((person) => {
                    const assigned = page.assignments.filter((row) => row.userId === person.id);
                    const taken = new Set(assigned.map((row) => row.branchId));
                    const available = page.branches.filter((branch) => !taken.has(branch.id));
                    const chosen = addFor[person.id] || available[0]?.id || '';
                    return (
                      <div className="ui-assignment" key={person.id}>
                        <div>
                          <strong>{person.displayName}</strong>
                          <div className="ui-hint">{person.email}</div>
                        </div>
                        <div className="ui-chips">
                          {assigned.map((branch) => (
                            <span className="ui-chip" key={branch.id}>
                              {branch.branchName}
                              {page.canEdit ? (
                                <button
                                  type="button"
                                  aria-label={`Remove ${person.displayName} from ${branch.branchName}`}
                                  onClick={() => void revokeAccess(branch.id)}
                                >
                                  Remove
                                </button>
                              ) : null}
                            </span>
                          ))}
                          {assigned.length === 0 ? (
                            <span className="ui-hint">No Branch Yet</span>
                          ) : null}
                        </div>
                        {page.canEdit && available.length > 0 ? (
                          <form
                            className="ui-assignment-add"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (chosen) {
                                void grantAccess(person.id, chosen);
                              }
                            }}
                          >
                            <label>
                              <span className="ui-sr">Branch for {person.displayName}</span>
                              <select
                                aria-label={`Add a branch for ${person.displayName}`}
                                value={chosen}
                                onChange={(event) =>
                                  setAddFor((current) => ({
                                    ...current,
                                    [person.id]: event.target.value,
                                  }))
                                }
                              >
                                {available.map((branch) => (
                                  <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Button type="submit" variant="secondary">
                              Add
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ) : null}
          <Card title="Legal Entities">
            <p>
              Each branch belongs to a legal entity. Invoices between those entities are not
              available yet.
            </p>
            <ul>
              {liveEntities.map((entity) => (
                <li key={entity.id}>
                  <strong>{entity.name}</strong>
                  {entity.isPrimary ? ' · Main Entity' : ''}
                  {entity.registrationNumber ? ` · ${entity.registrationNumber}` : ''}
                </li>
              ))}
            </ul>
            {page.canStructure ? (
              <Form
                onSubmit={() => {
                  void api('/krn/legal-entities', {
                    method: 'POST',
                    body: JSON.stringify({ name: entityName }),
                  }).then(async ({ status, body }) => {
                    if (status >= 400) {
                      setError(errorMessage(body, 'The legal entity was not saved.'));
                      return;
                    }
                    setEntityName('');
                    notify({ title: 'Legal entity added.' });
                    await load();
                  });
                }}
              >
                <TextField
                  label="Another Legal Entity"
                  value={entityName}
                  onChange={setEntityName}
                  hint="A second company in the same group. No transactions are posted between them."
                />
                <Button type="submit" variant="secondary">
                  Add Legal Entity
                </Button>
              </Form>
            ) : null}
          </Card>
        </div>
      ) : null}
      <DialogFrame
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(null);
          }
        }}
        title={editor?.id ? 'Edit Branch' : 'Add A Branch'}
        description="Name, code, address, and who to call."
      >
        {editor ? (
          <Form onSubmit={() => void saveBranch()}>
            <TextField
              label="Name"
              value={editor.draft.name}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, name: value } })
              }
              required
            />
            <TextField
              label="Code"
              value={editor.draft.code}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, code: value.toUpperCase() } })
              }
              hint="Short code such as CPT. Used later on document numbers."
              required
            />
            {liveEntities.length > 1 ? (
              <SelectField
                label="Legal Entity"
                value={editor.draft.legalEntityId}
                onChange={(value) =>
                  setEditor({ ...editor, draft: { ...editor.draft, legalEntityId: value } })
                }
              >
                {liveEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <TextField
              label="Street Address"
              value={editor.draft.addressLine1}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, addressLine1: value } })
              }
            />
            <TextField
              label="City"
              value={editor.draft.city}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, city: value } })
              }
            />
            <SelectField
              label="Province"
              value={editor.draft.province}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, province: value } })
              }
            >
              <option value="">Not Set</option>
              {PROVINCES.map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Postal Code"
              value={editor.draft.postalCode}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, postalCode: value } })
              }
            />
            <TextField
              label="Contact Name"
              value={editor.draft.contactName}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, contactName: value } })
              }
            />
            <TextField
              label="Contact Email"
              type="email"
              value={editor.draft.contactEmail}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, contactEmail: value } })
              }
            />
            <TextField
              label="Contact Phone"
              value={editor.draft.contactPhone}
              onChange={(value) =>
                setEditor({ ...editor, draft: { ...editor.draft, contactPhone: value } })
              }
            />
            {editor.headOffice ? null : (
              <label className="ui-check">
                <input
                  type="checkbox"
                  checked={editor.draft.active}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      draft: { ...editor.draft, active: event.target.checked },
                    })
                  }
                />
                <span>Active. Inactive branches stay on file but cannot be chosen.</span>
              </label>
            )}
            <div className="ui-actions">
              <Button type="submit">Save Branch</Button>
              <Button type="button" variant="ghost" onClick={() => setEditor(null)}>
                Cancel
              </Button>
            </div>
          </Form>
        ) : null}
      </DialogFrame>
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Use Head Office Only?"
        body="Other branches stay on file. People will not see a branch picker until you allow more than one branch again."
        confirmLabel="Use One Branch"
        tone="primary"
        onConfirm={() => {
          setConfirmOff(false);
          void api('/krn/multi-branch', {
            method: 'POST',
            body: JSON.stringify({ enabled: false }),
          }).then(async ({ status, body }) => {
            if (status >= 400) {
              setError(errorMessage(body, 'The setting was not saved.'));
              return;
            }
            notify({ title: 'People now work at Head Office only.' });
            await load();
          });
        }}
      />
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
          void api(`/krn/branches/${id}/archive`, { method: 'POST', body: '{}' }).then(
            async ({ status, body }) => {
              if (status >= 400) {
                setError(errorMessage(body, 'The branch was not archived.'));
                return;
              }
              notify({ title: 'Branch archived.' });
              await load();
            },
          );
        }}
      />
    </>
  );
}
