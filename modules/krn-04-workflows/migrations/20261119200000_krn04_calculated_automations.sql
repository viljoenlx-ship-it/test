-- Calculated fields and operator automations for KRN-04.
-- A calculated value is derived. Clients do not type it.
-- Automation runs are append-only for omnivate_app, same as transition history.
-- Definitions and automations are archived, not deleted.

ALTER TABLE krn04_field_definitions
  DROP CONSTRAINT IF EXISTS krn04_field_definitions_field_type_check;

ALTER TABLE krn04_field_definitions
  ADD CONSTRAINT krn04_field_definitions_field_type_check
  CHECK (
    field_type IN (
      'text', 'number', 'money', 'date', 'select', 'multi_select', 'checkbox', 'calculated'
    )
  );

ALTER TABLE krn04_field_definitions
  ADD COLUMN formula text NULL,
  ADD COLUMN formula_places smallint NULL,
  ADD COLUMN formula_display text NULL,
  ADD COLUMN formula_unit text NOT NULL DEFAULT '';

ALTER TABLE krn04_field_definitions
  ADD CONSTRAINT krn04_field_formula_shape CHECK (
    (
      field_type = 'calculated'
      AND formula IS NOT NULL
      AND length(btrim(formula)) BETWEEN 1 AND 500
      AND formula_display IN ('number', 'money')
      AND formula_places BETWEEN 0 AND 4
      AND (formula_display <> 'money' OR formula_places = 0)
      AND length(formula_unit) <= 20
    )
    OR (
      field_type <> 'calculated'
      AND formula IS NULL
      AND formula_places IS NULL
      AND formula_display IS NULL
      AND formula_unit = ''
    )
  );

COMMENT ON COLUMN krn04_field_definitions.formula IS
  'Expression over number, money, and decimal fields on the same record. Parsed by the app. Never evaluated as code.';

COMMENT ON COLUMN krn04_field_definitions.formula_display IS
  'number prints a decimal. money prints rand and stores integer cents.';

CREATE TABLE krn04_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  name text NOT NULL,
  entity_type text NOT NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('created', 'field_changed')),
  field_key text NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL CHECK (sort_order >= 0 AND sort_order < 1000),
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT krn04_automation_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT krn04_automation_entity CHECK (entity_type ~ '^[a-z][a-z0-9_.]{1,63}$'),
  CONSTRAINT krn04_automation_trigger CHECK (
    (
      trigger_kind = 'created' AND field_key IS NULL
    )
    OR (
      trigger_kind = 'field_changed'
      AND field_key IS NOT NULL
      AND field_key ~ '^[a-z][a-z0-9_]{0,40}$'
    )
  ),
  CONSTRAINT krn04_automation_conditions CHECK (jsonb_typeof(conditions) = 'array'),
  CONSTRAINT krn04_automation_actions CHECK (
    jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 5
  )
);

COMMENT ON TABLE krn04_automations IS
  'Operator rules: when a record is created or a field changes, and the conditions match, run the actions in order. Company roles cannot edit these.';

CREATE INDEX krn04_automations_tenant_idx
  ON krn04_automations (tenant_id, entity_type, sort_order);

CREATE TABLE krn04_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  automation_id uuid NOT NULL REFERENCES krn04_automations (id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ran', 'skipped', 'stopped')),
  summary text NOT NULL,
  depth integer NOT NULL CHECK (depth >= 0 AND depth < 20),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT krn04_automation_run_summary CHECK (length(btrim(summary)) BETWEEN 1 AND 500)
);

COMMENT ON TABLE krn04_automation_runs IS
  'Append-only log of automation runs for the application role. audit_events stores the same run.';

CREATE INDEX krn04_automation_runs_idx
  ON krn04_automation_runs (tenant_id, automation_id, occurred_at DESC);

CREATE TRIGGER krn04_automations_no_delete
  BEFORE DELETE ON krn04_automations
  FOR EACH ROW
  EXECUTE FUNCTION krn04_reject_delete();

CREATE FUNCTION krn04_reject_run_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'omnivate_app' THEN
    RAISE EXCEPTION 'KRN-04: automation runs are append-only'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION krn04_reject_run_change() IS
  'Automation run history is insert-only for omnivate_app. The same run is written to audit_events.';

CREATE TRIGGER krn04_automation_runs_append_only
  BEFORE UPDATE OR DELETE ON krn04_automation_runs
  FOR EACH ROW
  EXECUTE FUNCTION krn04_reject_run_change();

ALTER TABLE krn04_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_automations FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_automations_isolation ON krn04_automations
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn04_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn04_automation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY krn04_automation_runs_isolation ON krn04_automation_runs
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON krn04_automations TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON krn04_automation_runs TO omnivate_app;
