import {
  ACCESS_ROLES,
  ACCESS_SCOPES,
  COLUMN_TABLES,
  INDUSTRY_PRESETS,
  columnHeading,
  describeActivity,
  defaultColumnLayouts,
  financialYearLabel,
  getCommercialPackage,
  isPackageKey,
  MODULE_AREAS,
  moduleById,
  moduleIndex,
  plainRoleName,
  type ColumnLayouts,
  type ColumnTableKey,
  type ModuleId,
  type RoleKey,
} from '@omnivate/shared';
import {
  ActivityFeed,
  Badge,
  Button,
  Card,
  DataTable,
  DialogFrame,
  EmptyState,
  Form,
  MenuButton,
  SelectField,
  Skeleton,
  Switch,
  TextField,
  useToast,
  type FeedItem,
} from '@omnivate/ui';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { api, errorMessage } from './api';
import { BranchesPanel } from './BranchesPanel';
import { AutomationsPanel } from './AutomationsPanel';
import { FieldsPanel } from './FieldsPanel';
import { CompanyImport } from './import-page';
import { ReportsPanel } from './ReportsPanel';

type Tenant = {
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
  columnLayouts?: ColumnLayouts;
  modules: {
    id: ModuleId;
    name: string;
    domain: string;
    active: boolean;
    canDisable: boolean;
    summary: string;
  }[];
};

const SWATCHES = ['#171717', '#281878', '#4020a0', '#0f6b4c', '#8a5a12', '#8f3044', '#3f3f46'];

const TABS = [
  ['company', 'Company & Branding'],
  ['modules', 'Modules'],
  ['reports', 'Reports'],
  ['columns', 'Screens & Columns'],
  ['users', 'People'],
  ['fields', 'Custom Fields'],
  ['automations', 'Automations'],
  ['branches', 'Branches'],
  ['import', 'Import Data'],
  ['audit', 'Audit Log'],
] as const;

type Tab = (typeof TABS)[number][0];

function statusLabel(status: string): string {
  if (status === 'active') return 'Active';
  if (status === 'suspended') return 'Suspended';
  if (status === 'archived') return 'Archived';
  return status;
}

function markLetters(name: string): string {
  const words = name
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !['pty', 'ltd'].includes(word.toLowerCase()));
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '');
  return letters.join('') || name.slice(0, 1).toUpperCase();
}

function colourChoices(selected: string): string[] {
  const colour = selected.toLowerCase();
  return SWATCHES.includes(colour) ? SWATCHES : [colour, ...SWATCHES];
}

export function ClientPage({
  tenant,
  onReload,
  onSuspend,
  onReactivate,
  onArchive,
}: {
  tenant: Tenant;
  onReload: () => Promise<void>;
  onSuspend: () => void;
  onReactivate: () => void;
  onArchive: () => void;
}) {
  const notify = useToast();
  const [tab, setTab] = useState<Tab>('company');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [people, setPeople] = useState<number | null>(null);

  useEffect(() => {
    void api(`/control/tenants/${tenant.id}/users`).then(({ body }) => {
      if (body && typeof body === 'object' && 'users' in body) {
        setPeople((body as { users: unknown[] }).users.length);
      }
    });
  }, [tenant.id]);

  const onCount = tenant.modules.filter((module) => module.active).length;
  const packageName = isPackageKey(tenant.packageKey)
    ? getCommercialPackage(tenant.packageKey).name
    : tenant.packageKey;
  const logo = tenant.branding.hasLogo ? `/api/branding/${tenant.slug}/logo` : null;

  function preview() {
    setPreviewBusy(true);
    void api(`/control/tenants/${tenant.id}/client-preview`, {
      method: 'POST',
      body: '{}',
    }).then(({ status, body }) => {
      setPreviewBusy(false);
      const url =
        body && typeof body === 'object' && 'previewUrl' in body
          ? (body as { previewUrl?: unknown }).previewUrl
          : null;
      if (status >= 400 || typeof url !== 'string') {
        notify({ title: errorMessage(body, 'The preview did not open.'), tone: 'bad' });
        return;
      }
      window.location.assign(url);
    });
  }

  return (
    <div className="client-page">
      <section className="client-hero ui-card">
        <div className="client-hero-id">
          {logo ? (
            <img className="client-logo" src={logo} alt="" />
          ) : (
            <span className="client-logo client-logo-fallback" aria-hidden="true">
              {tenant.companyName.slice(0, 1)}
            </span>
          )}
          <div>
            <h1>{tenant.companyName}</h1>
            <div className="ui-chips">
              <span className="ui-chip quiet">{statusLabel(tenant.status)}</span>
              <span className="ui-chip quiet">{packageName}</span>
            </div>
            <p className="ui-hint">
              {onCount} of {tenant.modules.length} modules on · {people ?? '…'} people ·{' '}
              {packageName}
            </p>
          </div>
        </div>
        <div className="client-hero-actions">
          <Button disabled={previewBusy} onClick={preview}>
            {previewBusy ? 'Opening Preview…' : 'Preview Client App'}
          </Button>
          {tenant.status === 'active' ? (
            <Button variant="secondary" onClick={onSuspend}>
              Suspend Client
            </Button>
          ) : (
            <Button variant="secondary" onClick={onReactivate}>
              Reactivate Client
            </Button>
          )}
          {tenant.status !== 'archived' ? (
            <Button variant="ghost" onClick={onArchive}>
              Archive Client
            </Button>
          ) : null}
        </div>
      </section>

      <div className="client-tabs" role="tablist" aria-label="Client Sections">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'is-on' : undefined}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'company' ? <CompanyTab tenant={tenant} onReload={onReload} /> : null}
      {tab === 'modules' ? <ModulesTab tenant={tenant} onReload={onReload} /> : null}
      {tab === 'reports' ? <ReportsPanel tenantId={tenant.id} /> : null}
      {tab === 'columns' ? (
        <ColumnsTab tenantId={tenant.id} initial={tenant.columnLayouts} onReload={onReload} />
      ) : null}
      {tab === 'users' ? <UsersTab tenant={tenant} /> : null}
      {tab === 'fields' ? <FieldsPanel tenantId={tenant.id} /> : null}
      {tab === 'automations' ? <AutomationsPanel tenantId={tenant.id} /> : null}
      {tab === 'branches' ? <BranchesPanel tenantId={tenant.id} /> : null}
      {tab === 'import' ? <CompanyImport id={tenant.id} /> : null}
      {tab === 'audit' ? <AuditTab tenantId={tenant.id} companyName={tenant.companyName} /> : null}
    </div>
  );
}

function CompanyTab({ tenant, onReload }: { tenant: Tenant; onReload: () => Promise<void> }) {
  const notify = useToast();
  const [form, setForm] = useState({
    companyName: tenant.companyName,
    slug: tenant.slug,
    legalName: tenant.legalName ?? '',
    tradingName: tenant.tradingName ?? '',
    registrationNumber: tenant.registrationNumber ?? '',
    vatNumber: tenant.vatNumber ?? '',
    contactEmail: tenant.contactEmail ?? '',
    contactPhone: tenant.contactPhone ?? '',
    addressLine1: tenant.addressLine1 ?? '',
    city: tenant.city ?? '',
    province: tenant.province ?? '',
    postalCode: tenant.postalCode ?? '',
    country: tenant.country,
    industryPreset: tenant.industryPreset ?? 'retail_hardware',
    currencyCode: tenant.settings.currencyCode,
    financialYearStartMonth: String(tenant.settings.financialYearStartMonth),
    displayName: tenant.branding.displayName,
    primary: tenant.branding.primary,
    accent: tenant.branding.accent,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [removeSavedLogo, setRemoveSavedLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(
    tenant.branding.hasLogo ? `/api/branding/${tenant.slug}/logo` : null,
  );
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (logoFile || removeSavedLogo) {
      return;
    }
    setLogoPreview(tenant.branding.hasLogo ? `/api/branding/${tenant.slug}/logo` : null);
  }, [logoFile, removeSavedLogo, tenant.branding.hasLogo, tenant.slug]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError('');
    const particulars = await api(`/control/tenants/${tenant.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        companyName: form.companyName,
        slug: form.slug,
        legalName: form.legalName,
        tradingName: form.tradingName,
        registrationNumber: form.registrationNumber,
        vatNumber: form.vatNumber,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        addressLine1: form.addressLine1,
        city: form.city,
        province: form.province,
        postalCode: form.postalCode,
        country: form.country,
        industryPreset: form.industryPreset,
      }),
    });
    if (particulars.status >= 400) {
      setBusy(false);
      setError(errorMessage(particulars.body, 'The company was not saved.'));
      return;
    }
    const settings = await api(`/control/tenants/${tenant.id}/settings`, {
      method: 'PUT',
      body: JSON.stringify({
        currencyCode: form.currencyCode,
        vatRateBasisPoints: tenant.settings.vatRateBasisPoints,
        timeZone: tenant.settings.timeZone,
        financialYearStartMonth: Number(form.financialYearStartMonth),
      }),
    });
    if (settings.status >= 400) {
      setBusy(false);
      setError(errorMessage(settings.body, 'The company settings were not saved.'));
      return;
    }
    const branding = await api(`/control/tenants/${tenant.id}/branding`, {
      method: 'PUT',
      body: JSON.stringify({
        displayName: form.displayName,
        primary: form.primary,
        accent: form.accent,
      }),
    });
    if (branding.status >= 400) {
      setBusy(false);
      setError(errorMessage(branding.body, 'The branding was not saved.'));
      return;
    }
    if (logoFile) {
      const data = new FormData();
      data.set('file', logoFile);
      const logo = await api(`/control/tenants/${tenant.id}/logo`, { method: 'POST', body: data });
      if (logo.status >= 400) {
        setBusy(false);
        setError(errorMessage(logo.body, 'The logo was not saved.'));
        return;
      }
    } else if (removeSavedLogo) {
      const removed = await api(`/control/tenants/${tenant.id}/logo`, { method: 'DELETE' });
      if (removed.status >= 400) {
        setBusy(false);
        setError(errorMessage(removed.body, 'The logo was not removed.'));
        return;
      }
    }
    setLogoFile(null);
    setRemoveSavedLogo(false);
    setBusy(false);
    notify({ title: 'Company settings saved.' });
    await onReload();
  }

  return (
    <Card>
      <Form onSubmit={() => void save()}>
        <div className="client-split">
          <div className="ui-stack">
            <h2>Company Profile</h2>
            <TextField
              label="Legal Name"
              value={form.legalName}
              onChange={(v) => set('legalName', v)}
            />
            <TextField
              label="Trading As"
              value={form.tradingName}
              onChange={(v) => set('tradingName', v)}
            />
            <TextField
              label="Company Name"
              value={form.companyName}
              onChange={(v) => set('companyName', v)}
            />
            <TextField label="Company Code" value={form.slug} onChange={(v) => set('slug', v)} />
            <TextField
              label="Registration No."
              value={form.registrationNumber}
              onChange={(v) => set('registrationNumber', v)}
            />
            <TextField
              label="VAT No."
              value={form.vatNumber}
              onChange={(v) => set('vatNumber', v)}
            />
            <TextField
              label="Currency"
              value={form.currencyCode}
              onChange={(v) => set('currencyCode', v)}
            />
            <SelectField
              label="Fiscal Year Start"
              value={form.financialYearStartMonth}
              onChange={(v) => set('financialYearStartMonth', v)}
            >
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index + 1} value={String(index + 1)}>
                  {financialYearLabel(index + 1)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Industry"
              value={form.industryPreset}
              onChange={(v) => set('industryPreset', v)}
            >
              {INDUSTRY_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.name}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Email"
              value={form.contactEmail}
              onChange={(v) => set('contactEmail', v)}
            />
            <TextField
              label="Phone"
              value={form.contactPhone}
              onChange={(v) => set('contactPhone', v)}
            />
            <TextField
              label="Address"
              value={form.addressLine1}
              onChange={(v) => set('addressLine1', v)}
            />
            <TextField label="City" value={form.city} onChange={(v) => set('city', v)} />
            <TextField
              label="Province"
              value={form.province}
              onChange={(v) => set('province', v)}
            />
            <TextField
              label="Postal Code"
              value={form.postalCode}
              onChange={(v) => set('postalCode', v)}
            />
            <TextField label="Country" value={form.country} onChange={(v) => set('country', v)} />
          </div>
          <div className="brand-column">
            <h2>Branding</h2>
            <div className="logo-upload">
              {logoPreview ? (
                <img className="logo-tile" src={logoPreview} alt="" />
              ) : (
                <span className="logo-tile" aria-hidden="true">
                  {markLetters(form.companyName || tenant.companyName)}
                </span>
              )}
              <div className="logo-upload-actions">
                <Button variant="secondary" onClick={() => logoInput.current?.click()}>
                  Upload Logo
                </Button>
                <Button
                  variant="secondary"
                  disabled={!logoPreview && !removeSavedLogo}
                  onClick={() => {
                    if (logoPreview?.startsWith('blob:')) {
                      URL.revokeObjectURL(logoPreview);
                    }
                    setLogoFile(null);
                    setLogoPreview(null);
                    if (logoInput.current) {
                      logoInput.current.value = '';
                    }
                    if (tenant.branding.hasLogo) {
                      setRemoveSavedLogo(true);
                    }
                  }}
                >
                  Remove
                </Button>
                <input
                  ref={logoInput}
                  className="ui-sr"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (!file) {
                      return;
                    }
                    if (logoPreview?.startsWith('blob:')) {
                      URL.revokeObjectURL(logoPreview);
                    }
                    setLogoFile(file);
                    setRemoveSavedLogo(false);
                    setLogoPreview(URL.createObjectURL(file));
                  }}
                />
              </div>
            </div>
            <TextField
              label="Sign-in Name"
              value={form.displayName}
              onChange={(v) => set('displayName', v)}
            />
            <div>
              <span className="ui-field-label">Primary Colour</span>
              <div className="swatches">
                {colourChoices(form.primary).map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    className={form.primary.toLowerCase() === colour ? 'is-on' : undefined}
                    style={{ background: colour }}
                    aria-label={colour}
                    aria-pressed={form.primary.toLowerCase() === colour}
                    onClick={() => set('primary', colour)}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="ui-field-label">Accent Colour</span>
              <div className="swatches">
                {colourChoices(form.accent).map((colour) => (
                  <button
                    key={`accent-${colour}`}
                    type="button"
                    className={form.accent.toLowerCase() === colour ? 'is-on' : undefined}
                    style={{ background: colour }}
                    aria-label={colour}
                    aria-pressed={form.accent.toLowerCase() === colour}
                    onClick={() => set('accent', colour)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        {error ? (
          <p className="ui-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save Company Settings'}
        </Button>
      </Form>
    </Card>
  );
}

function ModulesTab({ tenant, onReload }: { tenant: Tenant; onReload: () => Promise<void> }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const catalog = moduleIndex();
  const readyIds = catalog.filter((entry) => entry.built).map((entry) => entry.id);
  const onCount = tenant.modules.filter((module) => module.active).length;

  async function setModule(moduleId: ModuleId, active: boolean) {
    const preview = await api(
      `/control/tenants/${tenant.id}/modules/preview?moduleId=${moduleId}&active=${active}`,
    );
    const pulled =
      preview.body && typeof preview.body === 'object' && 'pulledIn' in preview.body
        ? ((preview.body as { pulledIn?: string[] }).pulledIn ?? [])
        : [];
    const { status, body } = await api(`/control/tenants/${tenant.id}/modules`, {
      method: 'POST',
      body: JSON.stringify({ moduleId, active, confirm: true }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'That module was not changed.'), tone: 'bad' });
      return;
    }
    if (pulled.length > 0) {
      notify({ title: 'The required modules were switched on with it.' });
    }
    await onReload();
  }

  async function run(ids: ModuleId[], active: boolean) {
    setBusy(true);
    for (const moduleId of ids) {
      const row = tenant.modules.find((module) => module.id === moduleId);
      if (!row || row.active === active || (!row.canDisable && !active)) {
        continue;
      }
      await api(`/control/tenants/${tenant.id}/modules`, {
        method: 'POST',
        body: JSON.stringify({ moduleId, active, confirm: true }),
      });
    }
    setBusy(false);
    await onReload();
  }

  return (
    <div className="ui-stack">
      <div className="client-module-head">
        <h2>
          {onCount} of {tenant.modules.length} modules on
        </h2>
        <div className="ui-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(['KRN-02', 'KRN-03', 'KRN-04', 'KRN-06', 'ANA-03'], true).then(() =>
                run(['SCM-01'], false),
              )
            }
          >
            Core Only
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void run(readyIds, true)}>
            Turn On Ready
          </Button>
        </div>
      </div>
      <DocumentCapturePanel tenantId={tenant.id} />
      {MODULE_AREAS.map((area) => {
        const rows = catalog.filter((entry) => entry.area === area);
        const on = rows.filter(
          (entry) => tenant.modules.find((module) => module.id === entry.id)?.active,
        ).length;
        return (
          <section key={area}>
            <h3 className="client-section">
              {area} {on}/{rows.length} on
            </h3>
            <div className="ui-stack">
              {rows.map((entry) => {
                const module = tenant.modules.find((item) => item.id === entry.id);
                if (!module) {
                  return null;
                }
                return (
                  <article
                    key={entry.id}
                    className={module.active ? 'module-row' : 'module-row is-off'}
                  >
                    <div>
                      <strong>{entry.name}</strong>
                      {entry.built ? null : <Badge tone="neutral">Coming Soon</Badge>}
                      <p>{entry.summary}</p>
                    </div>
                    <Switch
                      label={`${entry.name} ${module.active ? 'on' : 'off'}`}
                      checked={module.active}
                      disabled={!module.canDisable && module.active}
                      onChange={(checked) => void setModule(module.id, checked)}
                    />
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DocumentCapturePanel({ tenantId }: { tenantId: string }) {
  const notify = useToast();
  const [row, setRow] = useState<{
    enabled: boolean;
    reader: 'standard' | 'premium';
    note: string | null;
    pagesReadStandard: number;
    pagesReadPremium: number;
    periodLabel: string;
  } | null>(null);

  useEffect(() => {
    let cancel = false;
    void api(`/control/tenants/${tenantId}/document-capture`).then(({ status, body }) => {
      if (cancel || status !== 200 || !body || typeof body !== 'object' || !('enabled' in body)) {
        return;
      }
      setRow(
        body as {
          enabled: boolean;
          reader: 'standard' | 'premium';
          note: string | null;
          pagesReadStandard: number;
          pagesReadPremium: number;
          periodLabel: string;
        },
      );
    });
    return () => {
      cancel = true;
    };
  }, [tenantId]);

  async function save(next: { enabled: boolean; reader: 'standard' | 'premium' }) {
    const { status, body } = await api(`/control/tenants/${tenantId}/document-capture`, {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    if (status >= 400 || !body || typeof body !== 'object' || !('enabled' in body)) {
      notify({ title: errorMessage(body, 'Document capture was not changed.'), tone: 'bad' });
      return;
    }
    setRow(
      body as {
        enabled: boolean;
        reader: 'standard' | 'premium';
        note: string | null;
        pagesReadStandard: number;
        pagesReadPremium: number;
        periodLabel: string;
      },
    );
  }

  if (!row) {
    return null;
  }

  return (
    <section>
      <h3 className="client-section">Document Capture</h3>
      <article className={row.enabled ? 'module-row' : 'module-row is-off'}>
        <div>
          <strong>Document Capture</strong>
          <p>Read supplier invoices and delivery notes into stock receipts.</p>
          <fieldset className="doc-reader-choice">
            <legend>Reader</legend>
            <label>
              <input
                type="radio"
                name={`reader-${tenantId}`}
                checked={row.reader === 'standard'}
                onChange={() => void save({ enabled: row.enabled, reader: 'standard' })}
              />
              Standard Reader (Included)
            </label>
            <label>
              <input
                type="radio"
                name={`reader-${tenantId}`}
                checked={row.reader === 'premium'}
                onChange={() => void save({ enabled: row.enabled, reader: 'premium' })}
              />
              Premium Reader (Extra Fee)
            </label>
          </fieldset>
          {row.note ? <p className="doc-note">{row.note}</p> : null}
          <p className="ui-hint">Pages Read in {row.periodLabel}</p>
          <p className="ui-hint">Standard Reader: {row.pagesReadStandard}</p>
          <p className="ui-hint">Premium Reader: {row.pagesReadPremium}</p>
        </div>
        <Switch
          label={`Document Capture ${row.enabled ? 'on' : 'off'}`}
          checked={row.enabled}
          onChange={(checked) => void save({ enabled: checked, reader: row.reader })}
        />
      </article>
    </section>
  );
}

function ColumnsTab({
  tenantId,
  initial,
  onReload,
}: {
  tenantId: string;
  initial: ColumnLayouts | undefined;
  onReload: () => Promise<void>;
}) {
  const notify = useToast();
  const [layouts, setLayouts] = useState<ColumnLayouts>(initial ?? defaultColumnLayouts());
  const [moduleId, setModuleId] = useState<string>(COLUMN_TABLES[0].moduleId);
  const screens = COLUMN_TABLES.filter((table) => table.moduleId === moduleId);
  const [screenKey, setScreenKey] = useState<ColumnTableKey>(screens[0]?.key ?? 'contacts');
  const screen = COLUMN_TABLES.find((table) => table.key === screenKey) ?? COLUMN_TABLES[0];
  const [query, setQuery] = useState('');
  const [dragKey, setDragKey] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setLayouts(initial);
    }
  }, [initial]);

  const modules = useMemo(() => {
    const ids = [...new Set(COLUMN_TABLES.map((table) => table.moduleId))];
    return ids.map((id) => ({
      id,
      name: moduleById(id)?.name ?? id,
      screens: COLUMN_TABLES.filter((table) => table.moduleId === id).length,
    }));
  }, []);

  async function save(next: ColumnLayouts) {
    setLayouts(next);
    const { status, body } = await api(`/control/tenants/${tenantId}/column-layouts`, {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The columns were not saved.'), tone: 'bad' });
      return;
    }
    await onReload();
  }

  function orderOf(table: ColumnTableKey): string[] {
    const visible = layouts[table];
    const rest = screen.columns.map((column) => column.key).filter((key) => !visible.includes(key));
    return [...visible, ...rest];
  }

  function move(key: string, direction: -1 | 1) {
    const order = orderOf(screen.key);
    const index = order.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) {
      return;
    }
    const copy = [...order];
    const [item] = copy.splice(index, 1);
    if (!item) {
      return;
    }
    copy.splice(nextIndex, 0, item);
    const visible = new Set(layouts[screen.key]);
    void save({ ...layouts, [screen.key]: copy.filter((id) => visible.has(id)) });
  }

  function toggle(key: string) {
    const visible = layouts[screen.key];
    const nextVisible = visible.includes(key)
      ? visible.filter((item) => item !== key)
      : [...visible, key];
    if (nextVisible.length === 0) {
      notify({ title: 'Keep at least one column visible.', tone: 'bad' });
      return;
    }
    const order = orderOf(screen.key);
    void save({ ...layouts, [screen.key]: order.filter((id) => nextVisible.includes(id)) });
  }

  function rename(key: string, label: string) {
    const labels = {
      ...layouts.labels,
      [screen.key]: { ...layouts.labels[screen.key], [key]: label.trim() },
    };
    void save({ ...layouts, labels });
  }

  function dropOn(target: string) {
    if (!dragKey || dragKey === target) {
      return;
    }
    const order = orderOf(screen.key);
    const from = order.indexOf(dragKey);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) {
      return;
    }
    const copy = [...order];
    const [item] = copy.splice(from, 1);
    if (!item) {
      return;
    }
    copy.splice(to, 0, item);
    const visible = new Set(layouts[screen.key]);
    void save({ ...layouts, [screen.key]: copy.filter((id) => visible.has(id)) });
    setDragKey(null);
  }

  const visibleCount = layouts[screen.key].length;
  const rows = orderOf(screen.key)
    .map((key) => screen.columns.find((column) => column.key === key))
    .filter((column): column is (typeof screen.columns)[number] => Boolean(column))
    .filter((column) => column.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="ui-stack">
      <p className="ui-hint">
        Pick a module and screen, then show, hide, rename or reorder columns. The client preview
        uses this layout live.
      </p>
      <Card title="Modules">
        <ul className="pick-list">
          {modules.map((module) => (
            <li key={module.id}>
              <button
                type="button"
                className={module.id === moduleId ? 'is-on' : undefined}
                onClick={() => {
                  setModuleId(module.id);
                  const first = COLUMN_TABLES.find((table) => table.moduleId === module.id);
                  if (first) {
                    setScreenKey(first.key);
                  }
                }}
              >
                <strong>{module.name}</strong>
                <span>
                  {module.screens} {module.screens === 1 ? 'screen' : 'screens'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Screens">
        <ul className="pick-list">
          {screens.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className={item.key === screen.key ? 'is-on' : undefined}
                onClick={() => setScreenKey(item.key)}
              >
                <strong>{item.label}</strong>
                <span>
                  {item.screenType} · {item.columns.length} columns
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <div className="client-module-head">
          <h2>
            Columns · {visibleCount}/{screen.columns.length} visible
          </h2>
        </div>
        <TextField label="Search" value={query} onChange={setQuery} />
        <ul className="column-list">
          {rows.map((column, index) => {
            const visible = layouts[screen.key].includes(column.key);
            const label = columnHeading(screen.key, column.key, layouts);
            return (
              <li
                key={column.key}
                draggable
                onDragStart={() => setDragKey(column.key)}
                onDragOver={(event: DragEvent) => event.preventDefault()}
                onDrop={() => dropOn(column.key)}
              >
                <span className="drag" aria-hidden="true">
                  ::
                </span>
                <span className="pos">{index + 1}</span>
                <input
                  aria-label={`${column.label} name`}
                  value={label}
                  onChange={(event) =>
                    setLayouts((current) => ({
                      ...current,
                      labels: {
                        ...current.labels,
                        [screen.key]: {
                          ...current.labels[screen.key],
                          [column.key]: event.target.value,
                        },
                      },
                    }))
                  }
                  onBlur={(event) => rename(column.key, event.target.value)}
                />
                <span className="col-type">{column.type}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={visible}
                    aria-label={`Show ${label}`}
                    onChange={() => toggle(column.key)}
                  />
                  <span />
                </label>
                <Button variant="secondary" onClick={() => move(column.key, -1)}>
                  Up
                </Button>
                <Button variant="secondary" onClick={() => move(column.key, 1)}>
                  Down
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

type Person = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  totpEnabled: boolean;
  lastSignedIn: string | null;
  roles: { key: string; name: string }[];
};

function UsersTab({ tenant }: { tenant: Tenant }) {
  const notify = useToast();
  const [users, setUsers] = useState<Person[] | null>(null);
  const [roles, setRoles] = useState<{ key: string; name: string }[]>([]);
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('sales_cashier');
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState('');
  const [editing, setEditing] = useState<Person | null>(null);
  const [nextRole, setNextRole] = useState('');

  async function load() {
    const { body } = await api(`/control/tenants/${tenant.id}/users`);
    if (body && typeof body === 'object' && 'users' in body) {
      const payload = body as { users: Person[]; roles: { key: string; name: string }[] };
      setUsers(payload.users);
      setRoles(payload.roles);
    }
  }

  useEffect(() => {
    void load();
  }, [tenant.id]);

  const readyIds = new Set(
    moduleIndex()
      .filter((entry) => entry.built)
      .map((entry) => entry.id),
  );
  const built = tenant.modules.filter((module) => readyIds.has(module.id));

  return (
    <div className="ui-stack">
      <Card>
        <div className="client-module-head">
          <h2>People</h2>
          <Button onClick={() => setInviting(true)}>Invite A Person</Button>
        </div>
        {inviting ? (
          <Form
            onSubmit={() => {
              void api(`/control/tenants/${tenant.id}/users/invite`, {
                method: 'POST',
                body: JSON.stringify({ email, roleKey }),
              }).then(({ status, body }) => {
                if (status === 201 && body && typeof body === 'object' && 'inviteUrl' in body) {
                  setLink((body as { inviteUrl: string }).inviteUrl);
                  setEmail('');
                  notify({ title: 'Invite ready. Copy the link. No email was sent.' });
                  void load();
                  return;
                }
                notify({ title: errorMessage(body, 'The invite was not created.'), tone: 'bad' });
              });
            }}
          >
            <TextField label="Email" value={email} onChange={setEmail} type="email" />
            <SelectField label="Role" value={roleKey} onChange={setRoleKey}>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {plainRoleName(role)}
                </option>
              ))}
            </SelectField>
            <Button type="submit">Create Invite Link</Button>
            {link ? <p className="ui-secret">{link}</p> : null}
          </Form>
        ) : null}
        {!users ? <Skeleton lines={4} /> : null}
        {users && users.length === 0 ? (
          <EmptyState
            title="No People Yet"
            body="Invite the first person. The link is shown here."
          />
        ) : null}
        {users && users.length > 0 ? (
          <DataTable
            rows={users}
            getRowId={(person) => person.id}
            emptyTitle="No People Yet"
            emptyBody="Invite the first person. The link is shown here."
            columns={[
              {
                key: 'person',
                header: 'Person',
                cell: (person) => (
                  <div>
                    <strong>{person.displayName}</strong>
                    <div className="ui-hint">{person.email}</div>
                  </div>
                ),
              },
              {
                key: 'role',
                header: 'Role',
                cell: (person) =>
                  person.roles.map((role) => plainRoleName(role)).join(', ') || 'No Role',
              },
              {
                key: 'mfa',
                header: 'Authenticator',
                cell: (person) => (
                  <Badge tone={person.totpEnabled ? 'ok' : 'neutral'}>
                    {person.totpEnabled ? 'On' : 'Off'}
                  </Badge>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (person) => (
                  <Badge tone={person.status === 'active' ? 'ok' : 'neutral'}>
                    {person.status === 'active' ? 'Active' : 'Deactivated'}
                  </Badge>
                ),
              },
              {
                key: 'seen',
                header: 'Last Sign-In',
                cell: (person) =>
                  person.lastSignedIn
                    ? new Date(person.lastSignedIn).toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : 'Never',
              },
              {
                key: 'actions',
                header: '',
                cell: (person) => (
                  <MenuButton
                    label={`Actions for ${person.displayName}`}
                    items={[
                      {
                        label: 'Change Role',
                        onSelect: () => {
                          setNextRole(person.roles[0]?.key ?? roles[0]?.key ?? '');
                          setEditing(person);
                        },
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        ) : null}
        <DialogFrame
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
            }
          }}
          title="Change Role"
          description={editing?.displayName}
        >
          <Form
            onSubmit={() => {
              if (!editing) {
                return;
              }
              void api(`/control/tenants/${tenant.id}/users/${editing.id}/role`, {
                method: 'POST',
                body: JSON.stringify({ roleKey: nextRole }),
              }).then(() => {
                setEditing(null);
                notify({ title: 'Role updated.' });
                void load();
              });
            }}
          >
            <SelectField label="Role" value={nextRole} onChange={setNextRole}>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {plainRoleName(role)}
                </option>
              ))}
            </SelectField>
            <Button type="submit">Save Role</Button>
          </Form>
        </DialogFrame>
      </Card>
      <Card title="Permissions">
        <p className="ui-hint">
          These are the standard permissions for each role. Change a person’s role from their row.
        </p>
        <div className="ui-table-wrap">
          <table className="ui-table matrix">
            <thead>
              <tr>
                <th>Module</th>
                {ACCESS_ROLES.map((role) => (
                  <th key={role.key}>{plainRoleName(role)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {built.map((module) => (
                <tr key={module.id} className={module.active ? undefined : 'is-off'}>
                  <th scope="row">
                    {moduleById(module.id)?.name ?? module.name}
                    {module.active ? null : <Badge tone="neutral">Off</Badge>}
                  </th>
                  {ACCESS_ROLES.map((role) => {
                    return <td key={role.key}>{accessPhrase(flagsFor(module.id, role.key))}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function accessPhrase(flags: { C: boolean; R: boolean; U: boolean; A: boolean }): string {
  const words = [
    flags.C ? 'Create' : '',
    flags.R ? 'View' : '',
    flags.U ? 'Change' : '',
    flags.A ? 'Approve' : '',
  ].filter(Boolean);
  return words.join(', ') || '—';
}

function flagsFor(moduleId: ModuleId, roleKey: RoleKey) {
  const actions = new Set<string>();
  for (const entry of ACCESS_SCOPES) {
    if (!entry.modules.includes(moduleId)) {
      continue;
    }
    for (const action of entry.access[roleKey].actions) {
      actions.add(action);
    }
  }
  const admin = actions.has('admin');
  return {
    C: admin || actions.has('operate') || actions.has('post') || actions.has('submit'),
    R: admin || actions.has('read') || actions.has('self'),
    U: admin || actions.has('operate') || actions.has('post'),
    D: false,
    A: admin || actions.has('approve'),
  };
}

function AuditTab({ tenantId, companyName }: { tenantId: string; companyName: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  useEffect(() => {
    void api(`/control/audit?tenantId=${tenantId}`).then(({ body }) => {
      if (!body || typeof body !== 'object' || !('events' in body)) {
        setItems([]);
        return;
      }
      const events = (
        body as {
          events: {
            id: string;
            action: string;
            actorLabel: string;
            occurredAt: string;
            beforeData?: unknown;
            afterData?: unknown;
          }[];
        }
      ).events;
      setItems(
        events.map((row) => ({
          id: row.id,
          title: row.action,
          icon: 'company' as const,
          actor: row.actorLabel,
          company: companyName,
          occurredAt: row.occurredAt,
          rawAction: row.action,
          beforeData: row.beforeData,
          afterData: row.afterData,
        })),
      );
    });
  }, [tenantId, companyName]);
  if (!items) {
    return <Skeleton lines={5} />;
  }
  return (
    <Card title="Audit Log">
      <ActivityFeed
        items={items.map((item) => {
          const phrase = describeActivity(item.rawAction, item.afterData);
          return { ...item, title: phrase.title, icon: phrase.icon };
        })}
        emptyTitle="No Activity Yet"
        emptyBody="Changes for this client will show up here."
      />
    </Card>
  );
}
