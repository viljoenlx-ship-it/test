import type pg from 'pg';

/**
 * Render's database user owns the database and is not a superuser, so it cannot
 * be given BYPASSRLS. FORCE ROW LEVEL SECURITY then applies to that user too.
 * Security-definer functions are owned by the migration role and would return
 * no rows. This policy names only the current migration role. omnivate_app is
 * not a member of that role, so the API's policies are unchanged.
 *
 * Superusers and BYPASSRLS roles already see every tenant. They do not get this
 * policy.
 */
export async function ensureMigrationOwnerPolicies(client: pg.Client): Promise<void> {
  const capability = await client.query<{ bypass: boolean }>(
    'SELECT (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user',
  );
  if (capability.rows[0]?.bypass === true) {
    return;
  }

  await client.query(`
    DO $$
    DECLARE
      table_name text;
    BEGIN
      FOR table_name IN
        SELECT c.relname
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity
        ORDER BY c.relname
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS omnivate_migration_owner ON public.%I', table_name);
        EXECUTE format(
          'CREATE POLICY omnivate_migration_owner ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
          table_name,
          current_user
        );
        EXECUTE format(
          'COMMENT ON POLICY omnivate_migration_owner ON public.%I IS %L',
          table_name,
          'Migration role only. Render''s database owner cannot hold BYPASSRLS, so security-definer functions and the fictional seed need a policy that names that role. omnivate_app is not a member of it.'
        );
      END LOOP;
    END
    $$;
  `);
}
