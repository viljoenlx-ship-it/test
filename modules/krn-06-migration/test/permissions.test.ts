import { randomUUID } from 'node:crypto';
import { platformOperator } from '@omnivate/shared';
import { hashToken, newToken } from '@omnivate/module-krn-01';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { closePools, getAdminPool, seed } from '@omnivate/db';
import { makeCompany, makeUser } from './support';

describe('KRN-06 permissions', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let companyId = '';
  let ownerCookie = '';
  let managerCookie = '';
  let cashierCookie = '';
  let operatorCookie = '';
  let supportCookie = '';

  beforeAll(async () => {
    await seed();
    app = await buildApp({ checkDatabase: async () => true });
    const company = await makeCompany('perms');
    companyId = company.id;
    ownerCookie = (await makeUser(company.id, 'tenant_owner', 'owner')).cookie;
    managerCookie = (await makeUser(company.id, 'branch_manager', 'manager')).cookie;
    cashierCookie = (await makeUser(company.id, 'sales_cashier', 'cashier')).cookie;

    const operatorToken = newToken();
    await getAdminPool().query(
      `SELECT platform_open_session($1, $2, now() + interval '15 minutes', null, 'vitest')`,
      [platformOperator.id, hashToken(operatorToken)],
    );
    operatorCookie = `omnivate_operator=${operatorToken}`;

    const supportId = randomUUID();
    await getAdminPool().query(
      `INSERT INTO platform_operators (id, email, display_name, password_hash, status)
       VALUES ($1, $2, 'Support Fixture', 'x', 'active')`,
      [supportId, `support-${supportId.slice(0, 8)}@example.com`],
    );
    await getAdminPool().query(
      `INSERT INTO platform_operator_roles (operator_id, role_id)
       VALUES ($1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')`,
      [supportId],
    );
    const supportToken = newToken();
    await getAdminPool().query(
      `SELECT platform_open_session($1, $2, now() + interval '15 minutes', null, 'vitest')`,
      [supportId, hashToken(supportToken)],
    );
    supportCookie = `omnivate_operator=${supportToken}`;
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  it('lets the owner import contacts and stock, and the manager import stock only', async () => {
    const owner = await app.inject({
      method: 'GET',
      url: '/krn/imports/targets',
      headers: { cookie: ownerCookie },
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().targets.map((target: { id: string }) => target.id)).toEqual([
      'contacts',
      'stock-items',
    ]);

    const manager = await app.inject({
      method: 'GET',
      url: '/krn/imports/targets',
      headers: { cookie: managerCookie },
    });
    expect(manager.json().targets.map((target: { id: string }) => target.id)).toEqual([
      'stock-items',
    ]);

    const cashier = await app.inject({
      method: 'GET',
      url: '/krn/imports/targets',
      headers: { cookie: cashierCookie },
    });
    expect(cashier.json().targets).toEqual([]);

    const denied = await app.inject({
      method: 'GET',
      url: '/krn/imports/templates/contacts/csv',
      headers: { cookie: managerCookie },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toMatch(/owner/i);
  });

  it('lets the platform owner import for one company and refuses support', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: `/control/tenants/${companyId}/imports/targets`,
      headers: { cookie: operatorCookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().targets.map((target: { id: string }) => target.id)).toEqual([
      'contacts',
      'stock-items',
      'opening-customers',
      'opening-suppliers',
      'opening-trial-balance',
    ]);

    const refused = await app.inject({
      method: 'GET',
      url: `/control/tenants/${companyId}/imports/targets`,
      headers: { cookie: supportCookie },
    });
    expect(refused.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'GET',
      url: '/krn/imports/targets',
    });
    expect(missing.statusCode).toBe(401);
  });
});
