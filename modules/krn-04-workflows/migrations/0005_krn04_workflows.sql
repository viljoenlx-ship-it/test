-- KRN-04 Custom fields, state machines, and workflows.
-- Tenant-owned. omnivate_app has no default grant, so each table is named below.
-- Definitions, pipelines, and rules are archived, not deleted, when the app role tries.
-- Transition history is append-only for the app role. The database owner can still
-- reset a local database. Notifications are visible only to the user named in
-- app.current_user_id, which the module sets inside the tenant transaction.

CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app_current_user_id() IS
  'User for this transaction when a table is private to one person. Missing means no rows.';

CREATE FUNCTION krn04_reject_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'omnivate_app' THEN
    RAISE EXCEPTION 'KRN-04: archive this row instead of deleting it'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION krn04_reject_delete() IS
  'Stops the application role from hard-deleting KRN-04 configuration. Archive the row instead.';

CREATE FUNCTION krn04_reject_history_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'omnivate_app' THEN
    RAISE EXCEPTION 'KRN-04: transition history is append-only'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION krn04_reject_history_change() IS
  'Transition history is insert-only for omnivate_app. The before/after also goes to audit_events.';

CREATE TABLE krn04_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_label text NOT NULL,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL CHECK (
    field_type IN ('text', 'number', 'money', 'date', 'select', 'multi_select', 'checkbox')
  ),
  required boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL CHECK (sort_order >= 0 AND sort_order < 1000),
  min_length integer NULL,
  max_length integer NULL,
  min_number text NULL,
  max_number text NULL,
  min_cents bigint NULL,
  max_cents bigint NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, field_key),
  CONSTRAINT krn04_field_entity_type CHECK (entity_type ~ '^[a-z][a-z0-9_.]{1,63}$'),
  CONSTRAINT krn04_field_key CHECK (field_key ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT krn04_field_label CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  CONSTRAINT krn04_field_entity_label CHECK (length(btrim(entity_label)) BETWEEN 1 AND 80),
  CONSTRAINT krn04_field_options_array CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT krn04_field_length_order CHECK (
    min_length IS NULL OR max_length IS NULL OR min_length <= max_length
  ),
  CONSTRAINT krn04_field_cents_order CHECK (
    min_cents IS NULL OR max_cents IS NULL OR min_cents <= max_cents
  )
);

COMMENT ON TABLE krn04_field_definitions IS
  'Tenant custom fields for an entity type a module registered. Archive instead of delete. Money bounds are cents.';

COMMENT ON COLUMN krn04_field_definitions.min_cents IS
  'Exact integer cents. Never a float.';

CREATE INDEX krn04_field_definitions_tenant_idx
  ON krn04_field_definitions (tenant_id, entity_type, sort_order);

CREATE TABLE krn04_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  values jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, entity_id),
  CONSTRAINT krn04_values_entity_type CHECK (entity_type ~ '^[a-z][a-z0-9_.]{1,63}$'),
  CONSTRAINT krn04_values_object CHECK (jsonb_typeof(values) = 'object')
);

COMMENT ON TABLE krn04_field_values IS
  'Custom field values for one record. The API validates this JSON against krn04_field_definitions before writing.';

CREATE INDEX krn04_field_values_tenant_idx ON krn04_field_values (tenant_id, entity_type);

CREATE TABLE krn04_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  machine_key text NOT NULL,
  entity_type text NOT NULL,
  entity_label text NOT NULL,
  label text NOT NULL,
  base_states jsonb NOT NULL,
  base_transitions jsonb NOT NULL,
  extra_states jsonb NOT NULL DEFAULT '[]'::jsonb,
  extra_transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, machine_key),
  CONSTRAINT krn04_pipeline_machine CHECK (machine_key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  CONSTRAINT krn04_pipeline_entity_type CHECK (entity_type ~ '^[a-z][a-z0-9_.]{1,63}$'),
  CONSTRAINT krn04_pipeline_label CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  CONSTRAINT krn04_pipeline_arrays CHECK (
    jsonb_typeof(base_states) = 'array'
    AND jsonb_typeof(base_transitions) = 'array'
    AND jsonb_typeof(extra_states) = 'array'
    AND jsonb_typeof(extra_transitions) = 'array'
  )
);

COMMENT ON TABLE krn04_pipelines IS
  'A module base state machine plus the stages a company added. Base states are not removed.';

CREATE INDEX krn04_pipelines_tenant_idx ON krn04_pipelines (tenant_id, entity_type);

CREATE TABLE krn04_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  pipeline_id uuid NOT NULL REFERENCES krn04_pipelines (id) ON DELETE RESTRICT,
  entity_id uuid NOT NULL,
  state_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, pipeline_id, entity_id),
  CONSTRAINT krn04_instance_state CHECK (state_key ~ '^[a-z][a-z0-9_]{0,40}$')
);

COMMENT ON TABLE krn04_instances IS
  'Current state of one record on a pipeline.';

CREATE INDEX krn04_instances_tenant_idx ON krn04_instances (tenant_id, pipeline_id);

CREATE TABLE krn04_transition_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  pipeline_id uuid NOT NULL REFERENCES krn04_pipelines (id) ON DELETE RESTRICT,
  entity_id uuid NOT NULL,
  transition_key text NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_id uuid NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE krn04_transition_log IS
  'Append-only pipeline history for the application role. audit_events stores the same move with before and after.';

CREATE INDEX krn04_transition_log_entity_idx
  ON krn04_transition_log (tenant_id, pipeline_id, entity_id, occurred_at);

CREATE TABLE krn04_workflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  name text NOT NULL,
  entity_type text NOT NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('event', 'transition')),
  event_key text NULL,
  machine_key text NULL,
  transition_key text NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_kind text NOT NULL,
  action_config jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT krn04_rule_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT krn04_rule_entity_type CHECK (entity_type ~ '^[a-z][a-z0-9_.]{1,63}$'),
  CONSTRAINT krn04_rule_trigger CHECK (
    (
      trigger_kind = 'event'
      AND event_key IS NOT NULL
      AND machine_key IS NULL
      AND transition_key IS NULL
    )
    OR (
      trigger_kind = 'transition'
      AND event_key IS NULL
      AND machine_key IS NOT NULL
      AND transition_key IS NOT NULL
    )
  ),
  CONSTRAINT krn04_rule_conditions CHECK (jsonb_typeof(conditions) = 'array'),
  CONSTRAINT krn04_rule_config CHECK (jsonb_typeof(action_config) = 'object')
);

COMMENT ON TABLE krn04_workflow_rules IS
  'When an event or transition matches, run an in-app action. Email and WhatsApp are not actions yet.';

CREATE INDEX krn04_workflow_rules_tenant_idx
  ON krn04_workflow_rules (tenant_id, entity_type, trigger_kind);

CREATE TABLE krn04_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  rule_id uuid NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_type text NULL,
  entity_id uuid NULL,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT krn04_notification_title CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT krn04_notification_body CHECK (length(btrim(body)) BETWEEN 1 AND 500)
);

COMMENT ON TABLE krn04_notifications IS
  'In-app alerts. A person sees only their own rows. Nothing is emailed or sent to WhatsApp.';

CREATE INDEX krn04_notifications_user_idx
  ON krn04_notifications (tenant_id, user_id, created_at DESC);

CREATE TRIGGER krn04_field_definitions_no_delete
  BEFORE DELETE ON krn04_field_definitions
  FOR EACH ROW
  EXECUTE FUNCTION krn04_reject_delete();

CREATE TRIGGER krn04_pipelines_no_delete
  BEFORE DELETE ON krn04_pipelines
  FOR EACH ROW
  EXECUTE FUNCTION krn04_reject_delete();

CREATE TRIGGER krn04_workflow_rules_no_delete
  BEFORE DELETE ON krn04_workflow_rules
  FOR EACH ROW
  EXECUTE FUNCTION krn04_reject_delete();

CREATE TRIGGER krn04_transition_log_append_only
  BEFORE UPDATE OR DELETE ON krn04_transition_log
  FOR EACH ROW
  EXECUTE FUNCTION krn04_reject_history_change();

ALTER TABLE krn04_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_field_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_field_definitions_isolation ON krn04_field_definitions
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn04_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_field_values FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_field_values_isolation ON krn04_field_values
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn04_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_pipelines FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_pipelines_isolation ON krn04_pipelines
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn04_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_instances FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_instances_isolation ON krn04_instances
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn04_transition_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_transition_log FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_transition_log_isolation ON krn04_transition_log
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn04_workflow_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_workflow_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_workflow_rules_isolation ON krn04_workflow_rules
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn04_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_notifications_select ON krn04_notifications
  FOR SELECT
  USING (
    tenant_id = app_current_tenant_id()
    AND user_id = app_current_user_id()
  );
CREATE POLICY krn04_notifications_update ON krn04_notifications
  FOR UPDATE
  USING (
    tenant_id = app_current_tenant_id()
    AND user_id = app_current_user_id()
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND user_id = app_current_user_id()
  );
CREATE POLICY krn04_notifications_insert ON krn04_notifications
  FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON krn04_field_definitions TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn04_field_values TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON krn04_pipelines TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn04_instances TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON krn04_transition_log TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON krn04_workflow_rules TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn04_notifications TO omnivate_app;
