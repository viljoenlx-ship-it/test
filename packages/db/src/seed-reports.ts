import type pg from 'pg';
import { READY_MADE_REPORTS, demoTenants } from '@omnivate/shared';

const IDS: Record<string, Record<string, string>> = {
  [demoTenants[0].id]: {
    stock_on_hand: 'a4111111-1111-4111-8111-111111111401',
    low_stock: 'a4111111-1111-4111-8111-111111111402',
    stock_movements: 'a4111111-1111-4111-8111-111111111403',
    goods_received: 'a4111111-1111-4111-8111-111111111404',
    valuation_by_branch: 'a4111111-1111-4111-8111-111111111405',
    write_offs: 'a4111111-1111-4111-8111-111111111406',
    aged_debtors: 'a4111111-1111-4111-8111-111111111407',
  },
  [demoTenants[1].id]: {
    stock_on_hand: 'b4222222-2222-4222-8222-222222222401',
    low_stock: 'b4222222-2222-4222-8222-222222222402',
    stock_movements: 'b4222222-2222-4222-8222-222222222403',
    goods_received: 'b4222222-2222-4222-8222-222222222404',
    valuation_by_branch: 'b4222222-2222-4222-8222-222222222405',
    write_offs: 'b4222222-2222-4222-8222-222222222406',
    aged_debtors: 'b4222222-2222-4222-8222-222222222407',
  },
};

/** Installs the six ready-made reports for each fictional company. Safe to run again. */
export async function seedReadyReports(pool: pg.Pool): Promise<void> {
  for (const tenant of demoTenants) {
    const ids = IDS[tenant.id];
    if (!ids) {
      continue;
    }
    for (const report of READY_MADE_REPORTS) {
      const id = ids[report.readyKey];
      if (!id) {
        continue;
      }
      await pool.query(
        `INSERT INTO ana03_reports (
           id, tenant_id, name, source_key, definition, visibility, shared_roles, ready_key, created_by_kind
         ) VALUES ($1, $2, $3, $4, $5::jsonb, 'ready_made', '{}', $6, 'system')
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           source_key = EXCLUDED.source_key,
           definition = EXCLUDED.definition,
           visibility = 'ready_made',
           archived_at = NULL,
           ready_key = EXCLUDED.ready_key`,
        [
          id,
          tenant.id,
          report.name,
          report.definition.source,
          JSON.stringify(report.definition),
          report.readyKey,
        ],
      );
    }
  }
}
