import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  appendAuditEvent,
  hashPassword,
  mfaEnforcement,
  lookupInvite,
  lookupUserByEmail,
  memberships,
  tenantId,
  userInvites,
  userRoles,
  withTenant,
} from '@omnivate/kernel';
import { HttpError, readDisplayName, readPassword, type RequestMeta } from './http';
import { openChallenge, openSession } from './issue';
import { hashToken } from './tokens';
import { createTotpSecret } from './totp';

export type InviteAcceptResult =
  | { kind: 'session'; token: string; tenantId: string; userId: string }
  | { kind: 'mfa'; step: 'mfa_enroll' | 'mfa_verify'; token: string; tenantId: string };

export async function acceptInvite(input: {
  token: string;
  displayName: string;
  password: string;
  meta: RequestMeta;
}): Promise<InviteAcceptResult> {
  const invite = await lookupInvite(hashToken(input.token));
  if (
    !invite ||
    invite.revokedAt ||
    invite.acceptedAt ||
    invite.expiresAt.getTime() <= Date.now()
  ) {
    throw new HttpError(400, 'bad_request', 'This invite link is not valid.');
  }
  if (invite.tenantStatus !== 'active') {
    throw new HttpError(
      403,
      'tenant_unavailable',
      'This company is not active. Sign-in is closed.',
    );
  }

  const existing = await lookupUserByEmail(invite.email);
  const displayName = existing ? existing.displayName : readDisplayName(input.displayName);
  const passwordHash = existing ? null : await hashPassword(readPassword(input.password));

  return withTenant(tenantId(invite.tenantId), async (tx) => {
    const claimed = await tx.db
      .update(userInvites)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(userInvites.id, invite.id),
          isNull(userInvites.acceptedAt),
          isNull(userInvites.revokedAt),
          sql`${userInvites.expiresAt} > now()`,
        ),
      )
      .returning({ id: userInvites.id });
    if (!claimed[0]) {
      throw new HttpError(400, 'bad_request', 'This invite link is not valid.');
    }

    let userId = existing?.id ?? null;
    if (!userId) {
      const inserted = await tx.db.execute<{ krn_insert_user: string }>(
        sql`SELECT krn_insert_user(${invite.email}, ${displayName}, ${passwordHash}) AS krn_insert_user`,
      );
      userId = inserted.rows[0]?.krn_insert_user ?? null;
      if (!userId) {
        throw new Error('User was not created.');
      }
    }

    const members = await tx.db
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    const member = members[0];
    if (!member) {
      await tx.db.insert(memberships).values({
        tenantId: tx.tenantId,
        userId,
        status: 'active',
      });
    } else if (member.status !== 'active') {
      await tx.db
        .update(memberships)
        .set({ status: 'active' })
        .where(eq(memberships.id, member.id));
    }

    await tx.db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tx.tenantId)));
    await tx.db.insert(userRoles).values({
      tenantId: tx.tenantId,
      userId,
      roleId: invite.roleId,
      assignedBy: null,
    });

    await appendAuditEvent(tx, {
      action: 'identity.invite.accepted',
      entityType: 'user_invite',
      entityId: invite.id,
      actorId: userId,
      beforeData: { acceptedAt: null, email: invite.email, roleKey: invite.roleKey },
      afterData: {
        acceptedAt: new Date().toISOString(),
        email: invite.email,
        roleKey: invite.roleKey,
        userId,
      },
      requestIp: input.meta.requestIp,
      userAgent: input.meta.userAgent,
    });

    const totpEnabled = existing?.totpEnabled ?? false;
    if (mfaEnforcement() === 'on' && (totpEnabled || invite.mfaRequired)) {
      const step = totpEnabled ? 'mfa_verify' : 'mfa_enroll';
      const token = await openChallenge(tx, {
        userId,
        purpose: step,
        totpSecret: step === 'mfa_enroll' ? createTotpSecret() : null,
      });
      await appendAuditEvent(tx, {
        action: 'auth.login.mfa_required',
        entityType: 'user',
        entityId: userId,
        actorId: userId,
        beforeData: null,
        afterData: { step, via: 'invite' },
        requestIp: input.meta.requestIp,
        userAgent: input.meta.userAgent,
      });
      return { kind: 'mfa', step, token, tenantId: invite.tenantId };
    }

    const token = await openSession(tx, userId, input.meta);
    await appendAuditEvent(tx, {
      action: 'auth.login.succeeded',
      entityType: 'user',
      entityId: userId,
      actorId: userId,
      beforeData: null,
      afterData: { mfa: false, via: 'invite' },
      requestIp: input.meta.requestIp,
      userAgent: input.meta.userAgent,
    });
    return { kind: 'session', token, tenantId: invite.tenantId, userId };
  });
}
