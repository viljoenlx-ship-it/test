-- SCM-01 Universal Catalog & Inventory Ledger.
-- Money is bigint cents, VAT-exclusive. Costing is weighted average (southAfricaPreset).
-- Movements and the FIN-01 outbox are append-only. Items are archived, never deleted.
--
-- branch_id references krn03_branches. Access is checked with requireBranchAccess.
-- FIN-01 is not built. scm01_pending_postings is the append-only outbox it should
-- read. Do not update those rows; record the general-ledger posting in FIN-01.

CREATE TABLE scm01_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE RESTRICT,
  label_width_mm numeric(6, 2) NOT NULL DEFAULT 50,
  label_height_mm numeric(6, 2) NOT NULL DEFAULT 15,
  label_printer text NOT NULL DEFAULT 'Niimbot M2_H',
  adjustment_approval_cents bigint NOT NULL DEFAULT 1000000,
  CONSTRAINT scm01_settings_label_size CHECK (
    label_width_mm BETWEEN 20 AND 100 AND label_height_mm BETWEEN 8 AND 80
  ),
  CONSTRAINT scm01_settings_threshold CHECK (adjustment_approval_cents >= 0)
);

COMMENT ON TABLE scm01_settings IS
  'Label size is a setting. The printed page does not repeat it. Approval threshold defaults to R10,000 (CFG-11).';

COMMENT ON COLUMN scm01_settings.adjustment_approval_cents IS
  'Absolute stock-value change, in cents, above which an adjustment waits for Approve Adj.';

CREATE TABLE scm01_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('stock', 'service', 'non_stock')),
  sku text NOT NULL,
  barcode text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  base_uom text NOT NULL,
  base_uom_plural text NOT NULL,
  cost_cents bigint NOT NULL,
  selling_price_cents bigint NOT NULL,
  vat_rate_basis_points integer NOT NULL,
  reorder_level numeric(18, 4) NOT NULL DEFAULT 0,
  track_batches boolean NOT NULL DEFAULT false,
  track_serials boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scm01_items_money CHECK (cost_cents >= 0 AND selling_price_cents >= 0),
  CONSTRAINT scm01_items_vat CHECK (vat_rate_basis_points >= 0),
  CONSTRAINT scm01_items_reorder CHECK (reorder_level >= 0),
  CONSTRAINT scm01_items_tracking CHECK (NOT (track_batches AND track_serials)),
  UNIQUE (tenant_id, sku)
);

COMMENT ON TABLE scm01_items IS
  'Catalog. cost_cents is the weighted-average cost for stock, VAT-exclusive. Archived, never deleted.';

COMMENT ON COLUMN scm01_items.cost_cents IS
  'Integer cents. Weighted average for stock items. Never a float.';

COMMENT ON COLUMN scm01_items.selling_price_cents IS
  'Integer cents, VAT-exclusive. VAT rate is the tenant preset copied onto the row.';

CREATE UNIQUE INDEX scm01_items_barcode_idx
  ON scm01_items (tenant_id, barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

CREATE TABLE scm01_item_uoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  name text NOT NULL,
  plural text NOT NULL,
  factor_to_base numeric(18, 4) NOT NULL CHECK (factor_to_base > 0),
  UNIQUE (tenant_id, item_id, name)
);

COMMENT ON TABLE scm01_item_uoms IS
  'Extra units, such as a box of 10. factor_to_base is how many base units one of these contains.';

CREATE TABLE scm01_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  code text NOT NULL,
  expires_on date,
  UNIQUE (tenant_id, item_id, code)
);

COMMENT ON TABLE scm01_batches IS
  'Optional lot and expiry for one item. Quantity lives on scm01_batch_balances.';

CREATE TABLE scm01_serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  serial text NOT NULL,
  branch_id uuid REFERENCES krn03_branches (id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('in_stock', 'issued')),
  UNIQUE (tenant_id, item_id, serial)
);

COMMENT ON TABLE scm01_serials IS
  'One physical unit. branch_id is a KRN-03 branch. Issued serials leave stock.';

CREATE TABLE scm01_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES krn03_branches (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (
    kind IN ('receipt', 'issue', 'adjustment', 'transfer_in', 'transfer_out', 'reversal')
  ),
  quantity numeric(18, 4) NOT NULL,
  uom_name text NOT NULL,
  uom_plural text NOT NULL,
  uom_factor numeric(18, 4) NOT NULL CHECK (uom_factor > 0),
  entered_quantity numeric(18, 4) NOT NULL,
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0),
  value_cents bigint NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'posted' CHECK (status = 'posted'),
  reverses_movement_id uuid REFERENCES scm01_movements (id) ON DELETE RESTRICT,
  transfer_group_id uuid,
  batch_id uuid REFERENCES scm01_batches (id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  CONSTRAINT scm01_movements_qty CHECK (quantity <> 0)
);

COMMENT ON TABLE scm01_movements IS
  'Append-only stock ledger. Corrections are reversing movements. status is always posted.';

COMMENT ON COLUMN scm01_movements.branch_id IS
  'KRN-03 branch this line applies to. Checked with requireBranchAccess before insert.';

COMMENT ON COLUMN scm01_movements.quantity IS
  'Signed quantity in the item base unit. Receipts are positive. Issues are negative.';

COMMENT ON COLUMN scm01_movements.value_cents IS
  'Signed stock-value change in cents at unit_cost_cents. Transfers are zero.';

CREATE INDEX scm01_movements_item_idx ON scm01_movements (tenant_id, item_id, occurred_at DESC);
CREATE INDEX scm01_movements_branch_idx ON scm01_movements (tenant_id, branch_id);

CREATE TABLE scm01_movement_serials (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  movement_id uuid NOT NULL REFERENCES scm01_movements (id) ON DELETE RESTRICT,
  serial_id uuid NOT NULL REFERENCES scm01_serials (id) ON DELETE RESTRICT,
  PRIMARY KEY (movement_id, serial_id)
);

CREATE TABLE scm01_balances (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES krn03_branches (id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  PRIMARY KEY (tenant_id, item_id, branch_id)
);

COMMENT ON TABLE scm01_balances IS
  'Stock on hand per item per branch, kept in the same transaction as the movement.';

COMMENT ON COLUMN scm01_balances.branch_id IS
  'KRN-03 branch. On hand is kept in the same transaction as the movement.';

CREATE TABLE scm01_batch_balances (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES scm01_batches (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES krn03_branches (id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  PRIMARY KEY (tenant_id, batch_id, branch_id)
);

CREATE TABLE scm01_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES krn03_branches (id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0),
  value_cents bigint NOT NULL CHECK (value_cents > 0),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  movement_id uuid REFERENCES scm01_movements (id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scm01_adjustment_requests_qty CHECK (quantity <> 0)
);

COMMENT ON TABLE scm01_adjustment_requests IS
  'Adjustments above the threshold wait here. Approving inserts an append-only movement.';

CREATE INDEX scm01_adjustment_requests_status_idx
  ON scm01_adjustment_requests (tenant_id, status);

CREATE TABLE scm01_pending_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  movement_id uuid NOT NULL REFERENCES scm01_movements (id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  memo text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  signed_value_cents bigint NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'ZAR',
  debit_account text NOT NULL,
  credit_account text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0)
);

COMMENT ON TABLE scm01_pending_postings IS
  'Append-only stock valuation journals for FIN-01. Account names are logical until the chart of accounts exists.';

COMMENT ON COLUMN scm01_pending_postings.amount_cents IS
  'Absolute journal amount in cents. signed_value_cents is positive when stock value increases.';

CREATE INDEX scm01_pending_postings_tenant_idx
  ON scm01_pending_postings (tenant_id, occurred_at);

CREATE FUNCTION scm01_reject_item_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SCM-01: catalog items are archived, never deleted'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER scm01_items_no_delete
  BEFORE DELETE ON scm01_items
  FOR EACH ROW
  EXECUTE FUNCTION scm01_reject_item_delete();

CREATE FUNCTION scm01_reject_movement_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SCM-01: stock movements are append-only; post a reversing movement'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER scm01_movements_append_only
  BEFORE UPDATE OR DELETE ON scm01_movements
  FOR EACH ROW
  EXECUTE FUNCTION scm01_reject_movement_mutation();

CREATE TRIGGER scm01_movements_no_hard_delete
  BEFORE DELETE ON scm01_movements
  FOR EACH ROW
  EXECUTE FUNCTION gov_reject_posted_delete();

CREATE FUNCTION scm01_reject_posting_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SCM-01: pending stock postings are append-only for FIN-01 to read'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER scm01_pending_postings_append_only
  BEFORE UPDATE OR DELETE ON scm01_pending_postings
  FOR EACH ROW
  EXECUTE FUNCTION scm01_reject_posting_mutation();

ALTER TABLE scm01_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_settings_isolation ON scm01_settings
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_items FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_items_isolation ON scm01_items
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_item_uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_item_uoms FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_item_uoms_isolation ON scm01_item_uoms
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_batches_isolation ON scm01_batches
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_serials FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_serials_isolation ON scm01_serials
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_movements_isolation ON scm01_movements
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_movement_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_movement_serials FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_movement_serials_isolation ON scm01_movement_serials
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_balances_isolation ON scm01_balances
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_batch_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_batch_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_batch_balances_isolation ON scm01_batch_balances
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_adjustment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_adjustment_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_adjustment_requests_isolation ON scm01_adjustment_requests
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_pending_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_pending_postings FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_pending_postings_isolation ON scm01_pending_postings
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON scm01_settings TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_items TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_item_uoms TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_batches TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_serials TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_movements TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_movement_serials TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_balances TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_batch_balances TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_adjustment_requests TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_pending_postings TO omnivate_app;
