import { afterAll, describe, expect, it } from 'vitest';
import { closePools, getAdminPool, getAppPool } from '@omnivate/db';

describe('foundation schema guards', () => {
  afterAll(async () => {
    await closePools();
  });

  it('forces row-level security on every tenant table', async () => {
    const tables = await getAdminPool().query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`,
    );

    const byName = new Map(tables.rows.map((row) => [row.relname, row]));
    expect([...byName.keys()].sort()).toEqual([
      'ana03_reports',
      'audit_events',
      'auth_challenges',
      'doc_documents',
      'doc_lines',
      'doc_page_usage',
      'doc_receipt_links',
      'doc_settings',
      'doc_supplier_codes',
      'fin01_accounts',
      'fin01_cost_snapshots',
      'fin01_journal_lines',
      'fin01_journals',
      'fin01_party_codes',
      'fin01_sequences',
      'foundation_notes',
      'foundation_postings',
      'krn03_branch_access',
      'krn03_branches',
      'krn03_current_branch',
      'krn03_entity_links',
      'krn03_legal_entities',
      'krn03_settings',
      'krn04_automation_runs',
      'krn04_automations',
      'krn04_field_definitions',
      'krn04_field_values',
      'krn04_instances',
      'krn04_notifications',
      'krn04_pipelines',
      'krn04_transition_log',
      'krn04_workflow_rules',
      'krn06_import_batches',
      'krn06_import_rows',
      'krn06_items',
      'krn06_parties',
      'krn06_saved_mappings',
      'krn06_stock_movements',
      'login_attempts',
      'memberships',
      'o2c_allocations',
      'o2c_customer_terms',
      'o2c_documents',
      'o2c_lines',
      'o2c_payments',
      'o2c_sequences',
      'o2c_settings',
      'o2c_stock_links',
      'operator_previews',
      'parties',
      'party_addresses',
      'party_channels',
      'party_contacts',
      'party_notes',
      'party_roles',
      'party_tags',
      'platform_auth_challenges',
      'platform_login_attempts',
      'platform_operator_roles',
      'platform_operators',
      'platform_roles',
      'platform_sessions',
      'role_permissions',
      'roles',
      'schema_migrations',
      'scm01_adjustment_requests',
      'scm01_balances',
      'scm01_batch_balances',
      'scm01_batches',
      'scm01_goods_receipt_lines',
      'scm01_goods_receipts',
      'scm01_item_uoms',
      'scm01_items',
      'scm01_label_prints',
      'scm01_movement_serials',
      'scm01_movements',
      'scm01_pending_postings',
      'scm01_serials',
      'scm01_settings',
      'sessions',
      'sod_rules',
      'tenant_modules',
      'tenants',
      'user_invites',
      'user_roles',
      'users',
    ]);

    for (const [name, row] of byName) {
      if (name === 'schema_migrations') {
        expect(row.relrowsecurity).toBe(false);
        continue;
      }
      expect(row.relrowsecurity, name).toBe(true);
      expect(row.relforcerowsecurity, name).toBe(true);
    }

    const ownerPolicy = await getAdminPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_policy WHERE polname = 'omnivate_migration_owner'`,
    );
    expect(ownerPolicy.rows[0]?.count).toBe('0');
  });

  it('keeps the application role from bypassing security', async () => {
    const role = await getAdminPool().query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>('SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1', [
      'omnivate_app',
    ]);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true });

    const owner = await getAdminPool().query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'audit_events'`,
    );
    expect(owner.rows[0]?.owner).not.toBe('omnivate_app');

    await expect(
      getAppPool().query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only'),
    ).rejects.toThrow(/permission denied|must be owner of table/i);
  });

  it('stores money as bigint cents', async () => {
    const column = await getAdminPool().query<{ data_type: string }>(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'foundation_postings'
         AND column_name = 'amount_cents'`,
    );
    expect(column.rows[0]?.data_type).toBe('bigint');

    const approval = await getAdminPool().query<{ data_type: string }>(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'role_permissions'
         AND column_name = 'approval_limit_cents'`,
    );
    expect(approval.rows[0]?.data_type).toBe('bigint');
  });
});
