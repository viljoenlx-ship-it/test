import {
  DEMO_PASSWORD,
  INDUSTRY_PRESETS,
  describeActivity,
  getCommercialPackage,
  isPackageKey,
  platformOperator,
  type ColumnLayouts,
  type ModuleId,
} from '@omnivate/shared';
import {
  ActivityFeed,
  AppShell,
  AuthScreen,
  Badge,
  Button,
  Card,
  CommandPalette,
  ConfirmDialog,
  DataTable,
  DemoHint,
  DesignPreview,
  DialogFrame,
  Form,
  PageHeader,
  QrCode,
  SelectField,
  Skeleton,
  TextField,
  ToastProvider,
  usePhone,
  useToast,
  type FeedItem,
  type NavItem,
  type PaletteItem,
} from '@omnivate/ui';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage } from './api';
import { BuildProgress } from './BuildProgress';
import { ClientPage } from './ClientPage';
import { CompanyImport } from './import-page';
import './mfa-note.css';

const BASE = '/control';

type Session = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
};

type TenantSummary = {
  id: string;
  slug: string;
  companyName: string;
  displayName: string;
  status: string;
  industryPreset: string | null;
  packageKey: string;
  contactEmail: string | null;
};

function usePath() {
  const [href, setHref] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const sync = () => setHref(window.location.pathname + window.location.search);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const url = new URL(href, 'http://omnivate.local');
  const path = url.pathname.startsWith(BASE)
    ? url.pathname.slice(BASE.length) || '/'
    : url.pathname;
  const navigate = (to: string) => {
    const next = to.startsWith(BASE) ? to : `${BASE}${to.startsWith('/') ? to : `/${to}`}`;
    window.history.pushState({}, '', next);
    setHref(next);
  };
  return { path, search: url.search, navigate };
}

function showDemoHints(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_PREVIEW === 'true';
}

function toFeed(
  rows: {
    id: string;
    action: string;
    actorLabel: string;
    tenantName: string | null;
    occurredAt: string;
    beforeData?: unknown;
    afterData?: unknown;
  }[],
): FeedItem[] {
  return rows.map((row) => {
    const phrase = describeActivity(row.action, row.afterData);
    return {
      id: row.id,
      title: phrase.title,
      icon: phrase.icon,
      actor: row.actorLabel === 'system' ? 'Omnivate' : row.actorLabel,
      company: row.tenantName,
      occurredAt: row.occurredAt,
      rawAction: row.action,
      beforeData: row.beforeData,
      afterData: row.afterData,
    };
  });
}

function statusLabel(status: string): string {
  if (status === 'active') return 'Active';
  if (status === 'suspended') return 'Suspended';
  if (status === 'archived') return 'Archived';
  if (status === 'all') return 'All';
  return status;
}

export function App() {
  return (
    <ToastProvider>
      <ControlApp />
    </ToastProvider>
  );
}

function ControlApp() {
  const phone = usePhone();
  const { path, search, navigate } = usePath();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [palette, setPalette] = useState(false);
  const [companies, setCompanies] = useState<TenantSummary[]>([]);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [sessionNonce, setSessionNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api('/control/auth/session')
      .then(({ status, body }) => {
        if (cancelled) {
          return;
        }
        if (status === 200 && body && typeof body === 'object' && 'operator' in body) {
          const payload = body as {
            operator: { id: string; email: string; displayName: string; roles: string[] };
            permissions: string[];
          };
          setSession({ ...payload.operator, permissions: payload.permissions });
        } else {
          setSession(null);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, sessionNonce]);

  function signedIn() {
    setSessionNonce((value) => value + 1);
    if (path !== '/') {
      navigate('/');
    }
  }

  useEffect(() => {
    if (!session) {
      return;
    }
    const handle = window.setTimeout(() => {
      void api(`/control/tenants?q=${encodeURIComponent(paletteQuery)}&status=all`).then(
        ({ body }) => {
          if (body && typeof body === 'object' && 'tenants' in body) {
            setCompanies((body as { tenants: TenantSummary[] }).tenants);
          }
        },
      );
    }, 120);
    return () => window.clearTimeout(handle);
  }, [session, paletteQuery, palette]);

  const [clientName, setClientName] = useState('');
  const nav: NavItem[] = [
    {
      href: `${BASE}/`,
      label: 'Overview',
      icon: 'overview',
      current: path === '/',
      section: 'Clients',
    },
    {
      href: `${BASE}/tenants`,
      label: 'Clients',
      icon: 'companies',
      current: path.startsWith('/tenants'),
      section: 'Clients',
    },
    {
      href: `${BASE}/audit`,
      label: 'Audit Log',
      icon: 'audit',
      current: path === '/audit',
      section: 'Clients',
    },
  ];
  const crumbs =
    path === '/'
      ? [{ label: 'Overview' }]
      : path === '/tenants'
        ? [{ label: 'Clients' }]
        : path === '/tenants/new'
          ? [{ label: 'Clients', href: `${BASE}/tenants` }, { label: 'New Client' }]
          : path === '/audit'
            ? [{ label: 'Audit Log' }]
            : /\/import$/.test(path)
              ? [{ label: 'Clients', href: `${BASE}/tenants` }, { label: 'Import Data' }]
              : path.startsWith('/tenants/')
                ? [{ label: 'Clients', href: `${BASE}/tenants` }, { label: clientName || 'Client' }]
                : [{ label: 'Overview' }];

  const items: PaletteItem[] = useMemo(() => {
    const actions: PaletteItem[] = [
      { id: 'overview', group: 'Actions', label: 'Overview', onSelect: () => navigate('/') },
      {
        id: 'companies',
        group: 'Actions',
        label: 'Clients',
        onSelect: () => navigate('/tenants'),
      },
      {
        id: 'new',
        group: 'Actions',
        label: 'New Client',
        onSelect: () => navigate('/tenants/new'),
      },
      { id: 'audit', group: 'Actions', label: 'Audit Log', onSelect: () => navigate('/audit') },
    ];
    return [
      ...actions,
      ...companies.map((company) => ({
        id: company.id,
        group: 'Clients',
        label: company.companyName,
        hint: company.status,
        onSelect: () => navigate(`/tenants/${company.id}`),
      })),
    ];
  }, [companies, navigate]);

  let screen: ReactNode = <Skeleton lines={6} />;
  if (!ready) {
    screen = <Skeleton lines={6} />;
  } else if (path === '/login') {
    screen = <LoginScreen onDone={signedIn} />;
  } else if (path === '/mfa') {
    screen = <MfaScreen onDone={signedIn} />;
  } else if (!session) {
    screen = <LoginScreen onDone={signedIn} />;
  } else if (path === '/') {
    screen = <Dashboard navigate={navigate} />;
  } else if (path === '/tenants') {
    screen = <TenantList navigate={navigate} search={search} />;
  } else if (path === '/tenants/new') {
    screen = <NewTenant navigate={navigate} />;
  } else if (path === '/audit') {
    screen = <AuditScreen companies={companies} search={search} />;
  } else if (path === '/design-preview' && showDemoHints()) {
    screen = <DesignPreview />;
  } else if (path.startsWith('/tenants/')) {
    const importMatch = /^\/tenants\/([0-9a-f-]{36})\/import$/i.exec(path);
    screen = importMatch?.[1] ? (
      <CompanyImport id={importMatch[1]} />
    ) : (
      <TenantDetail id={path.slice('/tenants/'.length)} onNamed={setClientName} />
    );
  }

  if (phone) {
    return (
      <div className="ui-desk-note">
        <h1>Open This On A Computer</h1>
        <p>The control panel is for a desk. Sign in there to manage companies.</p>
      </div>
    );
  }

  if (!session || path === '/login' || path === '/mfa') {
    return screen;
  }

  return (
    <>
      <AppShell
        product="Control"
        plan="Platform"
        brandName="Omnivate"
        nav={nav}
        crumbs={crumbs}
        onNavigate={(href) => navigate(href.replace(BASE, '') || '/')}
        onSignOut={() => {
          void api('/control/auth/logout', { method: 'POST' }).then(() => navigate('/login'));
        }}
        onOpenPalette={() => setPalette(true)}
      >
        {screen}
      </AppShell>
      {session ? (
        <CommandPalette
          open={palette}
          onOpenChange={setPalette}
          items={items}
          query={paletteQuery}
          onQueryChange={setPaletteQuery}
        />
      ) : null}
    </>
  );
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { status, body } = await api('/control/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (status === 200 && body && typeof body === 'object' && 'step' in body) {
      const step = (body as { step: string }).step;
      if (step === 'mfa_enroll' || step === 'mfa_verify') {
        window.history.pushState({}, '', `${BASE}/mfa`);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      onDone();
      return;
    }
    setError(errorMessage(body, 'That email or password was not recognised.'));
  }

  return (
    <AuthScreen title="Sign In" lede="Omnivate control panel.">
      <Form onSubmit={onSubmit}>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          required
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        <button type="button" className="ui-text-link" onClick={() => setForgot(true)}>
          Forgot password?
        </button>
        {error ? (
          <p className="ui-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </Button>
      </Form>
      {showDemoHints() ? (
        <DemoHint>
          <p>
            Sample password <code>{DEMO_PASSWORD}</code>
          </p>
          <ul className="ui-demo-list">
            <li>
              <button
                type="button"
                className="ui-demo-person"
                onClick={() => {
                  setEmail(platformOperator.email);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                <strong>{platformOperator.displayName}</strong>
                <span className="ui-hint">{platformOperator.email}</span>
              </button>
            </li>
          </ul>
        </DemoHint>
      ) : null}
      <DialogFrame
        open={forgot}
        onOpenChange={setForgot}
        title="Forgot password?"
        description="Password reset is not available yet. Ask the platform owner for help."
      >
        <Button onClick={() => setForgot(false)}>Close</Button>
      </DialogFrame>
    </AuthScreen>
  );
}

function MfaScreen({ onDone }: { onDone: () => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api('/control/auth/mfa/pending').then(({ status, body }) => {
      if (status !== 200 || !body || typeof body !== 'object') {
        setMissing(true);
        return;
      }
      if ('secret' in body && typeof body.secret === 'string') {
        setSecret(body.secret);
      }
      if ('otpauthUrl' in body && typeof body.otpauthUrl === 'string') {
        setLink(body.otpauthUrl);
      }
    });
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const { status, body } = await api('/control/auth/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    if (status === 200) {
      onDone();
      return;
    }
    setError(errorMessage(body, 'That code was not accepted.'));
  }

  return (
    <AuthScreen
      title={secret ? 'Set Up Your Authenticator' : missing ? 'Sign In Again' : 'Enter Your Code'}
      lede={
        secret
          ? 'Add Omnivate Control to your authenticator app, then enter the code.'
          : 'Enter the code from your authenticator app.'
      }
    >
      {missing ? (
        <>
          <p>This step has expired.</p>
          <Button
            onClick={() => {
              window.history.pushState({}, '', `${BASE}/login`);
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
          >
            Back To Sign In
          </Button>
        </>
      ) : (
        <>
          {secret && link ? (
            <>
              <QrCode value={link} label="Authenticator Setup Code" />
              <p className="ui-hint">Scan this code, or type the key below.</p>
              <p className="ui-secret">{secret}</p>
            </>
          ) : null}
          <Form onSubmit={onSubmit}>
            <TextField
              label="6-Digit Code"
              value={code}
              onChange={setCode}
              inputMode="numeric"
              error={error}
            />
            <Button type="submit">Confirm</Button>
          </Form>
        </>
      )}
    </AuthScreen>
  );
}

function Dashboard({ navigate }: { navigate: (to: string) => void }) {
  const [data, setData] = useState<{
    tenantsActive: number;
    tenantsSuspended: number;
    users: number;
    mfaEnforcement?: 'on' | 'off';
    recent: {
      id: string;
      action: string;
      tenantName: string | null;
      actorLabel: string;
      occurredAt: string;
      beforeData?: unknown;
      afterData?: unknown;
    }[];
  } | null>(null);

  useEffect(() => {
    void api('/control/dashboard').then(({ body }) => {
      if (body && typeof body === 'object' && 'tenantsActive' in body) {
        setData(body as NonNullable<typeof data>);
      }
    });
  }, []);

  if (!data) {
    return <Skeleton lines={5} />;
  }

  return (
    <>
      <PageHeader
        title="Overview"
        description="A quick look at every client. Open a client to change their company, people, or modules."
        actions={<Button onClick={() => navigate('/tenants/new')}>New Client</Button>}
      />
      {data.mfaEnforcement === 'off' ? (
        <p className="mfa-off-note" role="status">
          Two-step sign-in is switched off on this preview
        </p>
      ) : null}
      <div className={data.tenantsSuspended > 0 ? 'ui-banner warn' : 'ui-banner'}>
        <strong>
          {data.tenantsSuspended > 0
            ? data.tenantsSuspended === 1
              ? '1 client is suspended'
              : `${data.tenantsSuspended} clients are suspended`
            : 'Everything looks good'}
        </strong>
        {data.tenantsSuspended > 0 ? (
          <Button variant="secondary" onClick={() => navigate('/tenants?status=suspended')}>
            Review
          </Button>
        ) : null}
      </div>
      <div className="ui-grid stats">
        <button
          type="button"
          className="ui-stat-button"
          onClick={() => navigate('/tenants?status=active')}
        >
          <Card>
            <div className="ui-stat">
              <strong>{data.tenantsActive}</strong>
              <span>Active Clients</span>
            </div>
          </Card>
        </button>
        <button
          type="button"
          className="ui-stat-button"
          onClick={() => navigate('/tenants?status=suspended')}
        >
          <Card>
            <div className="ui-stat">
              <strong>{data.tenantsSuspended}</strong>
              <span>Suspended</span>
            </div>
          </Card>
        </button>
        <button
          type="button"
          className="ui-stat-button"
          onClick={() => navigate('/tenants?status=all')}
        >
          <Card>
            <div className="ui-stat">
              <strong>{data.users}</strong>
              <span>People Who Can Sign In</span>
            </div>
          </Card>
        </button>
      </div>
      <BuildProgress />
      <Card title="Recent Activity">
        <ActivityFeed
          items={toFeed(data.recent)}
          emptyTitle="No activity yet"
          emptyBody="When you add or change a company, it will show up here."
        />
      </Card>
    </>
  );
}

function TenantList({ navigate, search }: { navigate: (to: string) => void; search: string }) {
  const initialStatus = new URLSearchParams(search).get('status') ?? 'open';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(
    ['open', 'active', 'suspended', 'archived', 'all'].includes(initialStatus)
      ? initialStatus
      : 'open',
  );
  const [rows, setRows] = useState<TenantSummary[] | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void api(`/control/tenants?q=${encodeURIComponent(query)}&status=${status}`).then(
        ({ body }) => {
          if (body && typeof body === 'object' && 'tenants' in body) {
            setRows((body as { tenants: TenantSummary[] }).tenants);
          }
        },
      );
    }, 120);
    return () => window.clearTimeout(handle);
  }, [query, status]);

  useEffect(() => {
    const next = new URLSearchParams(search).get('status') ?? 'open';
    if (['open', 'active', 'suspended', 'archived', 'all'].includes(next)) {
      setStatus(next);
    }
  }, [search]);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Choose a client to change their company, people, modules, and the columns they see. Archived clients stay in the record. Nothing is deleted."
        actions={<Button onClick={() => navigate('/tenants/new')}>New Client</Button>}
      />
      <Card>
        <div className="ui-actions" style={{ marginBottom: 12 }}>
          {['open', 'active', 'suspended', 'archived', 'all'].map((item) => (
            <Button
              key={item}
              variant={status === item ? 'primary' : 'secondary'}
              onClick={() => {
                setStatus(item);
                navigate(`/tenants?status=${item}`);
              }}
            >
              {item === 'open' ? 'Not archived' : statusLabel(item)}
            </Button>
          ))}
        </div>
        <DataTable
          rows={rows ?? []}
          getRowId={(row) => row.id}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Search clients"
          emptyTitle={rows === null ? 'Loading' : 'No clients'}
          emptyBody={rows === null ? 'Fetching clients.' : 'Add a client, or clear the search.'}
          onRow={(row) => navigate(`/tenants/${row.id}`)}
          columns={[
            {
              key: 'name',
              header: 'Company',
              sortValue: (row) => row.companyName,
              cell: (row) => (
                <div>
                  <strong>{row.companyName}</strong>
                  <div className="ui-hint">{row.slug}</div>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              sortValue: (row) => row.status,
              cell: (row) => (
                <Badge
                  tone={
                    row.status === 'active' ? 'ok' : row.status === 'suspended' ? 'warn' : 'neutral'
                  }
                >
                  {statusLabel(row.status)}
                </Badge>
              ),
            },
            {
              key: 'package',
              header: 'Package',
              sortValue: (row) => row.packageKey,
              cell: (row) =>
                isPackageKey(row.packageKey)
                  ? getCommercialPackage(row.packageKey).name
                  : row.packageKey,
            },
          ]}
        />
        <p className="ui-hint">Click a client, or press Ctrl K and type their name.</p>
      </Card>
    </>
  );
}

function NewTenant({ navigate }: { navigate: (to: string) => void }) {
  const notify = useToast();
  const [form, setForm] = useState({
    companyName: '',
    slug: '',
    legalName: '',
    tradingName: '',
    registrationNumber: '',
    vatNumber: '',
    contactEmail: '',
    contactPhone: '',
    addressLine1: '',
    city: '',
    province: '',
    postalCode: '',
    country: 'ZA',
    industryPreset: 'retail_hardware',
  });
  const [error, setError] = useState('');

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit() {
    setError('');
    const { status, body } = await api('/control/tenants', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (status === 201 && body && typeof body === 'object' && 'id' in body) {
      notify({ title: 'Company created. Identity is on. Nothing else is switched on yet.' });
      navigate(`/tenants/${(body as { id: string }).id}`);
      return;
    }
    setError(errorMessage(body, 'The company was not created.'));
  }

  return (
    <>
      <PageHeader
        title="New Client"
        description="Add the company. You can change these details later."
        breadcrumbs={[{ label: 'Clients', href: '/control/tenants' }, { label: 'New Client' }]}
        onNavigate={(href) => navigate(href.replace(BASE, '') || '/')}
      />
      <Card>
        <Form onSubmit={() => void onSubmit()}>
          <TextField
            label="Company Name"
            value={form.companyName}
            onChange={(value) => set('companyName', value)}
            required
          />
          <TextField
            label="Company Code"
            hint="Used in links. Lowercase, such as north-wind."
            value={form.slug}
            onChange={(value) => set('slug', value)}
            required
          />
          <TextField
            label="Legal Name"
            value={form.legalName}
            onChange={(value) => set('legalName', value)}
          />
          <TextField
            label="Trading Name"
            value={form.tradingName}
            onChange={(value) => set('tradingName', value)}
          />
          <TextField
            label="Registration Number"
            value={form.registrationNumber}
            onChange={(value) => set('registrationNumber', value)}
          />
          <TextField
            label="VAT Number"
            value={form.vatNumber}
            onChange={(value) => set('vatNumber', value)}
          />
          <TextField
            label="Contact Email"
            value={form.contactEmail}
            onChange={(value) => set('contactEmail', value)}
          />
          <TextField
            label="Phone"
            value={form.contactPhone}
            onChange={(value) => set('contactPhone', value)}
          />
          <TextField
            label="Address"
            value={form.addressLine1}
            onChange={(value) => set('addressLine1', value)}
          />
          <TextField label="City" value={form.city} onChange={(value) => set('city', value)} />
          <TextField
            label="Province"
            value={form.province}
            onChange={(value) => set('province', value)}
          />
          <TextField
            label="Postal Code"
            value={form.postalCode}
            onChange={(value) => set('postalCode', value)}
          />
          <TextField
            label="Country"
            value={form.country}
            onChange={(value) => set('country', value)}
            hint="ZA is South Africa."
          />
          <SelectField
            label="Industry Preset"
            value={form.industryPreset}
            onChange={(value) => set('industryPreset', value)}
          >
            {INDUSTRY_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.name}
              </option>
            ))}
          </SelectField>
          {error ? (
            <p className="ui-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit">Create Client</Button>
        </Form>
      </Card>
    </>
  );
}

type TenantDetail = {
  id: string;
  slug: string;
  companyName: string;
  displayName: string;
  legalName: string | null;
  tradingName: string | null;
  registrationNumber: string | null;
  vatNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  industryPreset: string | null;
  status: string;
  packageKey: string;
  branding: { displayName: string; primary: string; accent: string; hasLogo: boolean };
  settings: {
    currencyCode: string;
    vatRateBasisPoints: number;
    timeZone: string;
    financialYearStartMonth: number;
  };
  partyCounts?: {
    active: number;
    archived: number;
    customers: number;
    suppliers: number;
    staff: number;
    other: number;
  };
  modules: {
    id: ModuleId;
    name: string;
    domain: string;
    packaging: string;
    active: boolean;
    canDisable: boolean;
    summary: string;
  }[];
  columnLayouts?: ColumnLayouts;
};

function TenantDetail({ id, onNamed }: { id: string; onNamed: (name: string) => void }) {
  const notify = useToast();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [confirm, setConfirm] = useState<null | {
    title: string;
    body: string;
    run: () => Promise<void>;
  }>(null);
  async function reload() {
    const { body, status } = await api(`/control/tenants/${id}`);
    if (status === 200 && body && typeof body === 'object' && 'modules' in body) {
      const next = body as TenantDetail;
      setTenant(next);
      onNamed(next.companyName);
    }
  }

  useEffect(() => {
    void reload();
  }, [id, onNamed]);

  if (!tenant) {
    return <Skeleton lines={8} />;
  }

  async function post(path: string) {
    const { status, body } = await api(path, { method: 'POST', body: '{}' });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'That change was not saved.'), tone: 'bad' });
      return;
    }
    notify({ title: 'Saved.' });
    await reload();
  }

  return (
    <>
      <ClientPage
        tenant={tenant}
        onReload={reload}
        onSuspend={() =>
          setConfirm({
            title: 'Suspend this client?',
            body: 'People at this company will not be able to sign in until you reactivate it.',
            run: () => post(`/control/tenants/${id}/suspend`),
          })
        }
        onReactivate={() => void post(`/control/tenants/${id}/reactivate`)}
        onArchive={() =>
          setConfirm({
            title: 'Archive this client?',
            body: 'The client stays in the record. It is not deleted. People cannot sign in.',
            run: () => post(`/control/tenants/${id}/archive`),
          })
        }
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null);
          }
        }}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel="Confirm"
        onConfirm={() => {
          const action = confirm?.run;
          setConfirm(null);
          if (action) {
            void action();
          }
        }}
      />
    </>
  );
}

function AuditScreen({ companies, search }: { companies: TenantSummary[]; search: string }) {
  const initialTenant = new URLSearchParams(search).get('tenantId') ?? '';
  const [tenantId, setTenantId] = useState(initialTenant);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState<
    {
      id: string;
      action: string;
      tenantName: string | null;
      actorLabel: string;
      occurredAt: string;
      beforeData: unknown;
      afterData: unknown;
    }[]
  >([]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (tenantId) {
      params.set('tenantId', tenantId);
    }
    if (actor) {
      params.set('actor', actor);
    }
    if (from) {
      params.set('from', from);
    }
    if (to) {
      params.set('to', to);
    }
    void api(`/control/audit?${params.toString()}`).then(({ body }) => {
      if (body && typeof body === 'object' && 'events' in body) {
        setEvents((body as { events: typeof events }).events);
      }
    });
  }, [tenantId, actor, from, to]);

  const visible = events.filter((event) =>
    describeActivity(event.action, event.afterData)
      .title.toLowerCase()
      .includes(action.trim().toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="What changed, who did it, and when. Open a row to read it in plain words."
      />
      <Card>
        <div className="ui-form">
          <SelectField label="Company" value={tenantId} onChange={setTenantId}>
            <option value="">All Companies</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.companyName}
              </option>
            ))}
          </SelectField>
          <TextField label="Person" value={actor} onChange={setActor} hint="Name or email" />
          <TextField
            label="What Happened"
            value={action}
            onChange={setAction}
            hint="For example Signed in"
          />
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="To" type="date" value={to} onChange={setTo} />
        </div>
        <ActivityFeed
          items={toFeed(visible)}
          emptyTitle="Nothing matches"
          emptyBody="Try a different company, person, or date."
        />
      </Card>
    </>
  );
}
