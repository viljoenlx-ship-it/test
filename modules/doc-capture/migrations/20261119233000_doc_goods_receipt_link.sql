-- A captured invoice that is received is also a goods receipt, so labels can be printed.

ALTER TABLE doc_documents
  ADD COLUMN goods_receipt_id uuid REFERENCES scm01_goods_receipts (id) ON DELETE RESTRICT;

COMMENT ON COLUMN doc_documents.goods_receipt_id IS
  'The goods receipt created when this document was received. Print Labels uses it.';
