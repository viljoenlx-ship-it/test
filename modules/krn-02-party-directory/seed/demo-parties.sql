-- Fictional South African contacts for the two demo companies.
-- Not real businesses, people, VAT numbers, or ID numbers.
-- Safe to run again: the named parties are replaced. Audit rows are insert-only.

BEGIN;

DELETE FROM parties
WHERE id IN (
  'c1111111-1111-4111-8111-111111111101',
  'c1111111-1111-4111-8111-111111111102',
  'c1111111-1111-4111-8111-111111111103',
  'c1111111-1111-4111-8111-111111111104',
  'c1111111-1111-4111-8111-111111111105',
  'c2222222-2222-4222-8222-222222222201',
  'c2222222-2222-4222-8222-222222222202',
  'c2222222-2222-4222-8222-222222222203',
  'c2222222-2222-4222-8222-222222222204',
  'c2222222-2222-4222-8222-222222222205'
);

INSERT INTO parties (
  id, tenant_id, kind, display_name, legal_name, trading_name, given_name, family_name,
  registration_number, vat_number, id_number, passport_number,
  popia_consent, popia_consent_at, status, created_at, updated_at
) VALUES
  (
    'c1111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111',
    'organisation', 'Cedar Kite Grocers (Pty) Ltd', 'Cedar Kite Grocers (Pty) Ltd', 'Cedar Kite',
    NULL, NULL, '2018/445566/07', '4991001001', NULL, NULL,
    true, '2026-02-02T08:00:00Z', 'active', '2026-02-02T08:00:00Z', '2026-02-02T08:00:00Z'
  ),
  (
    'c1111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111',
    'organisation', 'Silver Mango Packaging (Pty) Ltd', 'Silver Mango Packaging (Pty) Ltd', 'Silver Mango',
    NULL, NULL, '2016/112233/07', '4991001002', NULL, NULL,
    true, '2026-02-03T08:00:00Z', 'active', '2026-02-03T08:00:00Z', '2026-02-03T08:00:00Z'
  ),
  (
    'c1111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111111',
    'person', 'Lindiwe Jacobs', NULL, NULL, 'Lindiwe', 'Jacobs',
    NULL, NULL, '9204144800082', NULL,
    true, '2026-02-04T08:00:00Z', 'active', '2026-02-04T08:00:00Z', '2026-02-04T08:00:00Z'
  ),
  (
    'c1111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111111',
    'person', 'Noah Pietersen', NULL, 'Pietersen Repairs', 'Noah', 'Pietersen',
    NULL, '4991001003', NULL, 'A12345678',
    true, '2026-02-05T08:00:00Z', 'active', '2026-02-05T08:00:00Z', '2026-02-05T08:00:00Z'
  ),
  (
    'c1111111-1111-4111-8111-111111111105', '11111111-1111-4111-8111-111111111111',
    'organisation', 'Harbour Lantern Club', 'Harbour Lantern Club', NULL,
    NULL, NULL, NULL, NULL, NULL, NULL,
    false, NULL, 'active', '2026-02-06T08:00:00Z', '2026-02-06T08:00:00Z'
  ),
  (
    'c2222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222222',
    'organisation', 'River Thorn Metals (Pty) Ltd', 'River Thorn Metals (Pty) Ltd', 'River Thorn',
    NULL, NULL, '2014/778899/07', '4992002001', NULL, NULL,
    true, '2026-02-02T08:00:00Z', 'active', '2026-02-02T08:00:00Z', '2026-02-02T08:00:00Z'
  ),
  (
    'c2222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222',
    'organisation', 'Polokwane School of Clay', 'Polokwane School of Clay', NULL,
    NULL, NULL, NULL, NULL, NULL, NULL,
    true, '2026-02-03T08:00:00Z', 'active', '2026-02-03T08:00:00Z', '2026-02-03T08:00:00Z'
  ),
  (
    'c2222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222222',
    'person', 'Thabiso Molefe', NULL, NULL, 'Thabiso', 'Molefe',
    NULL, NULL, '8807235678083', NULL,
    true, '2026-02-04T08:00:00Z', 'active', '2026-02-04T08:00:00Z', '2026-02-04T08:00:00Z'
  ),
  (
    'c2222222-2222-4222-8222-222222222204', '22222222-2222-4222-8222-222222222222',
    'person', 'Elize Kruger', NULL, NULL, 'Elize', 'Kruger',
    NULL, NULL, '8505120123088', NULL,
    true, '2026-02-05T08:00:00Z', 'active', '2026-02-05T08:00:00Z', '2026-02-05T08:00:00Z'
  ),
  (
    'c2222222-2222-4222-8222-222222222205', '22222222-2222-4222-8222-222222222222',
    'organisation', 'Baobab Ink Supplies (Pty) Ltd', 'Baobab Ink Supplies (Pty) Ltd', 'Baobab Ink',
    NULL, NULL, '2019/334455/07', '4992002002', NULL, NULL,
    true, '2026-02-06T08:00:00Z', 'active', '2026-02-06T08:00:00Z', '2026-02-06T08:00:00Z'
  );

INSERT INTO party_roles (tenant_id, party_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111101', 'customer'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111102', 'supplier'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111103', 'staff'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111104', 'customer'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111104', 'supplier'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111105', 'other'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222201', 'supplier'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222202', 'customer'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222203', 'staff'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222204', 'customer'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222204', 'staff'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222205', 'supplier');

INSERT INTO party_contacts (tenant_id, party_id, name, job_title, email, phone, is_primary) VALUES
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111101', 'Amina Petersen', 'Accounts clerk', 'amina@cedarkite.example', '082 555 0101', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111102', 'Ruan September', 'Dispatch', 'ruan@silvermango.example', '082 555 0191', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222201', 'Karabo Sithole', 'Buyer', 'karabo@riverthorn.example', '082 555 0301', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222202', 'Dineo Ndlovu', 'Bursar', 'dineo@schoolofclay.example', '082 555 0302', true);

INSERT INTO party_addresses (
  tenant_id, party_id, kind, line1, suburb, city, province, postal_code, country, is_primary
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111101', 'physical', '14 Kite Street', 'Observatory', 'Cape Town', 'Western Cape', '7925', 'ZA', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111102', 'physical', '8 Packhouse Road', 'Paarl', 'Paarl', 'Western Cape', '7646', 'ZA', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111103', 'physical', '3 Orange Lane', 'Gardens', 'Cape Town', 'Western Cape', '8001', 'ZA', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111104', 'physical', '21 Workshop Way', 'Woodstock', 'Cape Town', 'Western Cape', '7925', 'ZA', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111105', 'physical', '1 Lantern Steps', 'Green Point', 'Cape Town', 'Western Cape', '8005', 'ZA', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222201', 'physical', '40 Furnace Street', NULL, 'Polokwane', 'Limpopo', '0699', 'ZA', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222202', 'physical', '12 Clay Road', 'Seshego', 'Polokwane', 'Limpopo', '0742', 'ZA', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222203', 'physical', '9 Marula Close', NULL, 'Polokwane', 'Limpopo', '0700', 'ZA', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222204', 'physical', '5 Saturday Shift Lane', NULL, 'Polokwane', 'Limpopo', '0699', 'ZA', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222205', 'physical', '18 Ink Avenue', NULL, 'Polokwane', 'Limpopo', '0699', 'ZA', true);

INSERT INTO party_channels (tenant_id, party_id, kind, value, label, is_primary) VALUES
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111101', 'email', 'accounts@cedarkite.example', 'Accounts', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111101', 'phone', '021 555 0142', 'Switchboard', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111102', 'email', 'orders@silvermango.example', 'Orders', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111102', 'phone', '021 555 0190', 'Switchboard', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111103', 'email', 'lindiwe.jacobs@staff.example', 'Work', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111103', 'phone', '082 555 0144', 'Mobile', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111104', 'email', 'noah@pietersen-repairs.example', 'Work', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111104', 'phone', '072 555 0177', 'Mobile', true),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111105', 'email', 'hello@harbourlantern.example', 'Desk', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222201', 'email', 'buying@riverthorn.example', 'Buying', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222201', 'phone', '015 555 0140', 'Switchboard', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222202', 'email', 'bursar@schoolofclay.example', 'Bursar', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222203', 'email', 'thabiso.molefe@staff.example', 'Work', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222203', 'phone', '082 555 0202', 'Mobile', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222204', 'email', 'elize.kruger@staff.example', 'Work', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222205', 'email', 'hello@baobabink.example', 'Desk', true),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222205', 'phone', '015 555 0188', 'Switchboard', true);

INSERT INTO party_tags (tenant_id, party_id, tag) VALUES
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111101', 'retail'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111102', 'packaging'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111103', 'floor'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111104', 'workshop'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111105', 'club'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222201', 'metals'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222202', 'school'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222204', 'contractor'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222205', 'ink');

INSERT INTO party_notes (tenant_id, party_id, body, created_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111101', 'Fictional grocery customer in Observatory. Not a real shop.', '2026-02-02T08:05:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111102', 'Fictional packaging supplier. Not a real factory.', '2026-02-03T08:05:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111103', 'Fictional staff member. The ID number is invented.', '2026-02-04T08:05:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111104', 'Fictional sole proprietor who both buys and supplies. Passport number is invented.', '2026-02-05T08:05:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111105', 'A fictional club. Not a customer or a supplier yet, and no POPIA consent is on file.', '2026-02-06T08:05:00Z'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222201', 'Fictional metal supplier in Polokwane. Not a real mill.', '2026-02-02T08:05:00Z'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222202', 'Fictional school customer. Not a real school.', '2026-02-03T08:05:00Z'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222203', 'Fictional staff member. The ID number is invented.', '2026-02-04T08:05:00Z'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222204', 'Fictional person who buys from the foundry and also works a Saturday shift.', '2026-02-05T08:05:00Z'),
  ('22222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222205', 'Fictional ink supplier. Not a real business.', '2026-02-06T08:05:00Z');

INSERT INTO tenant_modules (tenant_id, module_id, active)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'KRN-02', true),
  ('22222222-2222-4222-8222-222222222222', 'KRN-02', true)
ON CONFLICT (tenant_id, module_id) DO UPDATE
SET active = true, updated_at = now();

INSERT INTO sod_rules (id, tenant_id, action_a, action_b, description, enabled)
VALUES
  (
    'd1111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111111',
    'fin.creditor.payout.approve',
    'party.supplier.create',
    'The person who adds a supplier cannot approve that supplier payout.',
    true
  ),
  (
    'd1111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111111',
    'hrp.payroll.payout.approve',
    'party.staff.create',
    'The person who adds a staff member cannot approve that person payout.',
    true
  ),
  (
    'd2222222-2222-4222-8222-222222222201',
    '22222222-2222-4222-8222-222222222222',
    'fin.creditor.payout.approve',
    'party.supplier.create',
    'The person who adds a supplier cannot approve that supplier payout.',
    true
  ),
  (
    'd2222222-2222-4222-8222-222222222202',
    '22222222-2222-4222-8222-222222222222',
    'hrp.payroll.payout.approve',
    'party.staff.create',
    'The person who adds a staff member cannot approve that person payout.',
    true
  )
ON CONFLICT (tenant_id, action_a, action_b) DO NOTHING;

INSERT INTO audit_events (
  id, tenant_id, actor_id, actor_kind, action, entity_type, entity_id, before_data, after_data, user_agent
) VALUES
  (
    'e1111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111111',
    NULL, 'system', 'seed.party', 'party', 'c1111111-1111-4111-8111-111111111101',
    NULL, '{"fictional":true,"displayName":"Cedar Kite Grocers (Pty) Ltd","idNumberPresent":false}'::jsonb,
    'omnivate-seed'
  ),
  (
    'e1111111-1111-4111-8111-111111111103',
    '11111111-1111-4111-8111-111111111111',
    NULL, 'system', 'seed.party', 'party', 'c1111111-1111-4111-8111-111111111103',
    NULL, '{"fictional":true,"displayName":"Lindiwe Jacobs","idNumberPresent":true}'::jsonb,
    'omnivate-seed'
  ),
  (
    'e2222222-2222-4222-8222-222222222201',
    '22222222-2222-4222-8222-222222222222',
    NULL, 'system', 'seed.party', 'party', 'c2222222-2222-4222-8222-222222222201',
    NULL, '{"fictional":true,"displayName":"River Thorn Metals (Pty) Ltd","idNumberPresent":false}'::jsonb,
    'omnivate-seed'
  ),
  (
    'e2222222-2222-4222-8222-222222222203',
    '22222222-2222-4222-8222-222222222222',
    NULL, 'system', 'seed.party', 'party', 'c2222222-2222-4222-8222-222222222203',
    NULL, '{"fictional":true,"displayName":"Thabiso Molefe","idNumberPresent":true}'::jsonb,
    'omnivate-seed'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
