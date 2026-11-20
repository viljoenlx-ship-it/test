import { MODULE_AREAS, moduleAvailability, moduleById, moduleIndex } from '@omnivate/shared';
import type { NavIcon, NavItem, PhoneTab } from '@omnivate/ui';

/** Full module index for the company app. Built and enabled rows open. The rest stay visible. */
export function companyNav(options: {
  path: string;
  modules: readonly string[];
  documentsOn?: boolean;
  signedIn: boolean;
  prefix?: string;
}): NavItem[] {
  const prefix = options.prefix ?? '';
  const place = (href: string) => (prefix ? (href === '/' ? prefix : `${prefix}${href}`) : href);
  const here = (href: string) =>
    options.path === href || (href !== '/' && options.path.startsWith(`${href}/`));

  if (!options.signedIn) {
    return [
      {
        href: place('/'),
        label: 'Today',
        icon: 'home',
        current: options.path === '/',
        state: 'ready',
      },
      {
        href: place('/login'),
        label: 'Sign In',
        icon: 'login',
        current: options.path === '/login' || options.path === '/mfa',
        state: 'ready',
      },
    ];
  }

  const items: NavItem[] = [
    {
      href: place('/'),
      label: 'Today',
      icon: 'home',
      current: options.path === '/',
      state: 'ready',
    },
  ];

  for (const entry of moduleIndex()) {
    const state = moduleAvailability(entry, options.modules);
    const href = state === 'locked' ? undefined : place(entry.href);
    items.push({
      href,
      label: entry.name,
      icon: entry.icon as NavIcon,
      current: href ? here(entry.href) : false,
      section: entry.area,
      state,
      hint:
        state === 'soon' ? 'Coming Soon' : state === 'locked' ? 'Not In Your Package' : undefined,
    });
    if (entry.id === 'SAL-01') {
      const invoices = moduleById('FIN-02');
      const invoicesReady = invoices
        ? moduleAvailability(invoices, options.modules) === 'ready'
        : false;
      if (state === 'ready' || invoicesReady) {
        items.push({
          href: place('/customers'),
          label: 'Customers',
          icon: 'contacts',
          current: here('/customers'),
          section: 'Sales',
          state: 'ready',
        });
      }
    }
    if (entry.id === 'SCM-01' && options.documentsOn && state === 'ready') {
      items.push({
        href: place('/documents'),
        label: 'Documents',
        icon: 'documents',
        current: here('/documents'),
        section: entry.area,
        state: 'ready',
      });
    }
  }

  return oneGroupPerArea(items);
}

const SALES_LEAD = ['Quotes', 'Invoices', 'Customers'];

/** Each area is one block, so the sidebar does not repeat Finance or Sales. */
function oneGroupPerArea(items: NavItem[]): NavItem[] {
  const loose = items.filter((item) => !item.section);
  const ordered = [...loose];
  const known = new Set<string>(MODULE_AREAS);
  for (const area of MODULE_AREAS) {
    const group = items.filter((item) => item.section === area);
    if (area === 'Sales') {
      const lead = SALES_LEAD.flatMap((label) => group.filter((item) => item.label === label));
      const rest = group.filter((item) => !SALES_LEAD.includes(item.label));
      ordered.push(...lead, ...rest);
    } else {
      ordered.push(...group);
    }
  }
  ordered.push(...items.filter((item) => item.section && !known.has(item.section)));
  return ordered;
}

/** Thumb-reach tabs. Sales is the sales module that is switched on, otherwise the next one. */
export function phoneTabs(nav: NavItem[]): PhoneTab[] {
  const ready = nav.filter((item) => item.href && item.state === 'ready');
  const today = ready.find((item) => item.label === 'Today');
  const stock = ready.find((item) => item.label === 'Stock');
  const sales =
    ready.find((item) => item.section === 'Sales' && /quote|invoice/i.test(item.label)) ??
    ready.find((item) => item.section === 'Sales' && item.label !== 'Documents');
  const tabs: PhoneTab[] = [];
  if (today?.href) {
    tabs.push({ label: 'Home', icon: 'home', href: today.href });
  }
  if (sales?.href) {
    tabs.push({ label: 'Sales', icon: sales.icon, href: sales.href });
  }
  if (stock?.href) {
    tabs.push({ label: 'Stock', icon: 'stock', href: stock.href });
  }
  if (!sales?.href && !stock?.href) {
    const other = ready.find((item) => item.label === 'Contacts' && item.href);
    if (other?.href) {
      tabs.push({ label: other.label, icon: other.icon, href: other.href });
    }
  }
  const scanHref =
    today?.href && today.href !== '/' ? `${today.href.replace(/\/$/, '')}/scan` : '/scan';
  tabs.push({ label: 'Scan', icon: 'scan', href: scanHref, center: true });
  return tabs;
}
