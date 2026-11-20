-- Goods receipts group existing stock receipts. They do not change scm01_movements.
-- A line points at the receipt movement receiveStock already posted.
-- Label prints are an append-only record of what was sent to the printer.

CREATE TABLE scm01_goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  number text NOT NULL,
  branch_id uuid NOT NULL REFERENCES krn03_branches (id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  UNIQUE (tenant_id, number)
);

COMMENT ON TABLE scm01_goods_receipts IS
  'A goods received voucher. Lines point at scm01_movements of kind receipt. The movement table is unchanged.';

CREATE TABLE scm01_goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  goods_receipt_id uuid NOT NULL REFERENCES scm01_goods_receipts (id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  movement_id uuid NOT NULL REFERENCES scm01_movements (id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  UNIQUE (tenant_id, goods_receipt_id, line_no),
  UNIQUE (movement_id)
);

COMMENT ON TABLE scm01_goods_receipt_lines IS
  'One received line. quantity is the quantity the person entered, which is the default label count.';

COMMENT ON COLUMN scm01_goods_receipt_lines.movement_id IS
  'The append-only receipt movement. Reversals stay on the ledger and do not edit this line.';

CREATE INDEX scm01_goods_receipt_lines_receipt_idx
  ON scm01_goods_receipt_lines (tenant_id, goods_receipt_id, line_no);

CREATE TABLE scm01_label_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  goods_receipt_id uuid NOT NULL REFERENCES scm01_goods_receipts (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  copies integer NOT NULL CHECK (copies > 0),
  barcode text NOT NULL,
  printed_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid
);

COMMENT ON TABLE scm01_label_prints IS
  'Append-only audit of a printed label batch: which goods receipt, which item, and how many copies.';

CREATE INDEX scm01_label_prints_receipt_idx
  ON scm01_label_prints (tenant_id, goods_receipt_id, printed_at);

CREATE FUNCTION scm01_reject_goods_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SCM-01: goods receipts are posted documents and are not edited'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER scm01_goods_receipts_append_only
  BEFORE UPDATE OR DELETE ON scm01_goods_receipts
  FOR EACH ROW
  EXECUTE FUNCTION scm01_reject_goods_receipt_mutation();

CREATE TRIGGER scm01_goods_receipt_lines_append_only
  BEFORE UPDATE OR DELETE ON scm01_goods_receipt_lines
  FOR EACH ROW
  EXECUTE FUNCTION scm01_reject_goods_receipt_mutation();

CREATE FUNCTION scm01_reject_label_print_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SCM-01: label prints are append-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER scm01_label_prints_append_only
  BEFORE UPDATE OR DELETE ON scm01_label_prints
  FOR EACH ROW
  EXECUTE FUNCTION scm01_reject_label_print_mutation();

ALTER TABLE scm01_goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_goods_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_goods_receipts_isolation ON scm01_goods_receipts
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_goods_receipt_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_goods_receipt_lines_isolation ON scm01_goods_receipt_lines
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE scm01_label_prints ENABLE ROW LEVEL SECURITY;
ALTER TABLE scm01_label_prints FORCE ROW LEVEL SECURITY;
CREATE POLICY scm01_label_prints_isolation ON scm01_label_prints
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_goods_receipts TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_goods_receipt_lines TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scm01_label_prints TO omnivate_app;
