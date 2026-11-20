import {
  brandPresentation,
  defaultColumnLayouts,
  moduleBySlug,
  moduleIndex,
  type ColumnLayouts,
} from '@omnivate/shared';
import {
  AppShell,
  CommandPalette,
  DesignPreview,
  EmptyState,
  PageHeader,
  ToastProvider,
  usePhone,
  type PaletteItem,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, type Navigate } from './api';
import { companyNav, phoneTabs } from './module-nav';
import { ComputerScreen, isDeskOnlyPath } from './screens/ComputerScreen';
import { isPreviewBuild, showDemoHints } from './preview';
import { BranchBar } from './BranchBar';
import { NotificationBell } from './NotificationBell';
import { ContactDetailScreen } from './screens/contacts/ContactDetailScreen';
import { ContactFormScreen } from './screens/contacts/ContactFormScreen';
import { ContactsScreen } from './screens/contacts/ContactsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ModuleOverview } from './screens/ModuleOverview';
import { ImportScreen } from './screens/ImportScreen';
import { InviteScreen } from './screens/InviteScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MfaScreen } from './screens/MfaScreen';
import { BranchesScreen } from './screens/BranchesScreen';
import { PipelinesScreen } from './screens/PipelinesScreen';
import { DocumentsScreen } from './screens/documents/DocumentsScreen';
import { SnapScreen } from './screens/documents/SnapScreen';
import { ReviewScreen } from './screens/documents/ReviewScreen';
import { SnapButton } from './screens/documents/SnapButton';
import { ItemDetailScreen } from './screens/stock/ItemDetailScreen';
import { ItemFormScreen } from './screens/stock/ItemFormScreen';
import { GrvCaptureScreen } from './screens/stock/GrvCaptureScreen';
import { GrvDetailScreen } from './screens/stock/GrvDetailScreen';
import { GrvLabelsScreen } from './screens/stock/GrvLabelsScreen';
import { LabelScreen } from './screens/stock/LabelScreen';
import { MoveScreen } from './screens/stock/MoveScreen';
import { ReportBuilder } from './screens/reports/ReportBuilder';
import { ReportsHome } from './screens/reports/ReportsHome';
import { LowStockScreen, ValuationScreen } from './screens/stock/ReportScreens';
import { StockListScreen } from './screens/stock/StockListScreen';
import { LedgerScreen } from './screens/ledger/LedgerScreen';
import { FinanceOperationsScreen } from './screens/finance/FinanceOperationsScreen';
import { salesScreen } from './screens/sales/screens';
import { PreviewScreen } from './screens/PreviewScreen';
import { UsersScreen } from './screens/UsersScreen';
import { WorkspaceProvider } from './workspace';

export type Brand = {
  displayName: string;
  primary: string;
  accent: string;
  logoUrl: string | null;
};

function useRoute(): { path: string; search: string; navigate: Navigate } {
  const [href, setHref] = useState(() => window.location.pathname + window.location.search);

  useEffect(() => {
    const sync = () => setHref(window.location.pathname + window.location.search);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const navigate: Navigate = (to) => {
    window.history.pushState({}, '', to);
    setHref(to);
  };

  const url = new URL(href, 'http://omnivate.local');
  return { path: url.pathname, search: url.search, navigate };
}

type Workspace = {
  displayName: string;
  packageName: string;
  city: string | null;
  vatNumber: string | null;
  logoUrl: string | null;
  modules: string[];
  columnLayouts: ColumnLayouts;
  primary: string;
  accent: string;
};

function paintBrand(primary: string, accent: string) {
  try {
    const brand = brandPresentation(primary, accent);
    const root = document.documentElement;
    root.style.setProperty('--ui-brand-mark', brand.mark);
    root.style.setProperty('--ui-brand-accent', brand.accent);
  } catch {
    // Keep the default mark if a colour is not a hex value.
  }
}

export function App() {
  const { path, search, navigate } = useRoute();
  const token = new URLSearchParams(search).get('token') ?? '';
  const [signedIn, setSignedIn] = useState(false);
  const [personName, setPersonName] = useState('');
  const phone = usePhone();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [documentsOn, setDocumentsOn] = useState(false);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    api('/auth/session')
      .then(({ status, body }) => {
        if (
          cancelled ||
          status !== 200 ||
          !body ||
          typeof body !== 'object' ||
          !('tenant' in body)
        ) {
          return;
        }
        const payload = body as {
          tenant: {
            displayName: string;
            slug: string;
            brandPrimary: string;
            brandAccent: string;
            hasLogo: boolean;
            city: string | null;
            vatNumber: string | null;
            packageName: string;
          };
          modules?: string[];
          columnLayouts?: ColumnLayouts;
          user?: { displayName?: string };
        };
        setSignedIn(true);
        setPersonName(payload.user?.displayName ?? '');
        paintBrand(payload.tenant.brandPrimary, payload.tenant.brandAccent);
        setBrand({
          displayName: payload.tenant.displayName,
          primary: payload.tenant.brandPrimary,
          accent: payload.tenant.brandAccent,
          logoUrl: payload.tenant.hasLogo ? `/api/branding/${payload.tenant.slug}/logo` : null,
        });
        setWorkspace({
          displayName: payload.tenant.displayName,
          packageName: payload.tenant.packageName,
          city: payload.tenant.city,
          vatNumber: payload.tenant.vatNumber,
          logoUrl: payload.tenant.hasLogo ? `/api/branding/${payload.tenant.slug}/logo` : null,
          modules: payload.modules ?? [],
          columnLayouts: payload.columnLayouts ?? defaultColumnLayouts(),
          primary: payload.tenant.brandPrimary,
          accent: payload.tenant.brandAccent,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    if (!signedIn) {
      setDocumentsOn(false);
      return;
    }
    let cancel = false;
    void api('/documents/access').then(({ status, body }) => {
      if (cancel) {
        return;
      }
      const on =
        status === 200 &&
        !!body &&
        typeof body === 'object' &&
        'canReview' in body &&
        (body as { canReview: boolean }).canReview === true;
      setDocumentsOn(on);
    });
    return () => {
      cancel = true;
    };
  }, [signedIn, path]);

  const nav = companyNav({
    path,
    modules: workspace?.modules ?? [],
    documentsOn,
    signedIn,
  });
  const moduleSlug = /^\/modules\/([a-z0-9-]+)$/.exec(path)?.[1] ?? '';
  const moduleEntry = moduleSlug ? moduleBySlug(moduleSlug) : undefined;
  const activeEntry = moduleIndex().find(
    (entry) =>
      entry.built &&
      (path === entry.href || (entry.href !== '/' && path.startsWith(`${entry.href}/`))),
  );
  const crumbs = !signedIn
    ? [{ label: 'Today' }]
    : path.startsWith('/documents')
      ? [
          { label: 'Supply Chain', href: '/stock' },
          { label: path === '/documents' ? 'Documents' : 'Review' },
        ]
      : moduleEntry
        ? [{ label: moduleEntry.area, href: moduleEntry.href }, { label: moduleEntry.name }]
        : activeEntry
          ? [{ label: activeEntry.area, href: activeEntry.href }, { label: activeEntry.name }]
          : [{ label: 'Today' }];
  const chips = signedIn
    ? [workspace?.city, workspace?.vatNumber ? `VAT ${workspace.vatNumber}` : null].filter(
        (chip): chip is string => Boolean(chip),
      )
    : [];

  const itemMatch = /^\/stock\/items\/([^/]+)$/.exec(path);
  const editMatch = /^\/stock\/items\/([^/]+)\/edit$/.exec(path);
  const labelMatch = /^\/stock\/labels\/([^/]+)$/.exec(path);
  const receiptLabelsMatch = /^\/stock\/receipts\/([^/]+)\/labels$/.exec(path);
  const receiptMatch = /^\/stock\/receipts\/([^/]+)$/.exec(path);
  const presetItem = new URLSearchParams(search).get('item') ?? '';
  const presetBarcode = new URLSearchParams(search).get('barcode') ?? '';

  let screen = (
    <HomeScreen
      navigate={navigate}
      signedIn={signedIn}
      modules={workspace?.modules ?? []}
      documentsOn={documentsOn}
      personName={personName}
      companyName={workspace?.displayName ?? brand?.displayName ?? 'Omnivate'}
      city={workspace?.city ?? null}
    />
  );
  if (path === '/stock') {
    screen = <StockListScreen navigate={navigate} />;
  } else if (path === '/stock/new') {
    screen = <ItemFormScreen navigate={navigate} itemId={null} initialBarcode={presetBarcode} />;
  } else if (path === '/stock/receive') {
    screen = (
      <GrvCaptureScreen
        navigate={navigate}
        presetItem={presetItem}
        initialBarcode={presetBarcode}
      />
    );
  } else if (receiptLabelsMatch?.[1]) {
    screen = <GrvLabelsScreen navigate={navigate} receiptId={receiptLabelsMatch[1]} />;
  } else if (receiptMatch?.[1]) {
    screen = <GrvDetailScreen navigate={navigate} receiptId={receiptMatch[1]} />;
  } else if (path === '/stock/adjust') {
    screen = <MoveScreen navigate={navigate} mode="adjust" presetItem={presetItem} />;
  } else if (path === '/stock/transfer') {
    screen = <MoveScreen navigate={navigate} mode="transfer" presetItem={presetItem} />;
  } else if (path === '/stock/low') {
    screen = <LowStockScreen navigate={navigate} />;
  } else if (path === '/stock/value') {
    screen = <ValuationScreen navigate={navigate} />;
  } else if (editMatch?.[1]) {
    screen = <ItemFormScreen navigate={navigate} itemId={editMatch[1]} />;
  } else if (itemMatch?.[1]) {
    screen = <ItemDetailScreen navigate={navigate} itemId={itemMatch[1]} />;
  } else if (labelMatch?.[1]) {
    screen = <LabelScreen navigate={navigate} itemId={labelMatch[1]} />;
  }
  if (path === '/login') {
    screen = (
      <LoginScreen
        navigate={navigate}
        onBrand={(next) => {
          if (!next) {
            setBrand(null);
            document.documentElement.style.removeProperty('--ui-brand-mark');
            document.documentElement.style.removeProperty('--ui-brand-accent');
            return;
          }
          paintBrand(next.primary, next.accent);
          setBrand(next);
        }}
      />
    );
  } else if (path === '/mfa') {
    screen = <MfaScreen navigate={navigate} />;
  } else if (path === '/invite') {
    screen = <InviteScreen token={token} navigate={navigate} />;
  } else if (path === '/users') {
    screen = <UsersScreen navigate={navigate} />;
  } else if (path === '/contacts') {
    screen = <ContactsScreen navigate={navigate} />;
  } else if (path === '/contacts/new') {
    screen = <ContactFormScreen navigate={navigate} />;
  } else if (/^\/contacts\/[0-9a-f-]{36}\/edit$/i.test(path)) {
    screen = <ContactFormScreen navigate={navigate} partyId={path.split('/')[2]} />;
  } else if (/^\/contacts\/[0-9a-f-]{36}$/i.test(path)) {
    screen = <ContactDetailScreen navigate={navigate} partyId={path.split('/')[2] ?? ''} />;
  } else if (path === '/branches') {
    screen = <BranchesScreen navigate={navigate} />;
  } else if (path === '/settings/pipelines') {
    screen = <PipelinesScreen />;
  } else if (path === '/import') {
    screen = <ImportScreen />;
  } else if (path === '/ledger' || path.startsWith('/ledger/')) {
    const account = /^\/ledger\/accounts\/([0-9a-f-]{36})$/i.exec(path);
    const section = path.split('/')[2] ?? 'accounts';
    screen = (
      <LedgerScreen
        navigate={navigate}
        tab={account ? 'accounts' : section === 'ledger' ? 'accounts' : section}
        accountId={account?.[1] ?? null}
      />
    );
  } else if (path.startsWith('/finance/creditors')) {
    screen = <FinanceOperationsScreen moduleId="FIN-03" navigate={navigate} />;
  } else if (path.startsWith('/finance/cashbook')) {
    screen = <FinanceOperationsScreen moduleId="FIN-04" navigate={navigate} />;
  } else if (path.startsWith('/finance/petty-cash')) {
    screen = <FinanceOperationsScreen moduleId="FIN-05" navigate={navigate} />;
  } else if (path.startsWith('/finance/tax')) {
    screen = <FinanceOperationsScreen moduleId="FIN-06" navigate={navigate} />;
  } else if (path === '/scan') {
    screen = <SnapScreen navigate={navigate} />;
  } else if (path === '/documents') {
    screen = <DocumentsScreen navigate={navigate} />;
  } else if (/^\/documents\/[0-9a-f-]{36}$/i.test(path)) {
    screen = <ReviewScreen navigate={navigate} documentId={path.split('/')[2] ?? ''} />;
  } else if (
    path.startsWith('/customers') ||
    path.startsWith('/quotes') ||
    path.startsWith('/invoices')
  ) {
    const sales = salesScreen(path, navigate);
    if (sales) {
      screen = sales;
    }
  } else if (path === '/reports') {
    screen = <ReportsHome navigate={navigate} />;
  } else if (path === '/reports/new') {
    screen = <ReportBuilder navigate={navigate} reportId={null} />;
  } else if (/^\/reports\/[0-9a-f-]{36}$/i.test(path)) {
    screen = <ReportBuilder navigate={navigate} reportId={path.split('/')[2] ?? null} />;
  } else if (moduleSlug) {
    const turnedOn = moduleEntry ? (workspace?.modules ?? []).includes(moduleEntry.id) : false;
    screen =
      moduleEntry && moduleEntry.built && turnedOn ? (
        <ModuleRedirect href={moduleEntry.href} />
      ) : moduleEntry ? (
        <ModuleOverview entry={moduleEntry} mode={moduleEntry.built ? 'locked' : 'soon'} />
      ) : (
        <ModuleMissing />
      );
  }

  if (phone && signedIn && isDeskOnlyPath(path)) {
    screen = <ComputerScreen />;
  }

  if (path === '/design-preview' && showDemoHints()) {
    screen = <DesignPreview />;
  }

  const quiet = path === '/login' || path === '/mfa' || path === '/invite';
  const paletteItems: PaletteItem[] = nav
    .filter((item) => item.href)
    .map((item) => ({
      id: item.href ?? item.label,
      group: item.section || 'Start',
      label: item.label,
      hint: item.hint,
      onSelect: () => {
        if (item.href) {
          navigate(item.href);
        }
      },
    }));

  if (path === '/preview' || path.startsWith('/preview/')) {
    return (
      <ToastProvider>
        <PreviewScreen path={path} search={search} navigate={navigate} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      {quiet ? (
        screen
      ) : (
        <WorkspaceProvider layouts={workspace?.columnLayouts ?? defaultColumnLayouts()}>
          <AppShell
            product="Omnivate"
            brandName={brand?.displayName ?? 'Omnivate'}
            logoUrl={brand?.logoUrl}
            nav={nav}
            crumbs={crumbs}
            chips={chips}
            onNavigate={navigate}
            toolbar={
              signedIn ? (
                <>
                  <SnapButton navigate={navigate} variant="secondary" />
                  <NotificationBell />
                </>
              ) : undefined
            }
            preview={isPreviewBuild()}
            header={signedIn ? <BranchBar /> : undefined}
            onOpenPalette={signedIn ? () => setPalette(true) : undefined}
            phoneTabs={phoneTabs(nav)}
            onSignOut={
              signedIn
                ? () => {
                    void api('/auth/logout', { method: 'POST' }).then(() => {
                      setSignedIn(false);
                      setPersonName('');
                      setBrand(null);
                      setWorkspace(null);
                      navigate('/login');
                    });
                  }
                : undefined
            }
          >
            {screen}
          </AppShell>
          {signedIn ? (
            <CommandPalette
              open={palette}
              onOpenChange={setPalette}
              items={paletteItems}
              query={paletteQuery}
              onQueryChange={setPaletteQuery}
              title="Search"
              description="Find a page or an action."
              placeholder="Type a page or an action"
            />
          ) : null}
        </WorkspaceProvider>
      )}
    </ToastProvider>
  );
}

function ModuleRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [href]);
  return null;
}

function ModuleMissing() {
  return (
    <>
      <PageHeader title="That Page Is Not Here" description="Choose a section from the sidebar." />
      <EmptyState title="Nothing opened" body="Pick a section on the left to continue." />
    </>
  );
}
