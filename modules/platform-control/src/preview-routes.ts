import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  activeModuleSet,
  appendAuditEvent,
  closePreviewSession,
  exchangePreviewTicket,
  lookupPreviewSession,
  openPreviewTicket,
  tenantId,
  tenants,
  withTenant,
  type TenantTransaction,
} from '@omnivate/kernel';
import {
  formatZar,
  getCommercialPackage,
  isPackageKey,
  money,
  parseColumnLayouts,
  type ModuleId,
} from '@omnivate/shared';
import { requireOperator } from './auth-routes';
import { cookieOptions, HttpError, readBody, readUuid, requestMeta, route } from './http';
import { hashToken, newToken } from './tokens';

export const PREVIEW_COOKIE = 'omnivate_client_preview';
const TICKET_SECONDS = 2 * 60;
const PREVIEW_SECONDS = 20 * 60;

type PreviewContext = {
  companyName: string;
  displayName: string;
  packageName: string;
  city: string | null;
  vatNumber: string | null;
  branchName: string | null;
  modules: ModuleId[];
  columnLayouts: ReturnType<typeof parseColumnLayouts>;
  logoUrl: string | null;
  summaries: {
    contacts: number | null;
    customers: number | null;
    suppliers: number | null;
    stockItems: number | null;
    lowStock: number | null;
    stockValueLabel: string | null;
  };
  exitUrl: string;
};

function controlBase(webOrigin: string): string {
  const configured = process.env.CONTROL_ORIGIN?.replace(/\/$/, '');
  if (configured) {
    return configured;
  }
  const web = webOrigin.replace(/\/$/, '');
  if (web.includes(':5173')) {
    return web.replace(':5173', ':5174');
  }
  return web;
}

function decimalToMicros(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = trimmed.replace('-', '').split('.');
  if (!/^\d+$/.test(whole) || (fraction.length > 0 && !/^\d+$/.test(fraction))) {
    return 0n;
  }
  const micros = BigInt(whole) * 10000n + BigInt((fraction + '0000').slice(0, 4));
  return negative ? -micros : micros;
}

function extendCost(quantity: string, unitCents: bigint): bigint {
  const micros = decimalToMicros(quantity);
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const rounded = (absolute * unitCents + 5000n) / 10000n;
  return negative ? -rounded : rounded;
}

function asBigint(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return 0n;
}

function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return '';
}

async function rowsOf(tx: TenantTransaction, query: ReturnType<typeof sql>) {
  const result = await tx.db.execute(query);
  return result.rows as Record<string, unknown>[];
}

async function loadContext(tx: TenantTransaction, exitUrl: string): Promise<PreviewContext> {
  const tenantRows = await tx.db.select().from(tenants);
  const tenant = tenantRows[0];
  if (!tenant) {
    throw new HttpError(404, 'not_found', 'That client was not found.');
  }
  const modules = [...(await activeModuleSet(tx))];
  const on = new Set(modules);
  const branch = await rowsOf(
    tx,
    sql`SELECT name FROM krn03_branches WHERE archived_at IS NULL ORDER BY is_head_office DESC, name LIMIT 1`,
  );
  let contacts: number | null = null;
  let customers: number | null = null;
  let suppliers: number | null = null;
  if (on.has('KRN-02')) {
    const counts = await rowsOf(
      tx,
      sql`
        SELECT
          count(*) FILTER (WHERE status = 'active') AS contacts,
          count(*) FILTER (
            WHERE status = 'active' AND EXISTS (
              SELECT 1 FROM party_roles AS role_row
              WHERE role_row.party_id = parties.id AND role_row.role = 'customer'
            )
          ) AS customers,
          count(*) FILTER (
            WHERE status = 'active' AND EXISTS (
              SELECT 1 FROM party_roles AS role_row
              WHERE role_row.party_id = parties.id AND role_row.role = 'supplier'
            )
          ) AS suppliers
        FROM parties
      `,
    );
    contacts = Number(counts[0]?.contacts ?? 0);
    customers = Number(counts[0]?.customers ?? 0);
    suppliers = Number(counts[0]?.suppliers ?? 0);
  }
  let stockItems: number | null = null;
  let lowStock: number | null = null;
  let stockValueLabel: string | null = null;
  if (on.has('SCM-01')) {
    const items = await stockRows(tx);
    stockItems = items.length;
    lowStock = items.filter((item) => item.low).length;
    const value = items.reduce((sum, item) => sum + item.valueCents, 0n);
    stockValueLabel = formatZar(money(value));
  }
  return {
    companyName: tenant.companyName,
    displayName: tenant.displayName,
    packageName: isPackageKey(tenant.packageKey)
      ? getCommercialPackage(tenant.packageKey).name
      : 'Core Platform (Included)',
    city: tenant.addressCity,
    vatNumber: tenant.vatNumber,
    branchName: typeof branch[0]?.name === 'string' ? branch[0].name : null,
    modules,
    columnLayouts: parseColumnLayouts(tenant.columnLayouts),
    logoUrl: tenant.logoStorageKey ? `/api/branding/${tenant.slug}/logo` : null,
    summaries: { contacts, customers, suppliers, stockItems, lowStock, stockValueLabel },
    exitUrl,
  };
}

type StockPreviewRow = {
  id: string;
  name: string;
  code: string;
  onHandLabel: string;
  valueLabel: string;
  priceLabel: string;
  low: boolean;
  valueCents: bigint;
};

async function stockRows(tx: TenantTransaction): Promise<StockPreviewRow[]> {
  const rows = await rowsOf(
    tx,
    sql`
      SELECT
        i.id,
        i.name,
        i.sku AS code,
        i.kind,
        i.base_uom_plural AS plural,
        i.selling_price_cents::text AS price,
        i.cost_cents::text AS cost,
        i.reorder_level::text AS reorder,
        COALESCE((
          SELECT sum(b.quantity) FROM scm01_balances AS b WHERE b.item_id = i.id
        ), 0)::text AS on_hand
      FROM scm01_items AS i
      WHERE i.status = 'active'
      ORDER BY i.name
      LIMIT 100
    `,
  );
  return rows.map((row) => {
    const onHand = asText(row.on_hand) || '0';
    const cost = asBigint(row.cost);
    const price = asBigint(row.price);
    const reorder = asText(row.reorder) || '0';
    const kind = asText(row.kind);
    const valueCents = kind === 'stock' ? extendCost(onHand, cost) : 0n;
    const onHandMicros = decimalToMicros(onHand);
    const reorderMicros = decimalToMicros(reorder);
    const plural = asText(row.plural) || 'units';
    const amount = onHand.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return {
      id: asText(row.id),
      name: asText(row.name),
      code: asText(row.code),
      onHandLabel: kind === 'stock' ? `${amount} ${plural}` : '—',
      valueLabel: kind === 'stock' ? formatZar(money(valueCents)) : '—',
      priceLabel: formatZar(money(price)),
      low: kind === 'stock' && reorderMicros > 0n && onHandMicros <= reorderMicros,
      valueCents,
    };
  });
}

async function requirePreview(request: FastifyRequest) {
  const raw = request.cookies[PREVIEW_COOKIE];
  if (!raw) {
    throw new HttpError(401, 'unauthenticated', 'Open the preview from the client page.');
  }
  const preview = await lookupPreviewSession(hashToken(raw));
  if (!preview) {
    throw new HttpError(401, 'unauthenticated', 'This preview has ended. Open it again.');
  }
  return { raw, preview };
}

async function readOnly(reply: FastifyReply): Promise<void> {
  await reply
    .code(405)
    .send({ error: 'read_only', message: 'Preview is read-only. Nothing is changed.' });
}

export function registerPreviewRoutes(app: FastifyInstance, webOrigin: string): void {
  const exitFor = (id: string) => `${controlBase(webOrigin)}/control/tenants/${id}`;

  app.post(
    '/control/tenants/:tenantId/client-preview',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.read');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'client');
      const meta = requestMeta(request);
      await withTenant(tenantId(id), async (tx) => {
        const row = (await tx.db.select({ id: tenants.id }).from(tenants))[0];
        if (!row) {
          throw new HttpError(404, 'not_found', 'That client was not found.');
        }
        await appendAuditEvent(tx, {
          action: 'platform.preview.opened',
          entityType: 'tenant',
          entityId: tx.tenantId,
          actorId: null,
          operatorId: operator.id,
          actorKind: 'operator',
          beforeData: null,
          afterData: { readOnly: true },
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
      });
      const ticket = newToken();
      await openPreviewTicket(
        operator.id,
        id,
        hashToken(ticket),
        new Date(Date.now() + TICKET_SECONDS * 1000),
      );
      const previewUrl = `${webOrigin.replace(/\/$/, '')}/preview?ticket=${encodeURIComponent(ticket)}`;
      await reply.send({ previewUrl });
    }),
  );

  app.post(
    '/preview/exchange',
    route(async (request, reply) => {
      const body = readBody(request);
      const ticket = typeof body.ticket === 'string' ? body.ticket : '';
      if (ticket.length < 20) {
        throw new HttpError(401, 'unauthenticated', 'Open the preview from the client page.');
      }
      const sessionToken = newToken();
      const found = await exchangePreviewTicket(
        hashToken(ticket),
        hashToken(sessionToken),
        new Date(Date.now() + PREVIEW_SECONDS * 1000),
      );
      if (!found) {
        throw new HttpError(401, 'unauthenticated', 'This preview link has already been used.');
      }
      reply.setCookie(PREVIEW_COOKIE, sessionToken, cookieOptions(PREVIEW_SECONDS));
      const context = await withTenant(tenantId(found.tenantId), (tx) =>
        loadContext(tx, exitFor(found.tenantId)),
      );
      await reply.send(context);
    }),
  );

  app.get(
    '/preview/context',
    route(async (request, reply) => {
      const { preview } = await requirePreview(request);
      const context = await withTenant(tenantId(preview.tenantId), (tx) =>
        loadContext(tx, exitFor(preview.tenantId)),
      );
      await reply.send(context);
    }),
  );

  app.get(
    '/preview/stock',
    route(async (request, reply) => {
      const { preview } = await requirePreview(request);
      const body = await withTenant(tenantId(preview.tenantId), async (tx) => {
        const modules = await activeModuleSet(tx);
        if (!modules.has('SCM-01')) {
          return { available: false, items: [] };
        }
        const items = await stockRows(tx);
        return {
          available: true,
          items: items.map(({ valueCents: _value, ...item }) => item),
        };
      });
      await reply.send(body);
    }),
  );

  app.get(
    '/preview/contacts',
    route(async (request, reply) => {
      const { preview } = await requirePreview(request);
      const body = await withTenant(tenantId(preview.tenantId), async (tx) => {
        const modules = await activeModuleSet(tx);
        if (!modules.has('KRN-02')) {
          return { available: false, contacts: [] };
        }
        const contacts = await rowsOf(
          tx,
          sql`
            SELECT
              p.id,
              p.display_name AS name,
              COALESCE((
                SELECT string_agg(role_row.role, ', ' ORDER BY role_row.role)
                FROM party_roles AS role_row
                WHERE role_row.party_id = p.id
              ), '') AS roles,
              COALESCE((
                SELECT channel.value
                FROM party_channels AS channel
                WHERE channel.party_id = p.id
                ORDER BY channel.is_primary DESC, channel.kind
                LIMIT 1
              ), '') AS reach,
              COALESCE((
                SELECT address.city
                FROM party_addresses AS address
                WHERE address.party_id = p.id
                ORDER BY address.is_primary DESC
                LIMIT 1
              ), '') AS city
            FROM parties AS p
            WHERE p.status = 'active'
            ORDER BY p.display_name
            LIMIT 100
          `,
        );
        return {
          available: true,
          contacts: contacts.map((row) => ({
            id: asText(row.id),
            name: asText(row.name),
            roles: asText(row.roles),
            reach: asText(row.reach) || '—',
            city: asText(row.city) || '—',
          })),
        };
      });
      await reply.send(body);
    }),
  );

  app.get(
    '/preview/people',
    route(async (request, reply) => {
      const { preview } = await requirePreview(request);
      const body = await withTenant(tenantId(preview.tenantId), async (tx) => {
        const people = await rowsOf(
          tx,
          sql`
            SELECT
              u.display_name AS name,
              u.email,
              m.status,
              COALESCE((
                SELECT string_agg(r.name, ', ' ORDER BY r.name)
                FROM user_roles AS ur
                JOIN roles AS r ON r.id = ur.role_id
                WHERE ur.user_id = u.id
              ), '') AS roles
            FROM memberships AS m
            JOIN users AS u ON u.id = m.user_id
            ORDER BY u.display_name
          `,
        );
        return {
          people: people.map((row, index) => ({
            id: String(index),
            name: asText(row.name),
            email: asText(row.email),
            status: asText(row.status),
            roles: asText(row.roles) || 'No role',
          })),
        };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/preview/exit',
    route(async (request, reply) => {
      const raw = request.cookies[PREVIEW_COOKIE];
      reply.clearCookie(PREVIEW_COOKIE, { path: '/' });
      if (!raw) {
        await reply.send({ ok: true });
        return;
      }
      const preview = await lookupPreviewSession(hashToken(raw));
      if (preview) {
        const meta = requestMeta(request);
        await withTenant(tenantId(preview.tenantId), async (tx) => {
          await appendAuditEvent(tx, {
            action: 'platform.preview.closed',
            entityType: 'tenant',
            entityId: tx.tenantId,
            actorId: null,
            operatorId: preview.operatorId,
            actorKind: 'operator',
            beforeData: null,
            afterData: { readOnly: true },
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          });
        });
        await closePreviewSession(hashToken(raw));
      }
      await reply.send({ ok: true });
    }),
  );

  for (const path of [
    '/preview/stock',
    '/preview/contacts',
    '/preview/people',
    '/preview/context',
  ]) {
    app.post(
      path,
      route(async (_request, reply) => {
        await readOnly(reply);
      }),
    );
  }
}
