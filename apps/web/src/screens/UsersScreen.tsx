import { plainRoleName, SOD_ACTIONS, sodPreventionSentence } from '@omnivate/shared';
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
  Sheet,
  Skeleton,
  Switch,
  TextAreaField,
  TextField,
  usePhone,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Navigate } from '../api';

type Role = { key: string; name: string; mfaRequired?: boolean };
type Person = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  totpEnabled: boolean;
  roles: Role[];
};
type SodRule = {
  id: string;
  actionA: string;
  actionB: string;
  description: string;
  enabled: boolean;
};

const STATUS_WORDS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
  invited: 'Invited',
  pending: 'Pending',
};

function statusWord(status: string): string {
  return (
    STATUS_WORDS[status] ??
    status.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function roleWord(role: { key?: string; name?: string }): string {
  return plainRoleName(role);
}

export function UsersScreen({ navigate }: { navigate: Navigate }) {
  const notify = useToast();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [rules, setRules] = useState<SodRule[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('sales_cashier');
  const [inviteUrl, setInviteUrl] = useState('');
  const [query, setQuery] = useState('');
  const [pendingDeactivate, setPendingDeactivate] = useState<Person | null>(null);
  const phone = usePhone();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [personOpen, setPersonOpen] = useState<Person | null>(null);
  const [sodOpen, setSodOpen] = useState(false);
  const [roleEdit, setRoleEdit] = useState<Person | null>(null);
  const [roleKey, setRoleKey] = useState('');
  const [ruleOpen, setRuleOpen] = useState(false);
  const [actionA, setActionA] = useState<string>(SOD_ACTIONS[0].key);
  const [actionB, setActionB] = useState<string>(SOD_ACTIONS[1].key);
  const [sodText, setSodText] = useState(() =>
    sodPreventionSentence(SOD_ACTIONS[0].key, SOD_ACTIONS[1].key),
  );
  const [sodEdited, setSodEdited] = useState(false);

  async function load() {
    const [usersResponse, rolesResponse, rulesResponse] = await Promise.all([
      api('/krn/users'),
      api('/krn/roles'),
      api('/krn/sod-rules'),
    ]);
    if (usersResponse.status === 401) {
      setPeople([]);
      setError('Sign in to see people at your company.');
      return;
    }
    if (usersResponse.status === 403) {
      setPeople([]);
      setError('Your role cannot open the people list.');
      return;
    }
    if (
      usersResponse.status !== 200 ||
      !usersResponse.body ||
      typeof usersResponse.body !== 'object'
    ) {
      setError(errorMessage(usersResponse.body, 'The people list did not load.'));
      return;
    }
    const payload = usersResponse.body as { users: Person[]; canManageUsers: boolean };
    setPeople(payload.users);
    setCanManage(payload.canManageUsers);
    setError('');
    if (
      rolesResponse.status === 200 &&
      rolesResponse.body &&
      typeof rolesResponse.body === 'object'
    ) {
      const listed = (rolesResponse.body as { roles: Role[] }).roles;
      setRoles(listed);
      if (listed[0] && !listed.some((role) => role.key === inviteRole)) {
        setInviteRole(listed[0].key);
      }
    }
    if (
      rulesResponse.status === 200 &&
      rulesResponse.body &&
      typeof rulesResponse.body === 'object'
    ) {
      setRules((rulesResponse.body as { rules: SodRule[] }).rules);
    }
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

  async function invite(event: FormEvent) {
    event.preventDefault();
    const { status, body } = await api('/krn/invites', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail, roleKey: inviteRole }),
    });
    if (status === 201 && body && typeof body === 'object' && 'inviteUrl' in body) {
      setInviteUrl((body as { inviteUrl: string }).inviteUrl);
      setInviteEmail('');
      notify({ title: 'Invite ready. Copy the link. No email was sent.' });
      return;
    }
    setError(errorMessage(body, 'The invite was not created.'));
  }

  async function assign(userId: string, nextRole: string) {
    const { status, body } = await api(`/krn/users/${userId}/role`, {
      method: 'POST',
      body: JSON.stringify({ roleKey: nextRole }),
    });
    if (status === 200) {
      notify({ title: 'Role updated.' });
      setRoleEdit(null);
      await load();
      return;
    }
    setError(errorMessage(body, 'The role was not changed.'));
  }

  async function deactivate(userId: string) {
    const { status, body } = await api(`/krn/users/${userId}/deactivate`, { method: 'POST' });
    if (status === 200) {
      notify({ title: 'Person deactivated. Their sessions are revoked.' });
      setPendingDeactivate(null);
      await load();
      return;
    }
    setError(errorMessage(body, 'That person was not deactivated.'));
  }

  async function resetMfa(userId: string) {
    const { status, body } = await api(`/krn/users/${userId}/mfa/reset`, { method: 'POST' });
    if (status === 200) {
      notify({ title: 'Authenticator reset. They will set it up at the next sign-in.' });
      await load();
      return;
    }
    setError(errorMessage(body, 'The authenticator was not reset.'));
  }

  function openRule() {
    const first = SOD_ACTIONS[0].key;
    const second = SOD_ACTIONS[1].key;
    setActionA(first);
    setActionB(second);
    setSodText(sodPreventionSentence(first, second));
    setSodEdited(false);
    setRuleOpen(true);
  }

  function chooseAction(which: 'a' | 'b', value: string) {
    const nextA = which === 'a' ? value : actionA;
    let nextB = which === 'b' ? value : actionB;
    if (nextA === nextB) {
      const other = SOD_ACTIONS.find((action) => action.key !== nextA);
      nextB = other?.key ?? nextB;
    }
    setActionA(nextA);
    setActionB(nextB);
    if (!sodEdited) {
      setSodText(sodPreventionSentence(nextA, nextB));
    }
  }

  async function addRule(event: FormEvent) {
    event.preventDefault();
    const { status, body } = await api('/krn/sod-rules', {
      method: 'POST',
      body: JSON.stringify({ actionA, actionB, description: sodText }),
    });
    if (status === 201) {
      notify({ title: 'Segregation rule saved.' });
      setRuleOpen(false);
      await load();
      return;
    }
    setError(errorMessage(body, 'The rule was not saved.'));
  }

  async function setRuleEnabled(rule: SodRule, enabled: boolean) {
    if (enabled) {
      const { status, body } = await api('/krn/sod-rules', {
        method: 'POST',
        body: JSON.stringify({
          actionA: rule.actionA,
          actionB: rule.actionB,
          description: rule.description,
        }),
      });
      if (status === 201) {
        notify({ title: 'Rule turned on.' });
        await load();
        return;
      }
      setError(errorMessage(body, 'The rule was not turned on.'));
      return;
    }
    const { status, body } = await api(`/krn/sod-rules/${rule.id}/disable`, { method: 'POST' });
    if (status === 200) {
      notify({ title: 'Rule turned off.' });
      await load();
      return;
    }
    setError(errorMessage(body, 'The rule was not turned off.'));
  }

  const visible = (people ?? []).filter((person) => {
    const haystack = `${person.displayName} ${person.email}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const secondChoices = SOD_ACTIONS.filter((action) => action.key !== actionA);

  return (
    <>
      <PageHeader
        title="People"
        description="Invite someone, choose their role, or turn off their sign-in."
        actions={
          phone && canManage ? (
            <Button onClick={() => setInviteOpen(true)}>Invite</Button>
          ) : undefined
        }
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
      {canManage && !phone ? (
        <Card title="Invite A Person">
          <Form onSubmit={invite}>
            <TextField
              label="Email"
              type="email"
              value={inviteEmail}
              onChange={setInviteEmail}
              required
            />
            <SelectField label="Role" value={inviteRole} onChange={setInviteRole}>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {roleWord(role)}
                  {role.mfaRequired ? ' · Authenticator Required' : ''}
                </option>
              ))}
            </SelectField>
            <Button type="submit">Create Invite Link</Button>
            {inviteUrl ? (
              <p>
                Invite link: <a href={inviteUrl}>{inviteUrl}</a>
              </p>
            ) : null}
          </Form>
        </Card>
      ) : null}
      <Card title={phone ? undefined : 'People At This Company'}>
        {people === null ? (
          <Skeleton lines={5} />
        ) : (
          <DataTable
            rows={visible}
            getRowId={(person) => person.id}
            query={query}
            onQueryChange={setQuery}
            searchPlaceholder="Search by name or email"
            onRow={phone ? (person) => setPersonOpen(person) : undefined}
            emptyTitle={people.length === 0 ? 'No people yet' : 'No one matches'}
            emptyBody={
              people.length === 0
                ? 'Sign in as an owner, then invite the first person.'
                : 'Try a different name or email.'
            }
            columns={
              phone
                ? [
                    {
                      key: 'name',
                      header: 'Name',
                      sortValue: (person) => person.displayName,
                      cell: (person) => person.displayName,
                    },
                    {
                      key: 'role',
                      header: 'Role',
                      cell: (person) =>
                        person.roles.map((role) => roleWord(role)).join(', ') || 'No Role',
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      sortValue: (person) => person.status,
                      cell: (person) => statusWord(person.status),
                    },
                  ]
                : [
                    {
                      key: 'name',
                      header: 'Name',
                      sortValue: (person) => person.displayName,
                      cell: (person) => (
                        <div>
                          <strong>{person.displayName}</strong>
                          <div className="ui-hint">{person.email}</div>
                        </div>
                      ),
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      sortValue: (person) => person.status,
                      cell: (person) => (
                        <Badge tone={person.status === 'active' ? 'ok' : 'neutral'}>
                          {statusWord(person.status)}
                        </Badge>
                      ),
                    },
                    {
                      key: 'role',
                      header: 'Role',
                      cell: (person) =>
                        person.roles.map((role) => roleWord(role)).join(', ') || 'No Role',
                    },
                    {
                      key: 'actions',
                      header: '',
                      cell: (person) =>
                        canManage && person.status === 'active' ? (
                          <MenuButton
                            label={`Actions for ${person.displayName}`}
                            items={[
                              {
                                label: 'Change Role',
                                onSelect: () => {
                                  setRoleKey(person.roles[0]?.key ?? roles[0]?.key ?? '');
                                  setRoleEdit(person);
                                },
                              },
                              {
                                label: 'Reset Authenticator',
                                onSelect: () => void resetMfa(person.id),
                              },
                              {
                                label: 'Deactivate',
                                tone: 'danger',
                                onSelect: () => setPendingDeactivate(person),
                              },
                            ]}
                          />
                        ) : person.totpEnabled ? (
                          <Badge>Authenticator On</Badge>
                        ) : null,
                    },
                  ]
            }
          />
        )}
      </Card>
      {phone && people && (people.length > 0 || canManage) ? (
        <button type="button" className="ui-section-link" onClick={() => setSodOpen(true)}>
          <span>Segregation Of Duties</span>
          <span>{rules.filter((rule) => rule.enabled).length} on</span>
        </button>
      ) : null}
      {!phone && people && (people.length > 0 || canManage) ? (
        <Card title="Segregation Of Duties">
          <p className="ui-hint">
            Some tasks must be done by two different people. For example, the person who adds a
            supplier should not also approve the payment.
          </p>
          {rules.length === 0 ? (
            <EmptyState
              title="No rules yet"
              body="Add a pair of actions that must stay apart."
              action={
                canManage ? (
                  <Button variant="secondary" onClick={openRule}>
                    Add Rule
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <ul className="ui-rule-list">
                {rules.map((rule) => (
                  <li key={rule.id}>
                    <p>{rule.description}</p>
                    <Switch
                      label={rule.description}
                      checked={rule.enabled}
                      disabled={!canManage}
                      onChange={(enabled) => void setRuleEnabled(rule, enabled)}
                    />
                  </li>
                ))}
              </ul>
              {canManage ? (
                <Button variant="secondary" onClick={openRule}>
                  Add Rule
                </Button>
              ) : null}
            </>
          )}
        </Card>
      ) : null}
      <DialogFrame
        open={ruleOpen}
        onOpenChange={setRuleOpen}
        title="Add Rule"
        description="Choose two actions that must be done by different people."
      >
        <Form onSubmit={addRule}>
          <SelectField
            label="First Action"
            value={actionA}
            onChange={(value) => chooseAction('a', value)}
          >
            {SOD_ACTIONS.map((action) => (
              <option key={action.key} value={action.key}>
                {action.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Second Action"
            value={actionB}
            onChange={(value) => chooseAction('b', value)}
          >
            {secondChoices.map((action) => (
              <option key={action.key} value={action.key}>
                {action.label}
              </option>
            ))}
          </SelectField>
          <TextAreaField
            label="What This Prevents"
            rows={3}
            value={sodText}
            onChange={(value) => {
              setSodEdited(true);
              setSodText(value);
            }}
          />
          <div className="ui-form-submit">
            <Button type="submit">Save Rule</Button>
          </div>
        </Form>
      </DialogFrame>
      <DialogFrame
        open={roleEdit !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRoleEdit(null);
          }
        }}
        title="Change Role"
        description={roleEdit ? roleEdit.displayName : undefined}
      >
        <Form
          onSubmit={() => {
            if (roleEdit) {
              void assign(roleEdit.id, roleKey);
            }
          }}
        >
          <SelectField label="Role" value={roleKey} onChange={setRoleKey}>
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {roleWord(role)}
              </option>
            ))}
          </SelectField>
          <div className="ui-form-submit">
            <Button type="submit">Save Role</Button>
          </div>
        </Form>
      </DialogFrame>
      <Sheet open={inviteOpen} onOpenChange={setInviteOpen} title="Invite A Person">
        <Form onSubmit={invite}>
          <TextField
            label="Email"
            type="email"
            value={inviteEmail}
            onChange={setInviteEmail}
            required
          />
          <SelectField label="Role" value={inviteRole} onChange={setInviteRole}>
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {roleWord(role)}
                {role.mfaRequired ? ' · Authenticator Required' : ''}
              </option>
            ))}
          </SelectField>
          <Button type="submit">Create Invite Link</Button>
          {inviteUrl ? (
            <p>
              Invite link: <a href={inviteUrl}>{inviteUrl}</a>
            </p>
          ) : null}
        </Form>
      </Sheet>
      <Sheet
        open={personOpen !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPersonOpen(null);
          }
        }}
        title={personOpen?.displayName ?? 'Person'}
      >
        {personOpen ? (
          <div className="ui-sheet-stack">
            <p>{personOpen.email}</p>
            <p>
              {personOpen.roles.map((role) => roleWord(role)).join(', ') || 'No Role'} ·{' '}
              {statusWord(personOpen.status)}
            </p>
            {canManage && personOpen.status === 'active' ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRoleKey(personOpen.roles[0]?.key ?? roles[0]?.key ?? '');
                    setRoleEdit(personOpen);
                    setPersonOpen(null);
                  }}
                >
                  Change Role
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void resetMfa(personOpen.id);
                    setPersonOpen(null);
                  }}
                >
                  Reset Authenticator
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setPendingDeactivate(personOpen);
                    setPersonOpen(null);
                  }}
                >
                  Deactivate
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </Sheet>
      <Sheet open={sodOpen} onOpenChange={setSodOpen} title="Segregation Of Duties">
        <p className="ui-hint">
          Some tasks must be done by two different people. For example, the person who adds a
          supplier should not also approve the payment.
        </p>
        {rules.length === 0 ? (
          <p>No rules yet.</p>
        ) : (
          <ul className="ui-rule-list">
            {rules.map((rule) => (
              <li key={rule.id}>
                <p>{rule.description}</p>
                <Switch
                  label={rule.description}
                  checked={rule.enabled}
                  disabled={!canManage}
                  onChange={(enabled) => void setRuleEnabled(rule, enabled)}
                />
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <Button variant="secondary" onClick={openRule}>
            Add Rule
          </Button>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={pendingDeactivate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeactivate(null);
          }
        }}
        title="Deactivate this person?"
        body="They will not be able to sign in, and their current sessions will end. You can still see them in the list."
        confirmLabel="Deactivate"
        onConfirm={() => {
          if (pendingDeactivate) {
            void deactivate(pendingDeactivate.id);
          }
        }}
      />
    </>
  );
}
