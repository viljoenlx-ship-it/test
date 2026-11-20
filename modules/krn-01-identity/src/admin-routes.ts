import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  addSodRule,
  appendAuditEvent,
  disableSodRule,
  hasPermission,
  isModuleId,
  memberships,
  requirePermission,
  roles,
  rolePermissions,
  sessions,
  setTenantModuleActive,
  sodRules,
  tenantId,
  userInvites,
  userRoles,
  users,
  withTenant,
  type TenantTransaction,
} from '@omnivate/kernel';
import {
  HttpError,
  INVITE_SECONDS,
  centsOrNull,
  readActionKey,
  readBody,
  readEmail,
  readRoleKey,
  readUuid,
  requestMeta,
  route,
} from './http';
import type { Mailer } from './mailer';
import { requireSession } from './auth-routes';
import { hashToken, newToken } from './tokens';

async function assertKeepsAnOwner(
  tx: TenantTransaction,
  userId: string,
  nextRoleKey: string | null,
): Promise<void> {
  const current = await tx.db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tx.tenantId)));
  if (!current.some((role) => role.key === 'tenant_owner')) {
    return;
  }
  if (nextRoleKey === 'tenant_owner') {
    return;
  }
  const owners = await tx.db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(
      memberships,
      and(eq(memberships.userId, userRoles.userId), eq(memberships.tenantId, userRoles.tenantId)),
    )
    .where(and(eq(roles.key, 'tenant_owner'), eq(memberships.status, 'active')));
  const others = new Set(owners.map((row) => row.userId).filter((id) => id !== userId));
  if (others.size === 0) {
    throw new HttpError(409, 'last_owner', 'The company needs at least one active owner.');
  }
}

async function roleByKey(tx: TenantTransaction, key: string) {
  const rows = await tx.db
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      mfaRequired: roles.mfaRequired,
    })
    .from(roles)
    .where(eq(roles.key, key));
  return rows[0] ?? null;
}

export function registerAdminRoutes(app: FastifyInstance, webOrigin: string, mailer: Mailer): void {
  app.get(
    '/krn/users',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'read',
          moduleId: 'KRN-01',
        });
        const rows = await tx.db
          .select({
            userId: memberships.userId,
            status: memberships.status,
            email: users.email,
            displayName: users.displayName,
            totpEnabled: users.totpEnabled,
            roleKey: roles.key,
            roleName: roles.name,
            mfaRequired: roles.mfaRequired,
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
            roles: { key: string; name: string; mfaRequired: boolean }[];
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
          if (row.roleKey && row.roleName && row.mfaRequired !== null) {
            current.roles.push({
              key: row.roleKey,
              name: row.roleName,
              mfaRequired: row.mfaRequired,
            });
          }
          byUser.set(row.userId, current);
        }
        const people = [...byUser.values()].sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        );
        return {
          users: people,
          canManageUsers: await hasPermission(tx, session.userId, {
            scope: 'krn',
            action: 'admin',
            moduleId: 'KRN-01',
          }),
        };
      });
      await reply.send(body);
    }),
  );

  app.get(
    '/krn/roles',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'read',
          moduleId: 'KRN-01',
        });
        const roleRows = await tx.db
          .select({
            id: roles.id,
            key: roles.key,
            name: roles.name,
            description: roles.description,
            mfaRequired: roles.mfaRequired,
          })
          .from(roles);
        const grantRows = await tx.db
          .select({
            roleId: rolePermissions.roleId,
            scope: rolePermissions.scope,
            modules: rolePermissions.modules,
            action: rolePermissions.action,
            accessLabel: rolePermissions.accessLabel,
            approvalLimitCents: rolePermissions.approvalLimitCents,
          })
          .from(rolePermissions);
        return {
          roles: roleRows
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((role) => ({
              ...role,
              grants: grantRows
                .filter((grant) => grant.roleId === role.id)
                .map((grant) => ({
                  scope: grant.scope,
                  modules: grant.modules,
                  action: grant.action,
                  accessLabel: grant.accessLabel,
                  approvalLimitCents: centsOrNull(grant.approvalLimitCents),
                })),
            })),
        };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/krn/invites',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = readBody(request);
      const email = readEmail(body.email);
      const roleKey = readRoleKey(body.roleKey);
      const meta = requestMeta(request);
      const token = newToken();
      const result = await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'admin',
          moduleId: 'KRN-01',
        });
        const role = await roleByKey(tx, roleKey);
        if (!role) {
          throw new HttpError(400, 'bad_request', 'Choose a role.');
        }
        const existing = await tx.db
          .select({ status: memberships.status, email: users.email })
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
            invitedBy: session.userId,
          })
          .returning({ id: userInvites.id });
        const invite = inserted[0];
        if (!invite) {
          throw new Error('Invite was not saved.');
        }
        await appendAuditEvent(tx, {
          action: 'identity.invite.created',
          entityType: 'user_invite',
          entityId: invite.id,
          actorId: session.userId,
          beforeData: null,
          afterData: { email, roleKey: role.key, expiresAt: expiresAt.toISOString() },
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
        return { id: invite.id, expiresAt: expiresAt.toISOString(), roleName: role.name };
      });

      const inviteUrl = `${webOrigin}/invite?token=${encodeURIComponent(token)}`;
      await mailer.send({
        to: email,
        subject: 'You are invited to Omnivate',
        text: `Open this link to join as ${result.roleName}:\n${inviteUrl}\n`,
      });
      await reply.code(201).send({
        inviteId: result.id,
        email,
        expiresAt: result.expiresAt,
        inviteUrl,
      });
    }),
  );

  app.post(
    '/krn/users/:userId/role',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const userId = readUuid((request.params as { userId?: string }).userId, 'person');
      const roleKey = readRoleKey(readBody(request).roleKey);
      const meta = requestMeta(request);
      await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'admin',
          moduleId: 'KRN-01',
        });
        const role = await roleByKey(tx, roleKey);
        if (!role) {
          throw new HttpError(400, 'bad_request', 'Choose a role.');
        }
        const member = await tx.db
          .select({ status: memberships.status })
          .from(memberships)
          .where(eq(memberships.userId, userId));
        if (!member[0]) {
          throw new HttpError(404, 'not_found', 'That person was not found.');
        }
        await assertKeepsAnOwner(tx, userId, role.key);
        const previous = await tx.db
          .select({ key: roles.key })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tx.tenantId)));
        await tx.db
          .delete(userRoles)
          .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tx.tenantId)));
        await tx.db.insert(userRoles).values({
          tenantId: tx.tenantId,
          userId,
          roleId: role.id,
          assignedBy: session.userId,
        });
        await appendAuditEvent(tx, {
          action: 'identity.role.assigned',
          entityType: 'user',
          entityId: userId,
          actorId: session.userId,
          beforeData: { roles: previous.map((item) => item.key) },
          afterData: { roles: [role.key] },
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.post(
    '/krn/users/:userId/deactivate',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const userId = readUuid((request.params as { userId?: string }).userId, 'person');
      if (userId === session.userId) {
        throw new HttpError(409, 'self', 'You cannot deactivate your own sign-in.');
      }
      const meta = requestMeta(request);
      await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'admin',
          moduleId: 'KRN-01',
        });
        const member = await tx.db
          .select({ id: memberships.id, status: memberships.status })
          .from(memberships)
          .where(eq(memberships.userId, userId));
        const row = member[0];
        if (!row) {
          throw new HttpError(404, 'not_found', 'That person was not found.');
        }
        await assertKeepsAnOwner(tx, userId, null);
        if (row.status !== 'deactivated') {
          await tx.db
            .update(memberships)
            .set({ status: 'deactivated' })
            .where(eq(memberships.id, row.id));
        }
        await tx.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(sessions.userId, userId),
              eq(sessions.tenantId, tx.tenantId),
              isNull(sessions.revokedAt),
            ),
          );
        await appendAuditEvent(tx, {
          action: 'identity.user.deactivated',
          entityType: 'user',
          entityId: userId,
          actorId: session.userId,
          beforeData: { status: row.status },
          afterData: { status: 'deactivated' },
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.post(
    '/krn/users/:userId/mfa/reset',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const userId = readUuid((request.params as { userId?: string }).userId, 'person');
      const meta = requestMeta(request);
      await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'admin',
          moduleId: 'KRN-01',
        });
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
        await appendAuditEvent(tx, {
          action: 'auth.mfa.reset',
          entityType: 'user',
          entityId: userId,
          actorId: session.userId,
          beforeData: { totpEnabled: before[0]?.totpEnabled ?? false },
          afterData: { totpEnabled: false },
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.get(
    '/krn/sod-rules',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const rules = await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'read',
          moduleId: 'KRN-01',
        });
        return tx.db
          .select({
            id: sodRules.id,
            actionA: sodRules.actionA,
            actionB: sodRules.actionB,
            description: sodRules.description,
            enabled: sodRules.enabled,
          })
          .from(sodRules);
      });
      await reply.send({ rules });
    }),
  );

  app.post(
    '/krn/sod-rules',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = readBody(request);
      const actionA = readActionKey(body.actionA);
      const actionB = readActionKey(body.actionB);
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (description.length < 1 || description.length > 200) {
        throw new HttpError(400, 'bad_request', 'Describe the conflict in a short sentence.');
      }
      const meta = requestMeta(request);
      const saved = await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'admin',
          moduleId: 'KRN-01',
        });
        return addSodRule(tx, {
          actorId: session.userId,
          actionA,
          actionB,
          description,
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
      });
      await reply.code(201).send(saved);
    }),
  );

  app.post(
    '/krn/sod-rules/:ruleId/disable',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const ruleId = readUuid((request.params as { ruleId?: string }).ruleId, 'rule');
      const meta = requestMeta(request);
      await withTenant(tenantId(session.tenantId), async (tx) => {
        await requirePermission(tx, session.userId, {
          scope: 'krn',
          action: 'admin',
          moduleId: 'KRN-01',
        });
        await disableSodRule(tx, {
          actorId: session.userId,
          ruleId,
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
      });
      await reply.send({ ok: true });
    }),
  );

  app.post(
    '/modules/:moduleId',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const moduleKey = (request.params as { moduleId?: string }).moduleId ?? '';
      if (!isModuleId(moduleKey)) {
        throw new HttpError(400, 'bad_request', 'Unknown module.');
      }
      const active = readBody(request).active;
      if (typeof active !== 'boolean') {
        throw new HttpError(400, 'bad_request', 'Say whether the module is active.');
      }
      const meta = requestMeta(request);
      try {
        await withTenant(tenantId(session.tenantId), async (tx) => {
          await requirePermission(tx, session.userId, {
            scope: 'krn',
            action: 'admin',
            moduleId: 'KRN-01',
          });
          await setTenantModuleActive(tx, {
            actorId: session.userId,
            moduleId: moduleKey,
            active,
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('cannot be disabled') || message.includes('Cannot deactivate')) {
          await withTenant(tenantId(session.tenantId), (tx) =>
            appendAuditEvent(tx, {
              action: 'identity.module.deactivate_denied',
              entityType: 'tenant_module',
              entityId: session.tenantId,
              actorId: session.userId,
              beforeData: { moduleId: moduleKey, active: true },
              afterData: { moduleId: moduleKey, active: false, denied: true },
              requestIp: meta.requestIp,
              userAgent: meta.userAgent,
            }),
          );
        }
        throw error;
      }
      await reply.send({ moduleId: moduleKey, active });
    }),
  );
}
