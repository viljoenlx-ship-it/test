import type pg from 'pg';

const AUBERGINE = '11111111-1111-4111-8111-111111111111';
const CRAYON = '22222222-2222-4222-8222-222222222222';
const CRAYON_MANAGER = 'b2222222-2222-4222-8222-222222222202';
const OLD_CAPE_TOWN = 'c3333333-3333-4333-8333-333333333301';
const DURBAN = 'c3333333-3333-4333-8333-333333333302';
const ACCESS_HEAD = 'c3333333-3333-4333-8333-333333333311';
const ACCESS_DURBAN = 'c3333333-3333-4333-8333-333333333313';
const AUDIT_ID = 'c3333333-3333-4333-8333-3333333333a1';

/**
 * Fictional branches for the two demo companies.
 * Aubergine Atlas keeps one Head Office in Cape Town.
 * Blue Crayon Foundry's head office is Cape Town HQ, plus a Durban branch.
 * Safe to run more than once. The head-office row itself comes from the KRN-03 trigger.
 */
export async function seedDemoBranches(pool: pg.Pool): Promise<void> {
  const ready = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass('public.krn03_branches') IS NOT NULL AS ok`,
  );
  if (!ready.rows[0]?.ok) {
    throw new Error('KRN-03 tables are missing. Run migrations before the seed.');
  }

  await pool.query(
    `UPDATE krn03_settings SET multi_branch_enabled = false, updated_at = now()
     WHERE tenant_id = $1`,
    [AUBERGINE],
  );
  await pool.query(
    `UPDATE krn03_branches
     SET name = 'Head Office',
         code = 'HO',
         address_line1 = '12 Fictional Wharf',
         city = 'Cape Town',
         province = 'Western Cape',
         postal_code = '8001',
         country = 'ZA',
         contact_name = 'Front desk',
         contact_email = 'desk@aubergine-atlas.example',
         contact_phone = '021 000 0000',
         active = true,
         updated_at = now()
     WHERE tenant_id = $1 AND is_head_office AND archived_at IS NULL`,
    [AUBERGINE],
  );

  await pool.query(
    `UPDATE krn03_settings SET multi_branch_enabled = true, updated_at = now()
     WHERE tenant_id = $1`,
    [CRAYON],
  );
  // An earlier seed kept a separate Cape Town branch beside Head Office. Drop that fixture
  // before the head office takes the CPT code.
  await pool.query(`DELETE FROM krn03_branches WHERE id = $1 AND is_head_office = false`, [
    OLD_CAPE_TOWN,
  ]);
  await pool.query(
    `UPDATE krn03_branches
     SET name = 'Cape Town HQ',
         code = 'CPT',
         address_line1 = '3 Fictional Long Street',
         city = 'Cape Town',
         province = 'Western Cape',
         postal_code = '8001',
         country = 'ZA',
         contact_name = 'Cape Town desk',
         contact_email = 'cape-town@blue-crayon-foundry.example',
         contact_phone = '021 000 1000',
         active = true,
         updated_at = now()
     WHERE tenant_id = $1 AND is_head_office AND archived_at IS NULL`,
    [CRAYON],
  );
  await pool.query(
    `INSERT INTO krn03_branches (
       id, tenant_id, legal_entity_id, name, code,
       address_line1, city, province, postal_code, country,
       contact_name, contact_email, contact_phone, active, is_head_office
     )
     SELECT $2, $1, e.id, 'Durban', 'DBN',
            '19 Fictional Florida Road', 'Durban', 'KwaZulu-Natal', '4001', 'ZA',
            'Durban desk', 'durban@blue-crayon-foundry.example', '031 000 1000',
            true, false
     FROM krn03_legal_entities AS e
     WHERE e.tenant_id = $1 AND e.is_primary AND e.archived_at IS NULL
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       code = EXCLUDED.code,
       address_line1 = EXCLUDED.address_line1,
       city = EXCLUDED.city,
       province = EXCLUDED.province,
       postal_code = EXCLUDED.postal_code,
       contact_name = EXCLUDED.contact_name,
       contact_email = EXCLUDED.contact_email,
       contact_phone = EXCLUDED.contact_phone,
       active = true,
       archived_at = NULL,
       updated_at = now()`,
    [CRAYON, DURBAN],
  );

  await pool.query(
    `INSERT INTO krn03_branch_access (id, tenant_id, user_id, branch_id)
     SELECT $3, $1, $2, b.id
     FROM krn03_branches AS b
     WHERE b.tenant_id = $1 AND b.is_head_office AND b.archived_at IS NULL
     ON CONFLICT (id) DO NOTHING`,
    [CRAYON, CRAYON_MANAGER, ACCESS_HEAD],
  );
  await pool.query(
    `INSERT INTO krn03_branch_access (id, tenant_id, user_id, branch_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [ACCESS_DURBAN, CRAYON, CRAYON_MANAGER, DURBAN],
  );

  await pool.query(
    `INSERT INTO audit_events (
       id, tenant_id, actor_id, actor_kind, action, entity_type, entity_id,
       before_data, after_data, user_agent
     ) VALUES (
       $1, $2, NULL, 'system', 'krn03.seed.demo_branches', 'tenant', $2,
       NULL,
       $3::jsonb,
       'omnivate-seed'
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      AUDIT_ID,
      CRAYON,
      JSON.stringify({
        fictional: true,
        multiBranch: true,
        branches: ['Cape Town HQ', 'Durban'],
      }),
    ],
  );
}
