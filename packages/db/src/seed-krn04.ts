import type pg from 'pg';
import { demoAccounts, demoTenants } from '@omnivate/shared';

const aubergine = demoTenants[0];
const crayon = demoTenants[1];
const atlasOwner = demoAccounts.find(
  (account) => account.email === 'owner@aubergine-atlas.example',
);
const atlasManager = demoAccounts.find(
  (account) => account.email === 'manager@aubergine-atlas.example',
);
const crayonOwner = demoAccounts.find(
  (account) => account.email === 'owner@blue-crayon-foundry.example',
);

const sampleEntity = 'c4111111-1111-4111-8111-111111111040';
const castingEntity = 'd4222222-2222-4222-8222-222222222240';

/**
 * Fictional custom fields, a sample pipeline, and in-app alerts for the two demo companies.
 * Not a business module. Safe to run more than once. Uses the admin connection.
 */
export async function seedKrn04(pool: pg.Pool): Promise<void> {
  if (!atlasOwner || !atlasManager || !crayonOwner) {
    throw new Error('Demo accounts are missing.');
  }

  await pool.query(
    `INSERT INTO krn04_field_definitions (
       id, tenant_id, entity_type, entity_label, field_key, label, field_type, required,
       description, sort_order, min_length, max_length, min_number, max_number,
       min_cents, max_cents, options
     ) VALUES
     (
       'c4111111-1111-4111-8111-111111111001', $1, 'krn04.sample_job', 'Sample job card',
       'site_contact', 'Site contact', 'text', true,
       'Who to ask for on site. An example text field.', 0, NULL, 80, NULL, NULL, NULL, NULL, '[]'
     ),
     (
       'c4111111-1111-4111-8111-111111111002', $1, 'krn04.sample_job', 'Sample job card',
       'delivery_bay', 'Delivery bay', 'select', false,
       'Which bay the goods should come to.', 1,
       NULL, NULL, NULL, NULL, NULL, NULL,
       $2::jsonb
     ),
     (
       'c4111111-1111-4111-8111-111111111003', $1, 'krn04.sample_job', 'Sample job card',
       'pallet_cm', 'Pallet height (cm)', 'number', false,
       'How tall the pallet is. An example number.', 2, NULL, NULL, '0', '300', NULL, NULL, '[]'
     ),
     (
       'c4111111-1111-4111-8111-111111111004', $1, 'krn04.sample_job', 'Sample job card',
       'rush_fee', 'Rush fee', 'money', false,
       'Optional fee in rand. Stored as cents.', 3, NULL, NULL, NULL, NULL, 0, 500000, '[]'
     ),
     (
       'c4111111-1111-4111-8111-111111111005', $1, 'krn04.sample_job', 'Sample job card',
       'promised_on', 'Promised date', 'date', false,
       '', 4, NULL, NULL, NULL, NULL, NULL, NULL, '[]'
     ),
     (
       'c4111111-1111-4111-8111-111111111006', $1, 'krn04.sample_job', 'Sample job card',
       'needs_delivery', 'Needs delivery', 'checkbox', false,
       '', 5, NULL, NULL, NULL, NULL, NULL, NULL, '[]'
     ),
     (
       'c4111111-1111-4111-8111-111111111007', $1, 'krn04.sample_job', 'Sample job card',
       'finish_tags', 'Handling notes', 'multi_select', false,
       'Tick any that apply.', 6, NULL, NULL, NULL, NULL, NULL, NULL,
       $3::jsonb
     ),
     (
       'c4111111-1111-4111-8111-111111111008', $1, 'krn04.sample_job', 'Sample job card',
       'old_counter_code', 'Old counter code', 'text', false,
       'Kept so you can see an archived field. It is not deleted.', 7, NULL, NULL, NULL, NULL, NULL, NULL, '[]'
     ),
     (
       'd4222222-2222-4222-8222-222222222201', $4, 'krn04.sample_casting', 'Casting ticket',
       'alloy_note', 'Alloy note', 'text', true,
       'A note for the fictional foundry. Not a real heat.', 0, NULL, 120, NULL, NULL, NULL, NULL, '[]'
     ),
     (
       'd4222222-2222-4222-8222-222222222202', $4, 'krn04.sample_casting', 'Casting ticket',
       'pour_c', 'Pour temperature (°C)', 'number', false,
       '', 1, NULL, NULL, '0', '2000', NULL, NULL, '[]'
     )
     ON CONFLICT (id) DO UPDATE SET
       field_key = EXCLUDED.field_key,
       field_type = EXCLUDED.field_type,
       label = EXCLUDED.label,
       description = EXCLUDED.description,
       required = EXCLUDED.required,
       options = EXCLUDED.options,
       sort_order = EXCLUDED.sort_order,
       entity_label = EXCLUDED.entity_label`,
    [
      aubergine.id,
      JSON.stringify([
        { value: 'bay_1', label: 'Bay 1' },
        { value: 'bay_2', label: 'Bay 2' },
        { value: 'yard', label: 'Yard' },
      ]),
      JSON.stringify([
        { value: 'fragile', label: 'Fragile' },
        { value: 'after_hours', label: 'After hours' },
        { value: 'account', label: 'Account customer' },
      ]),
      crayon.id,
    ],
  );

  await pool.query(
    `UPDATE krn04_field_definitions
     SET archived_at = COALESCE(archived_at, now())
     WHERE id = 'c4111111-1111-4111-8111-111111111008'`,
  );

  await pool.query(
    `INSERT INTO krn04_field_definitions (
       id, tenant_id, entity_type, entity_label, field_key, label, field_type, required,
       description, sort_order, options, formula, formula_places, formula_display, formula_unit
     ) VALUES
     (
       'c4111111-1111-4111-8111-111111111009', $1, 'krn04.sample_job', 'Sample job card',
       'qty', 'Quantity', 'number', false,
       'How many. An example number used by Line Total.', 8, '[]', NULL, NULL, NULL, ''
     ),
     (
       'c4111111-1111-4111-8111-11111111100a', $1, 'krn04.sample_job', 'Sample job card',
       'price', 'Price', 'money', false,
       'Price each, stored as cents.', 9, '[]', NULL, NULL, NULL, ''
     ),
     (
       'c4111111-1111-4111-8111-11111111100b', $1, 'krn04.sample_job', 'Sample job card',
       'line_total', 'Line Total', 'calculated', false,
       'Quantity times price. Clients cannot type this.', 10, '[]',
       'qty * price', 0, 'money', ''
     )
     ON CONFLICT (id) DO UPDATE SET
       label = EXCLUDED.label,
       field_type = EXCLUDED.field_type,
       formula = EXCLUDED.formula,
       formula_places = EXCLUDED.formula_places,
       formula_display = EXCLUDED.formula_display,
       formula_unit = EXCLUDED.formula_unit,
       description = EXCLUDED.description,
       sort_order = EXCLUDED.sort_order`,
    [aubergine.id],
  );

  const jobStates = [
    { key: 'draft', label: 'Draft', kind: 'initial' },
    { key: 'in_progress', label: 'In progress', kind: 'open' },
    { key: 'done', label: 'Done', kind: 'terminal' },
  ];
  const jobMoves = [
    {
      key: 'start',
      from: 'draft',
      to: 'in_progress',
      label: 'Start work',
      permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
      auditAction: 'krn04.sample.start',
    },
    {
      key: 'finish',
      from: 'in_progress',
      to: 'done',
      label: 'Finish',
      permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
      makerChecker: {
        action: 'krn04.sample.finish',
        oppositeAction: 'krn04.sample.start',
        description: 'The person who starts a sample job card cannot finish it.',
      },
    },
  ];
  const extraStates = [{ key: 'waiting_parts', label: 'Waiting for parts', kind: 'open' }];
  const extraMoves = [
    {
      key: 'wait_parts',
      from: 'in_progress',
      to: 'waiting_parts',
      label: 'Wait for parts',
      permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
    },
    {
      key: 'parts_in',
      from: 'waiting_parts',
      to: 'in_progress',
      label: 'Parts arrived',
      permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
    },
  ];

  await pool.query(
    `INSERT INTO krn04_pipelines (
       id, tenant_id, machine_key, entity_type, entity_label, label,
       base_states, base_transitions, extra_states, extra_transitions
     ) VALUES
     (
       'c4111111-1111-4111-8111-111111111010', $1, 'krn04.sample_job', 'krn04.sample_job',
       'Sample job card', 'Job card', $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb
     ),
     (
       'd4222222-2222-4222-8222-222222222210', $6, 'krn04.sample_casting', 'krn04.sample_casting',
       'Casting ticket', 'Casting ticket', $7::jsonb, $8::jsonb, '[]'::jsonb, '[]'::jsonb
     )
     ON CONFLICT (id) DO UPDATE SET
       label = EXCLUDED.label,
       base_states = EXCLUDED.base_states,
       base_transitions = EXCLUDED.base_transitions,
       extra_states = EXCLUDED.extra_states,
       extra_transitions = EXCLUDED.extra_transitions,
       archived_at = NULL`,
    [
      aubergine.id,
      JSON.stringify(jobStates),
      JSON.stringify(jobMoves),
      JSON.stringify(extraStates),
      JSON.stringify(extraMoves),
      crayon.id,
      JSON.stringify([
        { key: 'queued', label: 'Queued', kind: 'initial' },
        { key: 'pouring', label: 'Pouring', kind: 'open' },
        { key: 'cooled', label: 'Cooled', kind: 'terminal' },
      ]),
      JSON.stringify([
        {
          key: 'pour',
          from: 'queued',
          to: 'pouring',
          label: 'Start the pour',
          permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
        },
        {
          key: 'cool',
          from: 'pouring',
          to: 'cooled',
          label: 'Mark cooled',
          permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
        },
      ]),
    ],
  );

  await pool.query(
    `INSERT INTO krn04_field_values (id, tenant_id, entity_type, entity_id, values)
     VALUES
     (
       'c4111111-1111-4111-8111-111111111041', $1, 'krn04.sample_job', $2, $3::jsonb
     ),
     (
       'd4222222-2222-4222-8222-222222222241', $4, 'krn04.sample_casting', $5, $6::jsonb
     )
     ON CONFLICT (id) DO UPDATE SET values = EXCLUDED.values`,
    [
      aubergine.id,
      sampleEntity,
      JSON.stringify({
        site_contact: 'Nomsa at the counter',
        delivery_bay: 'bay_1',
        pallet_cm: '120',
        rush_fee: 15000,
        promised_on: '2026-12-01',
        finish_tags: ['fragile'],
        qty: '4',
        price: 1250,
        line_total: 5000,
      }),
      crayon.id,
      castingEntity,
      JSON.stringify({ alloy_note: 'Fictional bronze mix for the gallery rail', pour_c: '1180' }),
    ],
  );

  await pool.query(
    `DELETE FROM krn04_transition_log
     WHERE pipeline_id IN (
       'c4111111-1111-4111-8111-111111111010',
       'd4222222-2222-4222-8222-222222222210'
     )`,
  );
  await pool.query(
    `INSERT INTO krn04_instances (id, tenant_id, pipeline_id, entity_id, state_key)
     VALUES
     (
       'c4111111-1111-4111-8111-111111111042', $1,
       'c4111111-1111-4111-8111-111111111010', $2, 'draft'
     ),
     (
       'd4222222-2222-4222-8222-222222222242', $3,
       'd4222222-2222-4222-8222-222222222210', $4, 'queued'
     )
     ON CONFLICT (id) DO UPDATE SET state_key = EXCLUDED.state_key`,
    [aubergine.id, sampleEntity, crayon.id, castingEntity],
  );

  await pool.query(
    `INSERT INTO krn04_workflow_rules (
       id, tenant_id, name, entity_type, trigger_kind, event_key, machine_key, transition_key,
       conditions, action_kind, action_config, enabled
     ) VALUES
     (
       'c4111111-1111-4111-8111-111111111020', $1, 'Rush job finished', 'krn04.sample_job',
       'transition', NULL, 'krn04.sample_job', 'finish',
       $2::jsonb, 'notify', $3::jsonb, true
     ),
     (
       'c4111111-1111-4111-8111-111111111021', $1, 'Delivery requested', 'krn04.sample_job',
       'event', 'fields.saved', NULL, NULL,
       $4::jsonb, 'audit', $5::jsonb, true
     ),
     (
       'd4222222-2222-4222-8222-222222222220', $6, 'Casting cooled', 'krn04.sample_casting',
       'transition', NULL, 'krn04.sample_casting', 'cool',
       '[]'::jsonb, 'audit', $7::jsonb, true
     )
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       conditions = EXCLUDED.conditions,
       action_config = EXCLUDED.action_config,
       enabled = true,
       archived_at = NULL`,
    [
      aubergine.id,
      JSON.stringify([{ source: 'field', key: 'rush_fee', op: 'gt', value: '0' }]),
      JSON.stringify({
        title: 'Rush job finished',
        body: 'A sample job card with a rush fee was finished. This stays inside Omnivate.',
        audience: 'role',
        roleKey: 'tenant_owner',
      }),
      JSON.stringify([{ source: 'field', key: 'needs_delivery', op: 'is_true' }]),
      JSON.stringify({
        message: 'Delivery was requested on a sample job card.',
      }),
      crayon.id,
      JSON.stringify({ message: 'A fictional casting ticket cooled.' }),
    ],
  );

  await pool.query(
    `INSERT INTO sod_rules (id, tenant_id, action_a, action_b, description, enabled)
     VALUES (
       'c4111111-1111-4111-8111-111111111050', $1,
       'krn04.sample.finish', 'krn04.sample.start',
       'The person who starts a sample job card cannot finish it.',
       true
     )
     ON CONFLICT (id) DO UPDATE SET enabled = true, description = EXCLUDED.description`,
    [aubergine.id],
  );

  await pool.query(
    `INSERT INTO krn04_automations (
       id, tenant_id, name, entity_type, trigger_kind, field_key, conditions, actions, enabled, sort_order
     ) VALUES (
       'c4111111-1111-4111-8111-111111111060', $1, 'Reorder Alert', 'scm.item',
       'field_changed', 'on_hand', $2::jsonb, $3::jsonb, true, 0
     )
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       conditions = EXCLUDED.conditions,
       actions = EXCLUDED.actions,
       enabled = true,
       archived_at = NULL`,
    [
      aubergine.id,
      JSON.stringify([{ fieldKey: 'on_hand', op: 'lt', otherField: 'reorder_level', value: null }]),
      JSON.stringify([
        {
          kind: 'notify',
          audience: 'role',
          roleKey: 'branch_manager',
          userId: null,
          title: 'Stock Is Low',
          body: 'On hand has fallen below the reorder level.',
        },
      ]),
    ],
  );

  await pool.query(
    `INSERT INTO krn04_automation_runs (
       id, tenant_id, automation_id, entity_type, entity_id, status, summary, depth, occurred_at
     ) VALUES (
       'c4111111-1111-4111-8111-111111111061', $1,
       'c4111111-1111-4111-8111-111111111060', 'scm.item',
       'c1111111-1111-4111-8111-111111111002', 'ran',
       'On hand is 12, below the reorder level of 20. Alerted the manager.',
       0, '2026-11-18T08:30:00.000Z'
     )
     ON CONFLICT (id) DO UPDATE SET summary = EXCLUDED.summary, status = EXCLUDED.status`,
    [aubergine.id],
  );

  await pool.query(`DELETE FROM krn04_notifications WHERE tenant_id = ANY($1::uuid[])`, [
    [aubergine.id, crayon.id],
  ]);
  await pool.query(
    `INSERT INTO krn04_notifications (id, tenant_id, user_id, title, body, entity_type, entity_id)
     VALUES (
       'c4111111-1111-4111-8111-111111111030', $1, $2,
       'Sample job card is waiting',
       'Aubergine Atlas has a fictional job card in Draft. Open Pipelines and alerts to move it.',
       'krn04.sample_job', $3
     ),
     (
       'c4111111-1111-4111-8111-111111111031', $1, $2,
       'Stock Is Low',
       'Portland cement is down to 12 bags. The reorder level is 20. This stays inside Omnivate.',
       'scm.item', 'c1111111-1111-4111-8111-111111111002'
     )
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       read_at = NULL`,
    [aubergine.id, atlasManager.id, sampleEntity],
  );

  await pool.query(
    `INSERT INTO krn04_field_definitions (
       id, tenant_id, entity_type, entity_label, field_key, label, field_type, required,
       description, sort_order, options, formula, formula_places, formula_display, formula_unit
     ) VALUES
     (
       'c4111111-1111-4111-8111-1111111110c1', $1, 'scm.item', 'Stock Item',
       'shelf_code', 'Shelf Code', 'text', false,
       'Where the fictional item sits. Not a real bin.', 20, '[]', NULL, NULL, NULL, ''
     ),
     (
       'c4111111-1111-4111-8111-1111111110c2', $1, 'scm.item', 'Stock Item',
       'margin', 'Margin', 'calculated', false,
       'Selling price minus cost. Clients cannot type this.', 21, '[]',
       'selling_price - cost', 0, 'money', ''
     )
     ON CONFLICT (id) DO UPDATE SET
       label = EXCLUDED.label,
       formula = EXCLUDED.formula,
       formula_display = EXCLUDED.formula_display,
       field_type = EXCLUDED.field_type`,
    [aubergine.id],
  );
  await pool.query(
    `INSERT INTO krn04_field_values (id, tenant_id, entity_type, entity_id, values)
     VALUES (
       'c4111111-1111-4111-8111-1111111110c3', $1, 'scm.item',
       'c1111111-1111-4111-8111-111111111002',
       '{"shelf_code":"Bay A"}'::jsonb
     )
     ON CONFLICT (id) DO UPDATE SET values = EXCLUDED.values`,
    [aubergine.id],
  );

  await pool.query(
    `INSERT INTO audit_events (
       id, tenant_id, actor_id, actor_kind, action, entity_type, entity_id, before_data, after_data, user_agent
     ) VALUES
     (
       'c4111111-1111-4111-8111-111111111090', $1, NULL, 'system', 'seed.krn04',
       'tenant', $1, NULL, '{"fictional":true,"module":"KRN-04"}'::jsonb, 'omnivate-seed'
     ),
     (
       'd4222222-2222-4222-8222-222222222290', $2, NULL, 'system', 'seed.krn04',
       'tenant', $2, NULL, '{"fictional":true,"module":"KRN-04"}'::jsonb, 'omnivate-seed'
     ),
     (
       'c4111111-1111-4111-8111-111111111091', $1, NULL, 'system', 'workflow.automation.ran',
       'scm.item', 'c1111111-1111-4111-8111-111111111002', NULL,
       '{"automation":"Reorder Alert","status":"ran","summary":"On hand is 12, below the reorder level of 20. Alerted the manager.","depth":0,"fictional":true}'::jsonb,
       'omnivate-seed'
     )
     ON CONFLICT (id) DO NOTHING`,
    [aubergine.id, crayon.id],
  );
}
