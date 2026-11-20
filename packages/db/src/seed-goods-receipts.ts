import type pg from 'pg';

const AUBERGINE = '11111111-1111-4111-8111-111111111111';
const SILVER_MANGO = 'c1111111-1111-4111-8111-111111111102';
const NOAH = 'c1111111-1111-4111-8111-111111111104';
const ACTOR = 'a1111111-1111-4111-8111-111111111105';

/**
 * Extra fictional goods received notes with a supplier, for the report builder.
 * Lines point at receipt movements the catalog seed already posted.
 * Not a real delivery.
 */
export async function seedGoodsReceipts(pool: pg.Pool): Promise<void> {
  const head = await pool.query<{ id: string }>(
    `SELECT id FROM krn03_branches
     WHERE tenant_id = $1 AND is_head_office AND archived_at IS NULL
     LIMIT 1`,
    [AUBERGINE],
  );
  const branchId = head.rows[0]?.id;
  if (!branchId) {
    throw new Error('Aubergine Atlas has no Head Office for the sample goods receipts.');
  }

  await pool.query(
    `INSERT INTO scm01_goods_receipts (
       id, tenant_id, number, branch_id, note, received_at, actor_id, supplier_party_id
     ) VALUES
     (
       'a4111111-1111-4111-8111-111111111301', $1, 'GRV-1101', $2,
       'Fictional delivery. Not a real invoice.', '2026-11-04T06:00:00Z', $3, $4
     ),
     (
       'a4111111-1111-4111-8111-111111111302', $1, 'GRV-1102', $2,
       'Fictional second delivery. Not a real invoice.', '2026-11-12T07:30:00Z', $3, $4
     ),
     (
       'a4111111-1111-4111-8111-111111111303', $1, 'GRV-1103', $2,
       'Fictional timber. Not a real mill.', '2026-11-02T08:00:00Z', $3, $5
     )
     ON CONFLICT (id) DO NOTHING`,
    [AUBERGINE, branchId, ACTOR, SILVER_MANGO, NOAH],
  );

  await pool.query(
    `INSERT INTO scm01_goods_receipt_lines (
       id, tenant_id, goods_receipt_id, line_no, item_id, movement_id, quantity
     ) VALUES
     (
       'a4111111-1111-4111-8111-111111111311', $1,
       'a4111111-1111-4111-8111-111111111301', 1,
       'c1111111-1111-4111-8111-111111111001',
       'a3111111-1111-4111-8111-111111111001', 10
     ),
     (
       'a4111111-1111-4111-8111-111111111312', $1,
       'a4111111-1111-4111-8111-111111111301', 2,
       'c1111111-1111-4111-8111-111111111002',
       'a3111111-1111-4111-8111-111111111006', 12
     ),
     (
       'a4111111-1111-4111-8111-111111111313', $1,
       'a4111111-1111-4111-8111-111111111302', 1,
       'c1111111-1111-4111-8111-111111111004',
       'a3111111-1111-4111-8111-111111111010', 6
     ),
     (
       'a4111111-1111-4111-8111-111111111314', $1,
       'a4111111-1111-4111-8111-111111111303', 1,
       'c1111111-1111-4111-8111-111111111003',
       'a3111111-1111-4111-8111-111111111013', 40
     )
     ON CONFLICT (id) DO NOTHING`,
    [AUBERGINE],
  );
}
