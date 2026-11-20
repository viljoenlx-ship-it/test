import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  activeModuleSet,
  activationClosure,
  appendAuditEvent,
  hashPassword,
  memberships,
  mfaEnforcement,
  platformDashboard,
  roles,
  searchPlatformAudit,
  searchTenants,
  seedTenantRbac,
  sessions,
  setTenantModuleActive,
  tenantId,
  tenants,
  userInvites,
  userRoles,
  users,
  withTenant,
  type TenantTransaction,
} from '@omnivate/kernel';
import { countParties } from '@omnivate/module-krn-02';
import {
  brandColours,
  columnLayoutError,
  deactivationBlockers,
  getModule,
  industryActivationPlan,
  isIndustryPresetKey,
  isModuleId,
  isPackageKey,
  MODULES,
  modulesPulledIn,
  packageActivationPlan,
  parseColumnLayouts,
  parseHexColour,
  parseTenantParticulars,
  parseTenantSettings,
  presetTenantSettings,
  type ModuleId,
} from '@omnivate/shared';
import { requireOperator, type OperatorContext } from './auth-routes';
import { removeLogo, storeLogo } from './branding-files';
import {
  HttpError,
  INVITE_SECONDS,
  isUniqueViolation,
  readBody,
  readEmail,
  readPassword,
  readUuid,
  requestMeta,
  route,
  type RequestMeta,
} from './http';
import { hashToken, newToken } from './tokens';

function metaOf(request: Parameters<typeof requestMeta>[0]): RequestMeta {
  return requestMeta(request);
}

async function audit(
  tx: TenantTransaction,
  operator: OperatorContext,
  meta: RequestMeta,
  event: {
    action: string;
    entityType: string;
    entityId: string;
    beforeData: Record<string, unknown> | null;
    afterData: Record<string, unknown> | null;
  },
): Promise<void> {
  await appendAuditEvent(tx, {
    ...event,
    actorId: null,
    operatorId: operator.id,
    actorKind: 'operator',
    requestIp: meta.requestIp,
    userAgent: meta.userAgent,
  });
}

async function loadTenant(tx: TenantTransaction) {
  const rows = await tx.db.select().from(tenants);
  const row = rows[0];
  if (!row) {
    throw new HttpError(404, 'not_found', 'That company was not found.');
  }
  return row;
}

function presentTenant(row: Awaited<ReturnType<typeof loadTenant>>) {
  return {
    id: row.id,
    slug: row.slug,
    companyName: row.companyName,
    displayName: row.displayName,
    legalName: row.legalName,
    tradingName: row.tradingName,
    registrationNumber: row.registrationNumber,
    vatNumber: row.vatNumber,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.addressCity,
    province: row.addressProvince,
    postalCode: row.addressPostalCode,
    country: row.addressCountry,
    industryPreset: row.industryPreset,
    status: row.status,
    packageKey: row.packageKey,
    isDemo: row.isDemo,
    branding: {
      displayName: row.displayName,
      primary: row.brandPrimary,
      accent: row.brandAccent,
      hasLogo: row.logoStorageKey !== null,
    },
    settings: {
      currencyCode: row.currencyCode,
      vatRateBasisPoints: row.vatRateBasisPoints,
      timeZone: row.timezone,
      financialYearStartMonth: row.financialYearStartMonth,
    },
    columnLayouts: parseColumnLayouts(row.columnLayouts),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function setStatus(
  operator: OperatorContext,
  id: string,
  status: 'active' | 'suspended' | 'archived',
  meta: RequestMeta,
): Promise<void> {
  await withTenant(tenantId(id), async (tx) => {
    const before = await loadTenant(tx);
    if (before.status === status) {
      return;
    }
    const now = new Date();
    await tx.db
      .update(tenants)
      .set({
        status,
        suspendedAt: status === 'suspended' ? now : null,
        archivedAt: status === 'archived' ? now : null,
        updatedAt: now,
      })
      .where(eq(tenants.id, tx.tenantId));
    if (status !== 'active') {
      await tx.db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.tenantId, tx.tenantId), isNull(sessions.revokedAt)));
    }
    await audit(tx, operator, meta, {
      action: `platform.tenant.${status === 'active' ? 'reactivated' : status}`,
      entityType: 'tenant',
      entityId: tx.tenantId,
      beforeData: { status: before.status },
      afterData: { status },
    });
  });
}

export function registerTenantRoutes(app: FastifyInstance, webOrigin: string): void {
  app.get(
    '/control/dashboard',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.read');
      await requireOperator(request, 'audit.read');
      const counts = await platformDashboard();
      const recent = await searchPlatformAudit({
        tenantId: null,
        actor: '',
        action: '',
        from: null,
        to: null,
        limit: 8,
      });
      await reply.send({
        ...counts,
        recent: recent.map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt.toISOString(),
          action: row.action,
          tenantId: row.tenantId,
          tenantName: row.tenantName,
          actorLabel: row.actorLabel,
          actorKind: row.actorKind,
          beforeData: row.beforeData,
          afterData: row.afterData,
        })),
        operator: { displayName: operator.displayName },
        mfaEnforcement: mfaEnforcement(),
      });
    }),
  );

  app.get(
    '/control/tenants',
    route(async (request, reply) => {
      await requireOperator(request, 'tenants.read');
      const query = request.query as Record<string, unknown>;
      const q = typeof query.q === 'string' ? query.q.slice(0, 80) : '';
      const status = typeof query.status === 'string' ? query.status : 'open';
      if (!['open', 'all', 'active', 'suspended', 'archived'].includes(status)) {
        throw new HttpError(400, 'bad_request', 'Choose a status filter.');
      }
      const rows = await searchTenants({ query: q, status, limit: 50 });
      await reply.send({
        tenants: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    }),
  );

  app.post(
    '/control/tenants',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const particulars = parseTenantParticulars(readBody(request));
      const settings = presetTenantSettings();
      const id = randomUUID();
      const meta = metaOf(request);
      try {
        await withTenant(tenantId(id), async (tx) => {
          await tx.db.insert(tenants).values({
            id,
            slug: particulars.slug,
            displayName: particulars.companyName,
            companyName: particulars.companyName,
            legalName: particulars.legalName,
            tradingName: particulars.tradingName,
            registrationNumber: particulars.registrationNumber,
            vatNumber: particulars.vatNumber,
            contactEmail: particulars.contactEmail,
            contactPhone: particulars.contactPhone,
            addressLine1: particulars.addressLine1,
            addressLine2: particulars.addressLine2,
            addressCity: particulars.city,
            addressProvince: particulars.province,
            addressPostalCode: particulars.postalCode,
            addressCountry: particulars.country,
            industryPreset: particulars.industryPreset,
            status: 'active',
            packageKey: 'core',
            isDemo: false,
            timezone: settings.timeZone,
            currencyCode: settings.currencyCode,
            vatRateBasisPoints: settings.vatRateBasisPoints,
            financialYearStartMonth: settings.financialYearStartMonth,
            brandPrimary: brandColours.indigo,
            brandAccent: brandColours.teal,
          });
          await seedTenantRbac(tx.db, id);
          await audit(tx, operator, meta, {
            action: 'platform.tenant.created',
            entityType: 'tenant',
            entityId: id,
            beforeData: null,
            afterData: { ...particulars, packageKey: 'core', status: 'active' },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(
            409,
            'conflict',
            'That company code is already in use. Choose another.',
          );
        }
        throw error;
      }
      const created = await withTenant(tenantId(id), (tx) => loadTenant(tx));
      await reply.code(201).send(presentTenant(created));
    }),
  );

  app.get(
    '/control/tenants/:tenantId',
    route(async (request, reply) => {
      await requireOperator(request, 'tenants.read');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = await withTenant(tenantId(id), async (tx) => {
        const row = await loadTenant(tx);
        const active = await activeModuleSet(tx);
        return {
          ...presentTenant(row),
          partyCounts: await countParties(tx),
          modules: MODULES.map((module) => ({
            id: module.id,
            name: module.name,
            domain: module.domain,
            packaging: module.packaging,
            summary: module.summary,
            active: active.has(module.id),
            canDisable: module.canDisable,
          })),
        };
      });
      await reply.send(body);
    }),
  );

  app.patch(
    '/control/tenants/:tenantId',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const particulars = parseTenantParticulars(readBody(request));
      const meta = metaOf(request);
      try {
        await withTenant(tenantId(id), async (tx) => {
          const before = await loadTenant(tx);
          await tx.db
            .update(tenants)
            .set({
              slug: particulars.slug,
              companyName: particulars.companyName,
              legalName: particulars.legalName,
              tradingName: particulars.tradingName,
              registrationNumber: particulars.registrationNumber,
              vatNumber: particulars.vatNumber,
              contactEmail: particulars.contactEmail,
              contactPhone: particulars.contactPhone,
              addressLine1: particulars.addressLine1,
              addressLine2: particulars.addressLine2,
              addressCity: particulars.city,
              addressProvince: particulars.province,
              addressPostalCode: particulars.postalCode,
              addressCountry: particulars.country,
              industryPreset: particulars.industryPreset,
              updatedAt: new Date(),
            })
            .where(eq(tenants.id, tx.tenantId));
          await audit(tx, operator, meta, {
            action: 'platform.tenant.updated',
            entityType: 'tenant',
            entityId: tx.tenantId,
            beforeData: {
              companyName: before.companyName,
              slug: before.slug,
              legalName: before.legalName,
              tradingName: before.tradingName,
              registrationNumber: before.registrationNumber,
              vatNumber: before.vatNumber,
              contactEmail: before.contactEmail,
              contactPhone: before.contactPhone,
              city: before.addressCity,
              industryPreset: before.industryPreset,
            },
            afterData: { ...particulars },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(
            409,
            'conflict',
            'That company code is already in use. Choose another.',
          );
        }
        throw error;
      }
      const updated = await withTenant(tenantId(id), (tx) => loadTenant(tx));
      await reply.send(presentTenant(updated));
    }),
  );

  for (const [path, status] of [
    ['/control/tenants/:tenantId/suspend', 'suspended'],
    ['/control/tenants/:tenantId/reactivate', 'active'],
    ['/control/tenants/:tenantId/archive', 'archived'],
  ] as const) {
    app.post(
      path,
      route(async (request, reply) => {
        const operator = await requireOperator(request, 'tenants.write');
        const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
        await setStatus(operator, id, status, metaOf(request));
        const row = await withTenant(tenantId(id), (tx) => loadTenant(tx));
        await reply.send(presentTenant(row));
      }),
    );
  }

  app.put(
    '/control/tenants/:tenantId/branding',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'branding.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = readBody(request);
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (displayName.length < 1 || displayName.length > 120) {
        throw new HttpError(400, 'bad_request', 'Enter the name people see when they sign in.');
      }
      const primary = parseHexColour(body.primary, 'Primary colour');
      const accent = parseHexColour(body.accent, 'Accent colour');
      const meta = metaOf(request);
      await withTenant(tenantId(id), async (tx) => {
        const before = await loadTenant(tx);
        await tx.db
          .update(tenants)
          .set({
            displayName,
            brandPrimary: primary,
            brandAccent: accent,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, tx.tenantId));
        await audit(tx, operator, meta, {
          action: 'platform.branding.updated',
          entityType: 'tenant',
          entityId: tx.tenantId,
          beforeData: {
            displayName: before.displayName,
            primary: before.brandPrimary,
            accent: before.brandAccent,
          },
          afterData: { displayName, primary, accent },
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/logo',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'branding.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const uploaded = await (
        request as typeof request & {
          file: () => Promise<{ toBuffer: () => Promise<Buffer> } | undefined>;
        }
      ).file();
      if (!uploaded) {
        throw new HttpError(400, 'bad_request', 'Choose a logo file.');
      }
      const bytes = await uploaded.toBuffer();
      const key = await storeLogo(id, bytes);
      const meta = metaOf(request);
      let previous: string | null = null;
      await withTenant(tenantId(id), async (tx) => {
        const before = await loadTenant(tx);
        previous = before.logoStorageKey;
        await tx.db
          .update(tenants)
          .set({ logoStorageKey: key, updatedAt: new Date() })
          .where(eq(tenants.id, tx.tenantId));
        await audit(tx, operator, meta, {
          action: 'platform.branding.logo',
          entityType: 'tenant',
          entityId: tx.tenantId,
          beforeData: { hasLogo: previous !== null },
          afterData: { hasLogo: true },
        });
      });
      if (previous && previous !== key) {
        await removeLogo(id, previous);
      }
      await reply.send({ ok: true, hasLogo: true });
    }),
  );

  app.delete(
    '/control/tenants/:tenantId/logo',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'branding.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const meta = metaOf(request);
      let previous: string | null = null;
      await withTenant(tenantId(id), async (tx) => {
        const before = await loadTenant(tx);
        previous = before.logoStorageKey;
        if (!previous) {
          return;
        }
        await tx.db
          .update(tenants)
          .set({ logoStorageKey: null, updatedAt: new Date() })
          .where(eq(tenants.id, tx.tenantId));
        await audit(tx, operator, meta, {
          action: 'platform.branding.logo',
          entityType: 'tenant',
          entityId: tx.tenantId,
          beforeData: { hasLogo: true },
          afterData: { hasLogo: false },
        });
      });
      await removeLogo(id, previous);
      await reply.send({ ok: true, hasLogo: false });
    }),
  );

  app.put(
    '/control/tenants/:tenantId/settings',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'settings.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const settings = parseTenantSettings(readBody(request));
      const meta = metaOf(request);
      await withTenant(tenantId(id), async (tx) => {
        const before = await loadTenant(tx);
        await tx.db
          .update(tenants)
          .set({
            currencyCode: settings.currencyCode,
            vatRateBasisPoints: settings.vatRateBasisPoints,
            timezone: settings.timeZone,
            financialYearStartMonth: settings.financialYearStartMonth,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, tx.tenantId));
        await audit(tx, operator, meta, {
          action: 'platform.settings.updated',
          entityType: 'tenant',
          entityId: tx.tenantId,
          beforeData: {
            currencyCode: before.currencyCode,
            vatRateBasisPoints: before.vatRateBasisPoints,
            timeZone: before.timezone,
            financialYearStartMonth: before.financialYearStartMonth,
          },
          afterData: { ...settings },
        });
      });
      await reply.send({ ok: true, settings });
    }),
  );

  app.put(
    '/control/tenants/:tenantId/package',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'modules.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = readBody(request);
      const packageKey = typeof body.packageKey === 'string' ? body.packageKey : '';
      if (!isPackageKey(packageKey)) {
        throw new HttpError(400, 'bad_request', 'Choose a package.');
      }
      const meta = metaOf(request);
      const plan = await withTenant(tenantId(id), async (tx) => {
        const before = await loadTenant(tx);
        if (before.packageKey !== packageKey) {
          await tx.db
            .update(tenants)
            .set({ packageKey, updatedAt: new Date() })
            .where(eq(tenants.id, tx.tenantId));
          await audit(tx, operator, meta, {
            action: 'platform.package.assigned',
            entityType: 'tenant',
            entityId: tx.tenantId,
            beforeData: { packageKey: before.packageKey },
            afterData: { packageKey },
          });
        }
        const active = await activeModuleSet(tx);
        const activation = packageActivationPlan(packageKey);
        return {
          packageKey,
          willActivate: activation.sequence.filter((moduleId) => !active.has(moduleId)),
          pulledIn: activation.pulledIn.filter((moduleId) => !active.has(moduleId)),
        };
      });
      await reply.send(plan);
    }),
  );

  app.post(
    '/control/tenants/:tenantId/package/apply',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'modules.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const confirm = readBody(request).confirm === true;
      const meta = metaOf(request);
      const result = await withTenant(tenantId(id), async (tx) => {
        const row = await loadTenant(tx);
        if (!isPackageKey(row.packageKey)) {
          throw new HttpError(400, 'bad_request', 'Choose a package first.');
        }
        const active = await activeModuleSet(tx);
        const activation = packageActivationPlan(row.packageKey);
        const willActivate = activation.sequence.filter((moduleId) => !active.has(moduleId));
        if (!confirm) {
          return { needsConfirm: true, willActivate, pulledIn: activation.pulledIn };
        }
        for (const moduleId of willActivate) {
          await setTenantModuleActive(tx, {
            actorId: null,
            operatorId: operator.id,
            moduleId,
            active: true,
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          });
        }
        return { needsConfirm: false, willActivate };
      });
      await reply.send(result);
    }),
  );

  app.get(
    '/control/tenants/:tenantId/modules/preview',
    route(async (request, reply) => {
      await requireOperator(request, 'tenants.read');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const query = request.query as Record<string, unknown>;
      const moduleId = typeof query.moduleId === 'string' ? query.moduleId : '';
      if (!isModuleId(moduleId)) {
        throw new HttpError(400, 'bad_request', 'Choose a module.');
      }
      const turningOn = query.active !== 'false';
      const preview = await withTenant(tenantId(id), async (tx) => {
        const active = await activeModuleSet(tx);
        return {
          moduleId,
          active: turningOn,
          locked: !getModule(moduleId).canDisable,
          pulledIn: turningOn ? modulesPulledIn(active, moduleId) : [],
          blockers: turningOn ? [] : deactivationBlockers(active, moduleId),
        };
      });
      await reply.send(preview);
    }),
  );

  app.post(
    '/control/tenants/:tenantId/modules',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'modules.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = readBody(request);
      const moduleId = typeof body.moduleId === 'string' ? body.moduleId : '';
      if (!isModuleId(moduleId)) {
        throw new HttpError(400, 'bad_request', 'Choose a module.');
      }
      const turningOn = body.active !== false;
      const confirm = body.confirm === true;
      const meta = metaOf(request);
      const result = await withTenant(tenantId(id), async (tx) => {
        const active = await activeModuleSet(tx);
        if (turningOn) {
          const pulledIn = modulesPulledIn(active, moduleId);
          if (pulledIn.length > 0 && !confirm) {
            return { needsConfirm: true as const, pulledIn, moduleId };
          }
          const steps = activationClosure(moduleId).filter((item) => !active.has(item));
          for (const step of steps) {
            await setTenantModuleActive(tx, {
              actorId: null,
              operatorId: operator.id,
              moduleId: step,
              active: true,
              requestIp: meta.requestIp,
              userAgent: meta.userAgent,
            });
          }
          return { needsConfirm: false as const, activated: steps };
        }
        const blockers = deactivationBlockers(active, moduleId);
        if (!getModule(moduleId).canDisable || blockers.length > 0) {
          throw new HttpError(
            409,
            'module_locked',
            !getModule(moduleId).canDisable
              ? `${moduleId} is part of the kernel foundation and cannot be disabled.`
              : `Cannot deactivate ${moduleId} while these modules are active: ${blockers.join(', ')}.`,
          );
        }
        await setTenantModuleActive(tx, {
          actorId: null,
          operatorId: operator.id,
          moduleId,
          active: false,
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
        return { needsConfirm: false as const, activated: [] as ModuleId[] };
      });
      if (result.needsConfirm) {
        await reply.code(409).send({
          error: 'confirm_prerequisites',
          message: `Switching on ${moduleId} also switches on ${result.pulledIn.join(', ')}.`,
          pulledIn: result.pulledIn,
        });
        return;
      }
      await reply.send({ ok: true, activated: result.activated });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/industry/apply',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'modules.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const confirm = readBody(request).confirm === true;
      const meta = metaOf(request);
      const result = await withTenant(tenantId(id), async (tx) => {
        const row = await loadTenant(tx);
        if (!row.industryPreset || !isIndustryPresetKey(row.industryPreset)) {
          throw new HttpError(400, 'bad_request', 'Choose an industry preset first.');
        }
        const plan = industryActivationPlan(row.industryPreset);
        const active = await activeModuleSet(tx);
        const willActivate = plan.sequence.filter((moduleId) => !active.has(moduleId));
        if (!confirm) {
          return {
            needsConfirm: true,
            willActivate,
            pulledIn: plan.pulledIn.filter((moduleId) => !active.has(moduleId)),
          };
        }
        for (const moduleId of willActivate) {
          await setTenantModuleActive(tx, {
            actorId: null,
            operatorId: operator.id,
            moduleId,
            active: true,
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          });
        }
        await audit(tx, operator, meta, {
          action: 'platform.industry.applied',
          entityType: 'tenant',
          entityId: tx.tenantId,
          beforeData: { industryPreset: row.industryPreset, active: [...active] },
          afterData: { industryPreset: row.industryPreset, activated: willActivate },
        });
        return { needsConfirm: false, willActivate };
      });
      await reply.send(result);
    }),
  );

  app.get(
    '/control/tenants/:tenantId/users',
    route(async (request, reply) => {
      await requireOperator(request, 'users.read');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = await withTenant(tenantId(id), async (tx) => {
        const rows = await tx.db
          .select({
            userId: memberships.userId,
            status: memberships.status,
            email: users.email,
            displayName: users.displayName,
            totpEnabled: users.totpEnabled,
            roleKey: roles.key,
            roleName: roles.name,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .leftJoin(
            userRoles,
            and(
              eq(userRoles.userId, memberships.userId),
              eq(userRoles.tenantId, memberships.tenantId),
            ),
          )
          .leftJoin(roles, eq(roles.id, userRoles.roleId));
        const byUser = new Map<
          string,
          {
            id: string;
            email: string;
            displayName: string;
            status: string;
            totpEnabled: boolean;
            roles: { key: string; name: string }[];
          }
        >();
        for (const row of rows) {
          const current = byUser.get(row.userId) ?? {
            id: row.userId,
            email: row.email,
            displayName: row.displayName,
            status: row.status,
            totpEnabled: row.totpEnabled,
            roles: [],
          };
          if (row.roleKey && row.roleName) {
            current.roles.push({ key: row.roleKey, name: row.roleName });
          }
          byUser.set(row.userId, current);
        }
        const signIns = await tx.db
          .select({
            userId: sessions.userId,
            at: sql<Date | null>`max(${sessions.createdAt})`,
          })
          .from(sessions)
          .groupBy(sessions.userId);
        const lastByUser = new Map(
          signIns.map((row) => [row.userId, row.at ? new Date(row.at).toISOString() : null]),
        );
        const roleRows = await tx.db.select({ key: roles.key, name: roles.name }).from(roles);
        return {
          users: [...byUser.values()]
            .map((person) => ({ ...person, lastSignedIn: lastByUser.get(person.id) ?? null }))
            .sort((left, right) => left.displayName.localeCompare(right.displayName)),
          roles: roleRows.sort((left, right) => left.name.localeCompare(right.name)),
        };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/control/tenants/:tenantId/users/invite',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'users.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = readBody(request);
      const email = readEmail(body.email);
      const roleKey = typeof body.roleKey === 'string' ? body.roleKey : '';
      const meta = metaOf(request);
      const token = newToken();
      const created = await withTenant(tenantId(id), async (tx) => {
        const roleRows = await tx.db
          .select({ id: roles.id, key: roles.key, name: roles.name })
          .from(roles)
          .where(eq(roles.key, roleKey));
        const role = roleRows[0];
        if (!role) {
          throw new HttpError(400, 'bad_request', 'Choose a role.');
        }
        const existing = await tx.db
          .select({ status: memberships.status })
          .from(users)
          .innerJoin(memberships, eq(memberships.userId, users.id))
          .where(eq(users.email, email));
        if (existing[0]?.status === 'active') {
          throw new HttpError(409, 'already_member', 'That person is already in this company.');
        }
        const expiresAt = new Date(Date.now() + INVITE_SECONDS * 1000);
        const inserted = await tx.db
          .insert(userInvites)
          .values({
            tenantId: tx.tenantId,
            email,
            roleId: role.id,
            tokenHash: hashToken(token),
            expiresAt,
            invitedBy: null,
          })
          .returning({ id: userInvites.id });
        const invite = inserted[0];
        if (!invite) {
          throw new Error('Invite was not saved.');
        }
        await audit(tx, operator, meta, {
          action: 'platform.user.invited',
          entityType: 'user_invite',
          entityId: invite.id,
          beforeData: null,
          afterData: { email, roleKey: role.key, expiresAt: expiresAt.toISOString() },
        });
        return { inviteId: invite.id, roleName: role.name, expiresAt: expiresAt.toISOString() };
      });
      const inviteUrl = `${webOrigin}/invite?token=${encodeURIComponent(token)}`;
      await reply.code(201).send({ ...created, email, inviteUrl });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/users/:userId/role',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'users.write');
      const params = request.params as { tenantId?: string; userId?: string };
      const id = readUuid(params.tenantId, 'company');
      const userId = readUuid(params.userId, 'person');
      const body = readBody(request);
      const roleKey = typeof body.roleKey === 'string' ? body.roleKey : '';
      const meta = metaOf(request);
      await withTenant(tenantId(id), async (tx) => {
        const roleRows = await tx.db
          .select({ id: roles.id, key: roles.key })
          .from(roles)
          .where(eq(roles.key, roleKey));
        const role = roleRows[0];
        if (!role) {
          throw new HttpError(400, 'bad_request', 'Choose a role.');
        }
        const member = await tx.db
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.userId, userId));
        if (!member[0]) {
          throw new HttpError(404, 'not_found', 'That person was not found.');
        }
        const previous = await tx.db
          .select({ key: roles.key })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(eq(userRoles.userId, userId));
        await tx.db.delete(userRoles).where(eq(userRoles.userId, userId));
        await tx.db.insert(userRoles).values({
          tenantId: tx.tenantId,
          userId,
          roleId: role.id,
          assignedBy: null,
        });
        await audit(tx, operator, meta, {
          action: 'platform.user.role',
          entityType: 'user',
          entityId: userId,
          beforeData: { roles: previous.map((item) => item.key) },
          afterData: { roles: [role.key] },
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/users/:userId/deactivate',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'users.write');
      const params = request.params as { tenantId?: string; userId?: string };
      const id = readUuid(params.tenantId, 'company');
      const userId = readUuid(params.userId, 'person');
      const meta = metaOf(request);
      await withTenant(tenantId(id), async (tx) => {
        const member = await tx.db
          .select({ id: memberships.id, status: memberships.status })
          .from(memberships)
          .where(eq(memberships.userId, userId));
        const row = member[0];
        if (!row) {
          throw new HttpError(404, 'not_found', 'That person was not found.');
        }
        if (row.status !== 'deactivated') {
          await tx.db
            .update(memberships)
            .set({ status: 'deactivated' })
            .where(eq(memberships.id, row.id));
        }
        await tx.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
        await audit(tx, operator, meta, {
          action: 'platform.user.deactivated',
          entityType: 'user',
          entityId: userId,
          beforeData: { status: row.status },
          afterData: { status: 'deactivated' },
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.put(
    '/control/tenants/:tenantId/column-layouts',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'client');
      const body = readBody(request);
      const problem = columnLayoutError(body);
      if (problem) {
        throw new HttpError(400, 'bad_request', problem);
      }
      const layouts = parseColumnLayouts(body);
      const meta = metaOf(request);
      await withTenant(tenantId(id), async (tx) => {
        const before = await loadTenant(tx);
        await tx.db
          .update(tenants)
          .set({ columnLayouts: layouts, updatedAt: new Date() })
          .where(eq(tenants.id, tx.tenantId));
        await audit(tx, operator, meta, {
          action: 'platform.columns.updated',
          entityType: 'tenant',
          entityId: tx.tenantId,
          beforeData: parseColumnLayouts(before.columnLayouts),
          afterData: layouts,
        });
      });
      await reply.send({ columnLayouts: layouts });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/users/:userId/password',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'users.write');
      const params = request.params as { tenantId?: string; userId?: string };
      const id = readUuid(params.tenantId, 'client');
      const userId = readUuid(params.userId, 'person');
      const body = readBody(request);
      const password = readPassword(body.password);
      const passwordHash = await hashPassword(password);
      const meta = metaOf(request);
      await withTenant(tenantId(id), async (tx) => {
        const member = await tx.db
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.userId, userId));
        if (!member[0]) {
          throw new HttpError(404, 'not_found', 'That person was not found.');
        }
        await tx.db.execute(sql`SELECT krn_set_password(${userId}::uuid, ${passwordHash})`);
        await tx.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
        await audit(tx, operator, meta, {
          action: 'platform.user.password_reset',
          entityType: 'user',
          entityId: userId,
          beforeData: null,
          afterData: { reset: true },
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/users/:userId/mfa/reset',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'users.write');
      const params = request.params as { tenantId?: string; userId?: string };
      const id = readUuid(params.tenantId, 'company');
      const userId = readUuid(params.userId, 'person');
      const meta = metaOf(request);
      await withTenant(tenantId(id), async (tx) => {
        const member = await tx.db
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.userId, userId));
        if (!member[0]) {
          throw new HttpError(404, 'not_found', 'That person was not found.');
        }
        const before = await tx.db
          .select({ totpEnabled: users.totpEnabled })
          .from(users)
          .where(eq(users.id, userId));
        await tx.db.execute(sql`SELECT krn_set_totp(${userId}::uuid, ${null}, false)`);
        await audit(tx, operator, meta, {
          action: 'platform.user.mfa_reset',
          entityType: 'user',
          entityId: userId,
          beforeData: { totpEnabled: before[0]?.totpEnabled ?? false },
          afterData: { totpEnabled: false },
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.get(
    '/control/audit',
    route(async (request, reply) => {
      await requireOperator(request, 'audit.read');
      const query = request.query as Record<string, unknown>;
      const tenant = typeof query.tenantId === 'string' && query.tenantId ? query.tenantId : null;
      if (tenant && !/^[0-9a-f-]{36}$/i.test(tenant)) {
        throw new HttpError(400, 'bad_request', 'Choose a company.');
      }
      const actor = typeof query.actor === 'string' ? query.actor.slice(0, 80) : '';
      const action = typeof query.action === 'string' ? query.action.slice(0, 80) : '';
      const from = parseDay(query.from, false);
      const to = parseDay(query.to, true);
      const rows = await searchPlatformAudit({
        tenantId: tenant,
        actor,
        action,
        from,
        to,
        limit: 80,
      });
      await reply.send({
        events: rows.map((row) => ({
          ...row,
          occurredAt: row.occurredAt.toISOString(),
        })),
      });
    }),
  );
}

function parseDay(value: unknown, end: boolean): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'bad_request', 'Use a date such as 2026-03-01.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'bad_request', 'Use a date such as 2026-03-01.');
  }
  if (end) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}
