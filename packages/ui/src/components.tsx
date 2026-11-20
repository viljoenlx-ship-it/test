import type { ModuleIcon } from '@omnivate/shared';
import { omnivateIconUrl } from './brand';
import { Slot } from '@radix-ui/react-slot';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import * as Toast from '@radix-ui/react-toast';
import { Command } from 'cmdk';
import {
  Banknote,
  BarChart3,
  BookUser,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Signature,
  FileSpreadsheet,
  FileText,
  GitBranch,
  HardHat,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  MoreHorizontal,
  Package,
  PanelLeft,
  Percent,
  Receipt,
  Repeat,
  Scale,
  ScanLine,
  ScrollText,
  Search,
  Shield,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  BadgeCheck,
  Factory,
  Kanban,
  Link2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { getPhoneSnapshot, subscribeToPhone } from './phone';

const moduleIcons = {
  people: Users,
  contacts: BookUser,
  branches: Store,
  approvals: GitBranch,
  portals: Link2,
  import: FileSpreadsheet,
  ledger: Landmark,
  invoices: Receipt,
  bills: Receipt,
  bank: Landmark,
  cash: Wallet,
  vat: Percent,
  quotes: Signature,
  orders: ClipboardList,
  pos: ShoppingCart,
  rentals: Repeat,
  support: LifeBuoy,
  stock: Package,
  purchasing: ShoppingCart,
  warehouse: Warehouse,
  deliveries: Truck,
  manufacturing: Factory,
  jobs: ClipboardList,
  assets: Wrench,
  quality: BadgeCheck,
  employees: Users,
  time: Clock,
  payroll: Banknote,
  staffDocs: FileText,
  welfare: Shield,
  equity: Scale,
  filings: ScrollText,
  safety: HardHat,
  projects: Kanban,
  it: Monitor,
  reports: BarChart3,
} satisfies Record<ModuleIcon, LucideIcon>;

const icons = {
  ...moduleIcons,
  home: LayoutDashboard,
  login: LogIn,
  documents: FileText,
  scan: ScanLine,
  overview: LayoutDashboard,
  companies: Building2,
  audit: ScrollText,
  fields: SlidersHorizontal,
  flow: GitBranch,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof icons;

export type NavItem = {
  href?: string;
  label: string;
  icon: NavIcon;
  current: boolean;
  section?: string;
  /** ready opens the screen. soon opens an overview. locked stays in the list. */
  state?: 'ready' | 'soon' | 'locked';
  hint?: string;
};

export type Crumb = { label: string; href?: string };

/** A bottom-tab destination. The shell adds More itself. */
export type PhoneTab = {
  label: string;
  icon: NavIcon;
  href: string;
  /** Raised centre action, such as Snap A Document. */
  center?: boolean;
};

const PhoneTitleContext = createContext<(title: string) => void>(() => {});
const PhoneBarSlotContext = createContext<HTMLElement | null>(null);
const PhoneToolsContext = createContext<{ openAccount: () => void; openSearch: () => void }>({
  openAccount: () => {},
  openSearch: () => {},
});

/** Opens the phone account sheet or search. No-ops on the desk layout. */
export function usePhoneTools() {
  return useContext(PhoneToolsContext);
}

const PHONE_NAV_LABELS = new Set([
  'Today',
  'Home',
  'Quotes',
  'Invoices',
  'Customers',
  'Stock',
  'Documents',
  'Contacts',
  'Reports',
]);

function phoneTitleText(title: ReactNode): string {
  if (typeof title === 'string' || typeof title === 'number') {
    return String(title);
  }
  if (Array.isArray(title)) {
    return title.map(phoneTitleText).filter(Boolean).join(' ');
  }
  if (title && typeof title === 'object' && 'props' in title) {
    const props = (title as { props?: { children?: ReactNode } }).props;
    return phoneTitleText(props?.children);
  }
  return '';
}

/** True on a phone. A wide desk window stays on the desk layout. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribeToPhone, getPhoneSnapshot, () => false);
}

function defaultPhoneTabs(nav: NavItem[]): PhoneTab[] {
  const ready = nav.filter((item) => item.href && item.state !== 'soon' && item.state !== 'locked');
  return ready.slice(0, 3).map((item) => ({
    label: item.label,
    icon: item.icon,
    href: item.href ?? '/',
  }));
}

function normalisePath(href: string): string {
  if (href.length > 1 && href.endsWith('/')) {
    return href.slice(0, -1);
  }
  return href;
}

function tabIsCurrent(tab: PhoneTab): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const here = normalisePath(window.location.pathname);
  const target = normalisePath(tab.href);
  if (target === '/' || target.endsWith('/control')) {
    return here === target;
  }
  return here === target || here.startsWith(`${target}/`);
}

export function Button({
  variant = 'primary',
  type = 'button',
  asChild = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : 'button';
  const classes = ['ui-btn', variant === 'primary' ? '' : variant, className ?? '']
    .filter(Boolean)
    .join(' ');
  return <Comp className={classes} type={asChild ? undefined : type} {...props} />;
}

export function Chip({
  children,
  pressed,
  onClick,
}: {
  children: ReactNode;
  pressed?: boolean;
  onClick?: () => void;
}) {
  const className = ['ui-chip', 'is-button', pressed ? 'is-on' : ''].filter(Boolean).join(' ');
  if (onClick) {
    return (
      <button type="button" className={className} aria-pressed={pressed} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <span className={pressed ? 'ui-chip quiet is-on' : 'ui-chip quiet'}>{children}</span>;
}

export function SearchBar({
  onOpen,
  placeholder = 'Search or jump',
}: {
  onOpen: () => void;
  placeholder?: string;
}) {
  return (
    <button type="button" className="ui-search-bar" onClick={onOpen}>
      <Search size={18} aria-hidden="true" />
      <span>{placeholder}</span>
      <kbd className="ui-kbd">Ctrl K</kbd>
    </button>
  );
}

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <label className={error ? 'ui-field has-error' : 'ui-field'} htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
      {error ? (
        <small id={errorId} className="ui-error">
          {error}
        </small>
      ) : hint ? (
        <small id={hintId}>{hint}</small>
      ) : null}
    </label>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <label className={error ? 'ui-field has-error' : 'ui-field'} htmlFor={id}>
      <span>{label}</span>
      <textarea
        id={id}
        rows={rows}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <small id={errorId} className="ui-error">
          {error}
        </small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </label>
  );
}

export function CheckField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="ui-check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="ui-toggle-row">
      <span>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function SelectField({
  label,
  hint,
  error,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <label className={error ? 'ui-field has-error' : 'ui-field'} htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      {error ? <small className="ui-error">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span />
    </label>
  );
}

export function MenuButton({
  label = 'More',
  items,
}: {
  label?: string;
  items: { label: string; onSelect: () => void; tone?: 'default' | 'danger' }[];
}) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function placeMenu() {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setPlace({ top: rect.bottom + 4, left: rect.right });
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    function onMove() {
      placeMenu();
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  if (phone) {
    const title = label.startsWith('Actions for ') ? label.slice('Actions for '.length) : 'Actions';
    return (
      <>
        <Button variant="secondary" aria-label={label} onClick={() => setOpen(true)}>
          Manage
        </Button>
        <Sheet open={open} onOpenChange={setOpen} title={title}>
          <div className="ui-sheet-stack">
            {items.map((item) => (
              <Button
                key={item.label}
                variant={item.tone === 'danger' ? 'danger' : 'secondary'}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </Sheet>
      </>
    );
  }

  return (
    <div className="ui-more" ref={ref}>
      <Button
        variant="ghost"
        className="ui-more-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          placeMenu();
          setOpen(true);
        }}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </Button>
      {open
        ? createPortal(
            <div
              className="ui-more-menu is-fixed"
              id={menuId}
              role="menu"
              ref={menuRef}
              style={{ top: place.top, left: place.left }}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={item.tone === 'danger' ? 'is-danger' : undefined}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function Badge({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'bad' | 'neutral';
  children: ReactNode;
}) {
  return <span className={tone === 'info' ? 'ui-badge' : `ui-badge ${tone}`}>{children}</span>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="ui-card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

function PhoneBarActions({ actions }: { actions: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="ui-phone-bar-primary">{actions}</span>
      <Button
        variant="ghost"
        className="ui-actions-trigger"
        aria-label="More Actions"
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Actions">
        <div
          className="ui-action-sheet"
          onClick={(event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
              return;
            }
            if (target.closest('[aria-haspopup="menu"]')) {
              return;
            }
            if (target.closest('button, a, label')) {
              setOpen(false);
            }
          }}
        >
          {actions}
        </div>
      </Sheet>
    </>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  onNavigate,
}: {
  title: ReactNode;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
  onNavigate?: (href: string) => void;
}) {
  const phone = usePhone();
  const publishTitle = useContext(PhoneTitleContext);
  const barSlot = useContext(PhoneBarSlotContext);

  useEffect(() => {
    if (!phone) {
      return;
    }
    publishTitle(phoneTitleText(title));
  }, [phone, publishTitle, title]);

  return (
    <>
      <header className="ui-page-header">
        <div>
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <ol className="ui-crumbs">
              {breadcrumbs.map((crumb) => (
                <li key={crumb.label}>
                  {crumb.href && onNavigate ? (
                    <a
                      href={crumb.href}
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigate(crumb.href!);
                      }}
                    >
                      {crumb.label}
                    </a>
                  ) : (
                    crumb.label
                  )}
                </li>
              ))}
            </ol>
          ) : null}
          <h1 className="ui-title-row">{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions && !phone ? <div className="ui-actions">{actions}</div> : null}
      </header>
      {phone && actions && barSlot
        ? createPortal(<PhoneBarActions actions={actions} />, barSlot)
        : null}
    </>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className="ui-skeleton"
          style={{ width: index === lines - 1 ? '70%' : '100%' }}
        />
      ))}
    </div>
  );
}

export function TabsBar({
  value,
  onValueChange,
  tabs,
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: string }[];
}) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange}>
      <Tabs.List className="ui-tabs" aria-label="Sections">
        {tabs.map((tab) => (
          <Tabs.Trigger key={tab.value} value={tab.value}>
            {tab.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

export function DialogFrame({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
  presentation = 'dialog',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  presentation?: 'dialog' | 'sheet';
}) {
  const className = [
    'ui-dialog',
    presentation === 'sheet' ? 'ui-sheet' : '',
    wide ? 'ui-palette' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-overlay" />
        <Dialog.Content className={className}>
          <Dialog.Close className="ui-dialog-close" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </Dialog.Close>
          <Dialog.Title>{title}</Dialog.Title>
          {description ? <Dialog.Description>{description}</Dialog.Description> : null}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Sheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return <DialogFrame {...props} presentation="sheet" />;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  tone = 'danger',
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <DialogFrame open={open} onOpenChange={onOpenChange} title={title} description={body}>
      <div className="ui-actions">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </DialogFrame>
  );
}

type ToastItem = { id: number; title: string; tone: 'ok' | 'bad' };
const ToastContext = createContext<(toast: { title: string; tone?: 'ok' | 'bad' }) => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const notify = (toast: { title: string; tone?: 'ok' | 'bad' }) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, title: toast.title, tone: toast.tone ?? 'ok' }]);
  };
  return (
    <ToastContext.Provider value={notify}>
      <Toast.Provider swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            className={toast.tone === 'bad' ? 'ui-toast bad' : 'ui-toast'}
            duration={4000}
            onOpenChange={(open) => {
              if (!open) {
                setToasts((current) => current.filter((item) => item.id !== toast.id));
              }
            }}
          >
            <Toast.Title>{toast.title}</Toast.Title>
          </Toast.Root>
        ))}
        <Toast.Viewport className="ui-toast-viewport" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  /** Full text for the tooltip when the cell is clipped. */
  text?: (row: T) => string;
  /**
   * Phone row placement. The first column is the title, the last is the
   * right-hand value, and the columns between them share one secondary line.
   */
  phone?: 'title' | 'detail' | 'value' | 'hide';
};

function phoneParts<T>(columns: Column<T>[]): {
  lead?: Column<T>;
  detail: Column<T>[];
  value?: Column<T>;
} {
  const body = columns.filter((column) => column.key !== 'actions' && column.phone !== 'hide');
  const titled = body.filter((column) => column.phone === 'title');
  const valued = body.filter((column) => column.phone === 'value');
  const detailed = body.filter((column) => column.phone === 'detail');
  const untouched = body.filter((column) => !column.phone);
  const lead = titled[0] ?? untouched[0] ?? body[0];
  const rest = untouched.filter((column) => column !== lead);
  const value = valued[0] ?? (rest.length > 0 ? rest[rest.length - 1] : undefined);
  const detail = [...detailed, ...rest.filter((column) => column !== value)];
  return { lead, detail, value };
}

function RecordList<T>({
  rows,
  columns,
  getRowId,
  onRow,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  onRow?: (row: T) => void;
}) {
  const parts = phoneParts(columns);

  return (
    <ul className="ui-record-list">
      {rows.map((row) => {
        const body = (
          <>
            <span className="ui-record-main">
              {parts.lead ? <span className="ui-record-title">{parts.lead.cell(row)}</span> : null}
              {parts.detail.length > 0 ? (
                <span className="ui-record-meta">
                  {parts.detail.map((column) => (
                    <span key={column.key}>{column.cell(row)}</span>
                  ))}
                </span>
              ) : null}
            </span>
            {parts.value ? <span className="ui-record-value">{parts.value.cell(row)}</span> : null}
            {onRow ? <ChevronRight size={18} aria-hidden="true" /> : null}
          </>
        );
        return (
          <li key={getRowId(row)} className="ui-record">
            {onRow ? (
              <button type="button" className="ui-record-hit" onClick={() => onRow(row)}>
                {body}
              </button>
            ) : (
              <div className="ui-record-hit">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  query,
  onQueryChange,
  searchPlaceholder,
  emptyTitle,
  emptyBody,
  emptyAction,
  onRow,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  query?: string;
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  emptyTitle: string;
  emptyBody: string;
  emptyAction?: ReactNode;
  onRow?: (row: T) => void;
}) {
  const phone = usePhone();
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const sorted = useMemo(() => {
    if (!sortKey) {
      return rows;
    }
    const column = columns.find((item) => item.key === sortKey);
    if (!column?.sortValue) {
      return rows;
    }
    const copy = [...rows];
    copy.sort((left, right) => {
      const a = column.sortValue?.(left) ?? '';
      const b = column.sortValue?.(right) ?? '';
      const order = a < b ? -1 : a > b ? 1 : 0;
      return direction === 'asc' ? order : -order;
    });
    return copy;
  }, [rows, columns, sortKey, direction]);

  return (
    <div>
      {onQueryChange ? (
        <div className="ui-field" style={{ marginBottom: 12 }}>
          <label className="ui-sr" htmlFor="table-search">
            Search
          </label>
          <input
            id="table-search"
            className="ui-input"
            placeholder={searchPlaceholder ?? 'Search'}
            value={query ?? ''}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
      ) : null}
      {sorted.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} action={emptyAction} />
      ) : phone ? (
        <RecordList rows={sorted} columns={columns} getRowId={getRowId} onRow={onRow} />
      ) : (
        <div className="ui-table-wrap">
          <p className="ui-columns-note">
            {columns.length} {columns.length === 1 ? 'column' : 'columns'} visible
          </p>
          <table className="ui-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      sortKey === column.key
                        ? direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        className="ui-sort"
                        onClick={() => {
                          if (sortKey === column.key) {
                            setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                          } else {
                            setSortKey(column.key);
                            setDirection('asc');
                          }
                        }}
                      >
                        {column.header}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={getRowId(row)}
                  className={onRow ? 'clickable' : undefined}
                  onClick={onRow ? () => onRow(row) : undefined}
                  onKeyDown={
                    onRow
                      ? (event) => {
                          if (event.key === 'Enter') {
                            onRow(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRow ? 0 : undefined}
                >
                  {columns.map((column) => {
                    const content = column.cell(row);
                    const title =
                      column.text?.(row) ??
                      (typeof content === 'string' || typeof content === 'number'
                        ? String(content)
                        : undefined);
                    return (
                      <td key={column.key}>
                        <span className="ui-clip" title={title}>
                          {content}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function groupedNav(items: NavItem[]): { section: string; items: NavItem[] }[] {
  const groups: { section: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const section = item.section ?? '';
    const last = groups[groups.length - 1];
    if (last && last.section === section) {
      last.items.push(item);
    } else {
      groups.push({ section, items: [item] });
    }
  }
  return groups;
}

function NavLinks({
  items,
  iconsOnly,
  expandAll,
  onNavigate,
}: {
  items: NavItem[];
  iconsOnly?: boolean;
  /** Open every group, including ones that are still coming. */
  expandAll?: boolean;
  onNavigate: (href: string) => void;
}) {
  const groups = groupedNav(
    iconsOnly ? items.filter((item) => item.state !== 'soon' && item.state !== 'locked') : items,
  );
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tapped, setTapped] = useState<string | null>(null);
  const currentSection = items.find((item) => item.current)?.section ?? '';

  useEffect(() => {
    if (!currentSection) {
      return;
    }
    setOpen((current) => ({ ...current, [currentSection]: true }));
  }, [currentSection]);

  function sectionOpen(section: string, groupItems: NavItem[]): boolean {
    if (expandAll) {
      return true;
    }
    if (Object.prototype.hasOwnProperty.call(open, section)) {
      return open[section] === true;
    }
    return groupItems.some(
      (item) => item.state === 'ready' || item.state === undefined || item.current,
    );
  }

  return (
    <nav className="ui-nav" aria-label="Primary">
      {groups.map((group) => {
        const shown = iconsOnly || !group.section || sectionOpen(group.section, group.items);
        return (
          <div key={group.section || 'start'} className="ui-nav-section">
            {group.section && !iconsOnly ? (
              <button
                type="button"
                className="ui-nav-group"
                aria-expanded={shown}
                onClick={() =>
                  setOpen((current) => ({
                    ...current,
                    [group.section]: !sectionOpen(group.section, group.items),
                  }))
                }
              >
                <span>{group.section}</span>
                <ChevronDown size={14} aria-hidden="true" className={shown ? 'is-open' : ''} />
              </button>
            ) : null}
            {shown
              ? group.items.map((item) => {
                  const Icon = icons[item.icon];
                  const muted = item.state === 'soon' || item.state === 'locked';
                  const key = item.href ?? item.label;
                  if (!item.href || item.state === 'locked') {
                    return (
                      <span
                        key={key}
                        className={
                          tapped === key
                            ? 'ui-nav-static is-locked is-tapped'
                            : 'ui-nav-static is-locked'
                        }
                        aria-disabled="true"
                        onClick={() => setTapped((current) => (current === key ? null : key))}
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span className="ui-nav-label">{item.label}</span>
                        {item.hint ? <span className="ui-nav-hint">{item.hint}</span> : null}
                      </span>
                    );
                  }
                  return (
                    <a
                      key={key}
                      href={item.href}
                      className={muted ? 'is-soon' : undefined}
                      aria-current={item.current ? 'page' : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigate(item.href!);
                      }}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span className="ui-nav-label">{item.label}</span>
                      {item.hint ? <span className="ui-nav-hint">{item.hint}</span> : null}
                    </a>
                  );
                })
              : null}
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({
  product,
  brandName,
  plan,
  logoUrl,
  nav,
  onNavigate,
  preview,
  clientPreview,
  crumbs,
  chips,
  onSignOut,
  onOpenPalette,
  header,
  toolbar,
  children,
  footer,
  phoneTabs,
}: {
  product: string;
  brandName: string;
  /** Plan or short line under the name in the sidebar. */
  plan?: string;
  logoUrl?: string | null;
  nav: NavItem[];
  onNavigate: (href: string) => void;
  preview?: boolean;
  /** Dark bar shown while an operator is looking at a client. */
  clientPreview?: { message: string; onExit: () => void };
  crumbs?: Crumb[];
  chips?: string[];
  onSignOut?: () => void;
  onOpenPalette?: () => void;
  /** Shown in the slim header. The company app uses this for the current branch. */
  header?: ReactNode;
  /** Extra controls in the header, such as the alerts bell. */
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Bottom tabs on a phone. More is added by the shell. */
  phoneTabs?: PhoneTab[];
}) {
  const phone = usePhone();
  const [pageTitle, setPageTitle] = useState('');
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const showContext =
    (crumbs && crumbs.length > 0) || (chips && chips.length > 0) || header || toolbar;

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem('omnivate.sidebar') === 'collapsed');
    } catch {
      // Keep the sidebar open when storage is blocked.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem('omnivate.sidebar', next ? 'collapsed' : 'open');
      } catch {
        // The choice still applies for this visit.
      }
      return next;
    });
  }

  if (phone) {
    return (
      <PhoneTitleContext.Provider value={setPageTitle}>
        <PhoneChrome
          product={product}
          brandName={brandName}
          plan={plan}
          logoUrl={logoUrl}
          nav={nav}
          onNavigate={onNavigate}
          preview={preview}
          clientPreview={clientPreview}
          crumbs={crumbs}
          chips={chips}
          onSignOut={onSignOut}
          onOpenPalette={onOpenPalette}
          header={header}
          toolbar={toolbar}
          footer={footer}
          phoneTabs={phoneTabs}
          pageTitle={pageTitle}
        >
          {children}
        </PhoneChrome>
      </PhoneTitleContext.Provider>
    );
  }

  return (
    <PhoneTitleContext.Provider value={setPageTitle}>
      <div className="ui-frame">
        {clientPreview ? (
          <div className="ui-preview-banner">
            <p>{clientPreview.message}</p>
            <Button variant="secondary" onClick={clientPreview.onExit}>
              Exit preview
            </Button>
          </div>
        ) : null}
        <div className={collapsed ? 'ui-shell is-collapsed' : 'ui-shell'}>
          <a className="ui-skip" href="#main">
            Skip to content
          </a>
          <aside className="ui-sidebar">
            <div className="ui-sidebar-inner">
              <a
                className="ui-brand"
                href={nav[0]?.href ?? '/'}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(nav[0]?.href ?? '/');
                }}
              >
                <img className="ui-mark-image" src={logoUrl || omnivateIconUrl} alt="" />
                <span>
                  <strong>{brandName}</strong>
                  <small>{plan || product}</small>
                </span>
              </a>
              <NavLinks items={nav} iconsOnly={collapsed} onNavigate={onNavigate} />
              <div className="ui-sidebar-foot">
                {preview ? <Badge tone="warn">Sample Data</Badge> : null}
                <Button
                  variant="ghost"
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  onClick={toggleCollapsed}
                >
                  <PanelLeft size={16} aria-hidden="true" />
                  <span className="ui-nav-label">{collapsed ? 'Expand' : 'Collapse'}</span>
                </Button>
                {onSignOut ? (
                  <Button variant="ghost" aria-label="Sign Out" onClick={onSignOut}>
                    <LogOut size={16} aria-hidden="true" />
                    <span className="ui-nav-label">Sign Out</span>
                  </Button>
                ) : null}
              </div>
            </div>
          </aside>
          <div className="ui-workspace">
            <div className="ui-mobile-bar">
              <Button variant="secondary" aria-label="Open Menu" onClick={() => setMenu(true)}>
                <MenuIcon size={18} aria-hidden="true" />
              </Button>
              <strong>{brandName}</strong>
              <span className="ui-mobile-tools">
                {onOpenPalette ? (
                  <Button variant="secondary" aria-label="Jump To" onClick={onOpenPalette}>
                    <Search size={18} aria-hidden="true" />
                  </Button>
                ) : null}
              </span>
            </div>
            {onOpenPalette ? (
              <div className="ui-search-row">
                <SearchBar onOpen={onOpenPalette} />
              </div>
            ) : null}
            {showContext ? (
              <div className="ui-context">
                {crumbs && crumbs.length > 0 ? (
                  <ol className="ui-crumbs">
                    {crumbs.map((crumb, index) => (
                      <li key={`${crumb.label}-${index}`}>
                        {crumb.href ? (
                          <a
                            href={crumb.href}
                            onClick={(event) => {
                              event.preventDefault();
                              onNavigate(crumb.href!);
                            }}
                          >
                            {crumb.label}
                          </a>
                        ) : (
                          crumb.label
                        )}
                        {index < crumbs.length - 1 ? <span aria-hidden="true"> &gt; </span> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <span />
                )}
                <div className="ui-context-tools">
                  {chips?.map((chip) => (
                    <span key={chip} className="ui-chip quiet">
                      {chip}
                    </span>
                  ))}
                  {header}
                  {toolbar}
                </div>
              </div>
            ) : null}
            <main className="ui-main" id="main">
              {children}
              {footer ? (
                <footer className="ui-footer" role="contentinfo">
                  {footer}
                </footer>
              ) : null}
            </main>
          </div>
          <DialogFrame open={menu} onOpenChange={setMenu} title="Menu">
            <NavLinks
              items={nav}
              onNavigate={(href) => {
                setMenu(false);
                onNavigate(href);
              }}
            />
            <div className="ui-actions" style={{ marginTop: 16 }}>
              {onSignOut ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMenu(false);
                    onSignOut();
                  }}
                >
                  Sign Out
                </Button>
              ) : null}
              <Dialog.Close asChild>
                <Button variant="ghost">
                  <X size={16} aria-hidden="true" /> Close
                </Button>
              </Dialog.Close>
            </div>
          </DialogFrame>
        </div>
      </div>
    </PhoneTitleContext.Provider>
  );
}

function PhoneChrome({
  product,
  brandName,
  plan,
  logoUrl,
  nav,
  onNavigate,
  preview,
  clientPreview,
  crumbs,
  chips,
  onSignOut,
  onOpenPalette,
  header,
  toolbar,
  children,
  footer,
  phoneTabs,
  pageTitle,
}: {
  product: string;
  brandName: string;
  plan?: string;
  logoUrl?: string | null;
  nav: NavItem[];
  onNavigate: (href: string) => void;
  preview?: boolean;
  clientPreview?: { message: string; onExit: () => void };
  crumbs?: Crumb[];
  chips?: string[];
  onSignOut?: () => void;
  onOpenPalette?: () => void;
  header?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  phoneTabs?: PhoneTab[];
  pageTitle: string;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  const tabs = phoneTabs && phoneTabs.length > 0 ? phoneTabs : defaultPhoneTabs(nav);
  const currentLabel = nav.find((item) => item.current)?.label;
  const crumbLabel = crumbs && crumbs.length > 0 ? crumbs[crumbs.length - 1]?.label : '';
  const title =
    pageTitle || (currentLabel === 'Today' ? 'Home' : currentLabel) || crumbLabel || brandName;
  const initial = (brandName.trim().charAt(0) || 'O').toUpperCase();
  const phoneNav = nav
    .filter((item) => item.href && item.state === 'ready' && PHONE_NAV_LABELS.has(item.label))
    .map((item) => (item.label === 'Today' ? { ...item, label: 'Home' } : item));

  return (
    <PhoneToolsContext.Provider
      value={{
        openAccount: () => setAccountOpen(true),
        openSearch: () => onOpenPalette?.(),
      }}
    >
      <div className="ui-frame ui-phone">
        {clientPreview ? (
          <div className="ui-preview-banner">
            <p>{clientPreview.message}</p>
            <Button variant="secondary" onClick={clientPreview.onExit}>
              Exit preview
            </Button>
          </div>
        ) : null}
        <a className="ui-skip" href="#main">
          Skip to content
        </a>
        <header className="ui-phone-bar">
          <p className="ui-phone-title" aria-hidden="true">
            {title}
          </p>
          <span ref={setBarSlot} className="ui-phone-bar-action" />
          <span className="ui-phone-tools">
            {onOpenPalette ? (
              <Button variant="ghost" aria-label="Search" onClick={onOpenPalette}>
                <Search size={22} aria-hidden="true" />
              </Button>
            ) : null}
            <Button variant="ghost" aria-label="Account" onClick={() => setAccountOpen(true)}>
              <span className="ui-avatar" aria-hidden="true">
                {initial}
              </span>
            </Button>
          </span>
        </header>
        <main className="ui-main" id="main">
          <PhoneBarSlotContext.Provider value={barSlot}>{children}</PhoneBarSlotContext.Provider>
          {footer ? (
            <footer className="ui-footer" role="contentinfo">
              {footer}
            </footer>
          ) : null}
        </main>
        <nav className="ui-tabbar" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = icons[tab.icon];
            const on = tabIsCurrent(tab);
            if (tab.center) {
              return (
                <a
                  key={tab.href}
                  href={tab.href}
                  className={on ? 'ui-tab-scan is-on' : 'ui-tab-scan'}
                  aria-current={on ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate(tab.href);
                  }}
                >
                  <span className="ui-scan-orb">
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <span>{tab.label}</span>
                </a>
              );
            }
            return (
              <a
                key={`${tab.href}-${tab.label}`}
                href={tab.href}
                className={on ? 'is-on' : undefined}
                aria-current={on ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(tab.href);
                }}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{tab.label}</span>
              </a>
            );
          })}
          <button
            type="button"
            className={moreOpen ? 'is-on' : undefined}
            onClick={() => setMoreOpen(true)}
          >
            <MenuIcon size={20} aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>
        <Sheet open={accountOpen} onOpenChange={setAccountOpen} title="Account">
          <div className="ui-account">
            <div className="ui-brand">
              <img className="ui-mark-image" src={logoUrl || omnivateIconUrl} alt="" />
              <span>
                <strong>{brandName}</strong>
                <small>{plan || product}</small>
              </span>
            </div>
            {chips && chips.length > 0 ? (
              <div className="ui-account-chips">
                {chips.map((chip) => (
                  <span key={chip} className="ui-chip quiet">
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}
            {header}
            {toolbar}
            {preview ? <Badge tone="warn">Sample Data</Badge> : null}
            {onSignOut ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setAccountOpen(false);
                  onSignOut();
                }}
              >
                <LogOut size={16} aria-hidden="true" />
                Sign Out
              </Button>
            ) : null}
          </div>
        </Sheet>
        <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
          <div className="ui-nav-sheet">
            <NavLinks
              items={phoneNav}
              expandAll
              onNavigate={(href) => {
                setMoreOpen(false);
                onNavigate(href);
              }}
            />
            <p className="ui-phone-desk-note">Manage your company on a computer.</p>
          </div>
        </Sheet>
      </div>
    </PhoneToolsContext.Provider>
  );
}

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  onSelect: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  items,
  query,
  onQueryChange,
  title = 'Jump To',
  description = 'Search for a company or an action.',
  placeholder = 'Type a company or action',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  query: string;
  onQueryChange: (query: string) => void;
  title?: string;
  description?: string;
  placeholder?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      wide
    >
      <Command
        className="ui-command"
        label="Jump To"
        shouldFilter
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onOpenChange(false);
          }
        }}
      >
        <Command.Input
          autoFocus
          placeholder={placeholder}
          value={query}
          onValueChange={onQueryChange}
        />
        <Command.List>
          <Command.Empty>Nothing matches. Try a company name.</Command.Empty>
          {groups.map(([group, groupItems]) => (
            <Command.Group key={group} heading={group}>
              {groupItems.map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${item.label} ${item.hint ?? ''}`}
                  onSelect={() => {
                    onOpenChange(false);
                    item.onSelect();
                  }}
                >
                  <span>{item.label}</span>
                  {item.hint ? <small>{item.hint}</small> : null}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </DialogFrame>
  );
}

export function Menu({
  label = 'More',
  items,
}: {
  label?: string;
  items: { label: string; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="ui-menu">
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </Button>
      {open ? (
        <div className="ui-menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="ui-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Form({
  children,
  onSubmit,
}: {
  children: ReactNode;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form
      className="ui-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event);
      }}
    >
      {children}
    </form>
  );
}
