import { and, desc, eq, isNull } from 'drizzle-orm';
import { memberships, roles, userRoles, type TenantTransaction } from '@omnivate/kernel';
import { audit, setCurrentUser, type Actor } from './actions';
import { WorkflowError } from './errors';
import { notifications } from './tables';

export type NotificationView = {
  id: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
};

function toView(row: typeof notifications.$inferSelect): NotificationView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function audienceUserIds(
  tx: TenantTransaction,
  actorId: string | null,
  config: Record<string, unknown>,
): Promise<string[]> {
  const audience = config.audience;
  if (audience === 'actor') {
    return actorId ? [actorId] : [];
  }
  if (audience === 'user' && typeof config.userId === 'string') {
    const rows = await tx.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.userId, config.userId), eq(memberships.status, 'active')));
    return rows.map((row) => row.userId);
  }
  if (audience === 'role' && typeof config.roleKey === 'string') {
    const rows = await tx.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(
        memberships,
        and(eq(memberships.userId, userRoles.userId), eq(memberships.tenantId, userRoles.tenantId)),
      )
      .where(and(eq(roles.key, config.roleKey), eq(memberships.status, 'active')));
    return [...new Set(rows.map((row) => row.userId))];
  }
  return [];
}

export async function listNotifications(
  tx: TenantTransaction,
  userId: string,
): Promise<{ unread: number; items: NotificationView[] }> {
  await setCurrentUser(tx, userId);
  const rows = await tx.db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(30);
  const items = rows.map(toView);
  return { unread: items.filter((item) => !item.read).length, items };
}

export async function markNotificationRead(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
): Promise<void> {
  await setCurrentUser(tx, actor.actorId);
  const rows = await tx.db.select().from(notifications).where(eq(notifications.id, id));
  const current = rows[0];
  if (!current) {
    throw new WorkflowError('That alert was not found.');
  }
  if (current.readAt) {
    return;
  }
  const readAt = new Date();
  await tx.db.update(notifications).set({ readAt }).where(eq(notifications.id, id));
  await audit(tx, {
    action: 'workflow.notification.read',
    entityType: 'krn04_notification',
    entityId: id,
    actorId: actor.actorId,
    beforeData: { read: false },
    afterData: { read: true, title: current.title },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

export async function markAllNotificationsRead(tx: TenantTransaction, actor: Actor): Promise<void> {
  await setCurrentUser(tx, actor.actorId);
  const unread = await tx.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(isNull(notifications.readAt));
  if (unread.length === 0) {
    return;
  }
  await tx.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.actorId), isNull(notifications.readAt)));
  await audit(tx, {
    action: 'workflow.notification.read',
    entityType: 'krn04_notification',
    entityId: unread[0]?.id ?? actor.actorId,
    actorId: actor.actorId,
    beforeData: { unread: unread.length },
    afterData: { unread: 0 },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}
