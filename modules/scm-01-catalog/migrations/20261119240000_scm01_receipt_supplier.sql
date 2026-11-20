-- Supplier on a goods receipt. Nullable so a note posted before this column still stands.
-- The receipt itself stays append-only. This column is set when the note is created.

ALTER TABLE scm01_goods_receipts
  ADD COLUMN supplier_party_id uuid NULL REFERENCES parties (id) ON DELETE RESTRICT;

COMMENT ON COLUMN scm01_goods_receipts.supplier_party_id IS
  'The supplier on the goods received note. Empty when the delivery was recorded without one.';
