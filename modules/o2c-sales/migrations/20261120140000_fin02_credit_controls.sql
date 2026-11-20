-- FIN-02 credit controls and auditable overdue-reminder queue.
ALTER TABLE o2c_customer_terms
  ADD COLUMN credit_limit_cents bigint NULL CHECK (credit_limit_cents IS NULL OR credit_limit_cents >= 0),
  ADD COLUMN credit_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN credit_hold_reason text NOT NULL DEFAULT '';

CREATE TABLE o2c_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES o2c_documents(id) ON DELETE RESTRICT,
  reminder_stage text NOT NULL CHECK (reminder_stage IN ('first','second','final')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','cancelled')),
  recipient_email text NOT NULL DEFAULT '',
  subject text NOT NULL,
  message text NOT NULL,
  queued_by uuid NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid NULL,
  sent_at timestamptz NULL,
  UNIQUE (tenant_id, invoice_id, reminder_stage)
);
CREATE INDEX o2c_reminders_queue_idx ON o2c_reminders(tenant_id, status, queued_at);

ALTER TABLE o2c_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_reminders_isolation ON o2c_reminders
  FOR ALL USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON o2c_reminders TO omnivate_app;
