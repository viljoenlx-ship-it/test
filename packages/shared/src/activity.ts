import { getIndustryPreset, isIndustryPresetKey } from './industry';
import { moduleIndex } from './module-index';
import { isModuleId } from './modules';
import { getCommercialPackage, isPackageKey } from './platform';
import { plainRoleName } from './rbac';

export type ActivityIcon =
  'sign-in' | 'sign-out' | 'shield' | 'company' | 'person' | 'settings' | 'module' | 'brand';

export type ActivityPhrase = {
  title: string;
  icon: ActivityIcon;
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

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function roleName(value: unknown): string | null {
  const data = record(value);
  const roles = data?.roles;
  const key = Array.isArray(roles) ? roles[roles.length - 1] : data?.roleKey;
  if (typeof key !== 'string') {
    return null;
  }
  const named = plainRoleName({ key });
  return named === 'Role' ? null : named;
}

function moduleName(value: unknown): string | null {
  const data = record(value);
  const id = data?.moduleId;
  if (typeof id === 'string' && isModuleId(id)) {
    return moduleIndex().find((entry) => entry.id === id)?.name ?? null;
  }
  return null;
}

function packageName(value: unknown): string | null {
  const key = record(value)?.packageKey;
  if (typeof key === 'string' && isPackageKey(key)) {
    return getCommercialPackage(key).name;
  }
  return null;
}

/** Plain-language label for an audit action. The raw code stays out of the list. */
export function describeActivity(action: string, afterData?: unknown): ActivityPhrase {
  const role = roleName(afterData);
  const moduleLabel = moduleName(afterData);
  const pack = packageName(afterData);
  const industryKey = record(afterData)?.industryPreset;
  const industry =
    typeof industryKey === 'string' && isIndustryPresetKey(industryKey)
      ? getIndustryPreset(industryKey).name
      : null;

  switch (action) {
    case 'platform.login.succeeded':
    case 'auth.login.succeeded':
      return { title: 'Signed in', icon: 'sign-in' };
    case 'platform.login.failed':
    case 'auth.login.failed':
      return { title: 'Sign-in failed', icon: 'sign-in' };
    case 'platform.login.locked':
    case 'auth.login.locked':
      return { title: 'Sign-in paused after too many tries', icon: 'sign-in' };
    case 'platform.login.mfa_required':
    case 'auth.login.mfa_required':
      return { title: 'Password accepted', icon: 'shield' };
    case 'platform.logout':
    case 'auth.logout':
      return { title: 'Signed out', icon: 'sign-out' };
    case 'platform.mfa.enrolled':
    case 'auth.mfa.enrolled':
      return { title: 'Set up authenticator', icon: 'shield' };
    case 'platform.mfa.failed':
    case 'auth.mfa.failed':
      return { title: 'Authenticator code did not match', icon: 'shield' };
    case 'auth.mfa.verified':
      return { title: 'Confirmed authenticator', icon: 'shield' };
    case 'platform.user.mfa_reset':
    case 'auth.mfa.reset':
      return { title: 'Reset authenticator', icon: 'shield' };
    case 'platform.tenant.created':
      return { title: 'Added a company', icon: 'company' };
    case 'platform.tenant.updated':
      return { title: 'Updated company details', icon: 'company' };
    case 'platform.tenant.suspended':
      return { title: 'Suspended the company', icon: 'company' };
    case 'platform.tenant.reactivated':
      return { title: 'Reactivated the company', icon: 'company' };
    case 'platform.tenant.archived':
      return { title: 'Archived the company', icon: 'company' };
    case 'platform.branding.updated':
      return { title: 'Updated branding', icon: 'brand' };
    case 'platform.branding.logo':
      return {
        title: record(afterData)?.hasLogo === false ? 'Removed the logo' : 'Updated the logo',
        icon: 'brand',
      };
    case 'platform.settings.updated':
      return { title: 'Updated settings', icon: 'settings' };
    case 'platform.package.assigned':
      return {
        title: pack ? `Changed the package to ${pack}` : 'Changed the package',
        icon: 'module',
      };
    case 'platform.industry.applied':
      return {
        title: industry ? `Applied the ${industry} preset` : 'Applied an industry preset',
        icon: 'module',
      };
    case 'identity.module.activated':
      return {
        title: moduleLabel ? `Switched on ${moduleLabel}` : 'Switched a module on',
        icon: 'module',
      };
    case 'identity.module.deactivated':
      return {
        title: moduleLabel ? `Switched off ${moduleLabel}` : 'Switched a module off',
        icon: 'module',
      };
    case 'platform.user.invited':
    case 'identity.invite.created':
      return { title: 'Invited a person', icon: 'person' };
    case 'identity.invite.accepted':
      return { title: 'Accepted an invite', icon: 'person' };
    case 'platform.user.role':
    case 'identity.role.assigned':
      return { title: role ? `Changed role to ${role}` : 'Changed a role', icon: 'person' };
    case 'platform.user.deactivated':
    case 'identity.user.deactivated':
      return { title: 'Deactivated a person', icon: 'person' };
    case 'platform.user.password_reset':
      return { title: 'Reset a password', icon: 'shield' };
    case 'platform.columns.updated':
      return { title: 'Updated the columns people see', icon: 'settings' };
    case 'platform.preview.opened':
      return { title: 'Opened a read-only preview', icon: 'company' };
    case 'platform.preview.closed':
      return { title: 'Left the preview', icon: 'company' };
    case 'krn06.import.completed': {
      const target = record(afterData)?.target;
      return {
        title: typeof target === 'string' ? `Imported ${target.toLowerCase()}` : 'Imported a file',
        icon: 'module',
      };
    }
    case 'krn06.import.undone':
      return { title: 'Undid an import', icon: 'module' };
    case 'seed.demo_tenant':
      return { title: 'Prepared a sample company', icon: 'company' };
    case 'seed.demo_users':
      return { title: 'Prepared sample people', icon: 'person' };
    case 'seed.krn04':
      return { title: 'Prepared sample fields and stages', icon: 'settings' };
    case 'workflow.fields.saved':
      return { title: 'Updated custom fields', icon: 'settings' };
    case 'workflow.field.created':
      return { title: 'Added a custom field', icon: 'settings' };
    case 'workflow.field.updated':
      return { title: 'Updated a custom field', icon: 'settings' };
    case 'workflow.field.archived':
      return { title: 'Archived a custom field', icon: 'settings' };
    case 'workflow.pipeline.updated':
      return { title: 'Updated the stages', icon: 'settings' };
    case 'workflow.pipeline.archived':
      return { title: 'Archived the stages', icon: 'settings' };
    case 'workflow.transition':
      return { title: 'Moved a record to the next stage', icon: 'settings' };
    case 'workflow.rule.created':
    case 'workflow.rule.updated':
      return { title: 'Updated an alert', icon: 'settings' };
    case 'workflow.rule.archived':
      return { title: 'Archived an alert', icon: 'settings' };
    case 'workflow.rule.logged':
      return { title: 'An alert wrote a log entry', icon: 'settings' };
    case 'workflow.notification.read':
      return { title: 'Read an alert', icon: 'settings' };
    case 'workflow.automation.created':
      return { title: 'Added an automation', icon: 'settings' };
    case 'workflow.automation.updated':
      return { title: 'Updated an automation', icon: 'settings' };
    case 'workflow.automation.archived':
      return { title: 'Archived an automation', icon: 'settings' };
    case 'workflow.automation.ran':
      return { title: 'Ran an automation', icon: 'settings' };
    case 'krn04.sample.start':
    case 'krn04.sample.finish':
      return { title: 'Moved a sample job card', icon: 'settings' };
    case 'seed.demo_stock':
      return { title: 'Prepared sample stock', icon: 'module' };
    case 'scm.barcode.assigned':
      return { title: 'Assigned a barcode', icon: 'module' };
    case 'scm.goods_receipt.posted':
      return { title: 'Received a delivery', icon: 'module' };
    case 'scm.label.printed':
      return { title: 'Printed stock labels', icon: 'module' };
    case 'scm.item.created':
      return { title: 'Added a catalog item', icon: 'module' };
    case 'scm.item.updated':
      return { title: 'Updated a catalog item', icon: 'module' };
    case 'scm.item.archived':
      return { title: 'Archived a catalog item', icon: 'module' };
    case 'scm.item.restored':
      return { title: 'Restored a catalog item', icon: 'module' };
    case 'scm.movement.receipt':
      return { title: 'Received stock', icon: 'module' };
    case 'scm.movement.issue':
      return { title: 'Wrote stock off', icon: 'module' };
    case 'scm.movement.adjustment':
      return { title: 'Adjusted stock', icon: 'module' };
    case 'scm.movement.transfer':
      return { title: 'Transferred stock', icon: 'module' };
    case 'scm.movement.reversal':
      return { title: 'Reversed a stock movement', icon: 'module' };
    case 'scm.adjustment.submit':
      return { title: 'Asked for an adjustment to be approved', icon: 'module' };
    case 'scm.adjustment.approve':
      return { title: 'Approved a stock adjustment', icon: 'module' };
    case 'scm.adjustment.reject':
      return { title: 'Declined a stock adjustment', icon: 'module' };
    case 'scm.settings.updated':
      return { title: 'Updated label settings', icon: 'settings' };
    default: {
      const data = record(afterData);
      if (data?.kind === 'transition' && typeof data.label === 'string') {
        return { title: `Moved a record: ${data.label}`, icon: 'settings' };
      }
      return { title: 'Recorded a change', icon: 'settings' };
    }
  }
}

function plainValue(value: unknown): string | null {
  if (typeof value === 'string') {
    if (/^[0-9a-f-]{36}$/i.test(value)) {
      return null;
    }
    if (/^[a-z][a-z0-9_]*\.[a-z0-9_.]+$/.test(value)) {
      return null;
    }
    const words = STATUS_WORDS[value] ?? value;
    return words.length > 80 ? `${words.slice(0, 77)}…` : words;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => plainValue(item)).filter((item): item is string => !!item);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return null;
}

/** Sentences for the activity detail. No codes, ids, or raw JSON. */
export function explainActivity(action: string, before?: unknown, after?: unknown): string[] {
  const lines = [`${describeActivity(action, after ?? before).title}.`];
  const afterRecord = record(after);
  const beforeRecord = record(before);
  const email = plainValue(afterRecord?.email);
  if (email) {
    lines.push(`Person: ${email}.`);
  }
  if (action === 'platform.user.password_reset') {
    lines.push('The password was replaced. It is not written in this record.');
  }
  if (action === 'platform.preview.opened') {
    lines.push('This was a look at the company. Nothing was changed.');
  }
  if (action === 'platform.preview.closed') {
    lines.push('The preview was closed.');
  }
  if (action === 'platform.columns.updated') {
    const stock = plainValue(afterRecord?.stock);
    const contacts = plainValue(afterRecord?.contacts);
    if (stock) {
      lines.push(`Stock list columns: ${stock}.`);
    }
    if (contacts) {
      lines.push(`Contact list columns: ${contacts}.`);
    }
  }
  const status = plainValue(afterRecord?.status);
  const previous = plainValue(beforeRecord?.status);
  if (status && previous && status !== previous) {
    lines.push(`Status changed from ${previous} to ${status}.`);
  }
  return lines;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) {
    return 'Just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? '1 min ago' : `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function exactTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Earlier';
  }
  const start = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((start(now) - start(date)) / 86_400_000);
  if (diff === 0) {
    return 'Today';
  }
  if (diff === 1) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
}
