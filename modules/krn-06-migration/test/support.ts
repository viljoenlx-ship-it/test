import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { tenantId, type ModuleId, type RoleKey } from '@omnivate/shared';
import { setTenantModuleActive, withTenant } from '@omnivate/kernel';
import { hashToken, newToken } from '@omnivate/module-krn-01';
import { getAdminPool, schema, seedTenantRbac } from '@omnivate/db';

export function multipart(
  fields: Record<string, string>,
  file: { filename: string; type: string; data: string | Buffer },
): { payload: Buffer; headers: { 'content-type': string } } {
  const boundary = '----krn06test';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
  );
  chunks.push(data);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export async function makeCompany(label: string): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const slug = `${label}-${id.slice(0, 8)}`;
  await getAdminPool().query(
    `INSERT INTO tenants (id, slug, display_name, is_demo, timezone, currency_code)
     VALUES ($1, $2, $3, false, 'Africa/Johannesburg', 'ZAR')`,
    [id, slug, `Fictional ${label}`],
  );
  return { id, slug };
}

export async function makeUser(
  companyId: string,
  role: RoleKey,
  label: string,
): Promise<{ id: string; cookie: string }> {
  const id = randomUUID();
  const admin = drizzle(getAdminPool(), { schema });
  const roles = await seedTenantRbac(admin, companyId);
  await getAdminPool().query(
    `INSERT INTO users (id, email, display_name, password_hash, status)
     VALUES ($1, $2, $3, 'x', 'active')`,
    [id, `${label}-${id.slice(0, 8)}@example.com`, label],
  );
  await getAdminPool().query(
    `INSERT INTO memberships (tenant_id, user_id, status) VALUES ($1, $2, 'active')`,
    [companyId, id],
  );
  await getAdminPool().query(
    `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`,
    [companyId, id, roles.get(role)],
  );
  const token = newToken();
  await getAdminPool().query(
    `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '15 minutes')`,
    [companyId, id, hashToken(token)],
  );
  return { id, cookie: `omnivate_session=${token}` };
}

export async function enableModule(companyId: string, userId: string, moduleId: ModuleId) {
  await withTenant(tenantId(companyId), (tx) =>
    setTenantModuleActive(tx, {
      actorId: userId,
      moduleId,
      active: true,
      requestIp: null,
      userAgent: 'vitest',
    }),
  );
}

export function companyOf(id: string) {
  return tenantId(id);
}
