-- Each company chooses the included reader or the extra-fee reader.
-- Pages are counted separately so the extra-fee usage can be billed.

ALTER TABLE doc_settings
  ADD COLUMN reader text NOT NULL DEFAULT 'standard'
  CHECK (reader IN ('standard', 'premium'));

COMMENT ON COLUMN doc_settings.reader IS
  'standard is included. premium is the extra-fee reader and is used only when a key is configured.';

ALTER TABLE doc_page_usage
  ADD COLUMN reader text NOT NULL DEFAULT 'standard'
  CHECK (reader IN ('standard', 'premium'));

ALTER TABLE doc_page_usage DROP CONSTRAINT doc_page_usage_pkey;
ALTER TABLE doc_page_usage ADD PRIMARY KEY (tenant_id, period, reader);

COMMENT ON COLUMN doc_page_usage.reader IS
  'Which reader the pages were counted against: standard or premium.';
