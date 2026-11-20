-- Permit the explicit filed -> locked transition while keeping all other
-- filed-period changes immutable. This also repairs databases that applied
-- the original FIN-03..FIN-06 migration before this guard was corrected.
CREATE OR REPLACE FUNCTION fin06_guard_filed_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'A locked VAT period is immutable; use an adjustment in a later period.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'filed' AND (NEW.status <> 'locked' OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')) THEN
    RAISE EXCEPTION 'A filed VAT period may only transition to locked; use an adjustment in a later period.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
