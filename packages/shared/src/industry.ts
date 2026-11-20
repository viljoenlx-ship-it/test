import { activationClosure, activationOrder, type ModuleId } from './modules';

/**
 * Industry presets from blueprint tab 5.
 * A cell marked ON (including "Light" and "Primary") is in `modules`.
 * Optional and OFF are not. Hard prerequisites can still pull a module in
 * when the preset is applied. The matrix is not a second dependency graph.
 */

export const INDUSTRY_PRESETS = [
  {
    key: 'retail_hardware',
    name: 'Retail & Hardware Store',
    summary: 'Counter sales, till floats, stock, and returns.',
    modules: [
      'KRN-01',
      'KRN-02',
      'KRN-03',
      'KRN-04',
      'KRN-05',
      'KRN-06',
      'FIN-01',
      'FIN-02',
      'FIN-03',
      'FIN-04',
      'FIN-05',
      'FIN-06',
      'SAL-03',
      'SAL-05',
      'SCM-01',
      'SCM-02',
      'SCM-03',
      'OPS-01',
      'HRP-01',
      'HRP-02',
      'HRP-03',
      'HRP-04',
      'HRP-05',
      'CMP-01',
      'CMP-02',
      'CMP-03',
      'ANA-01',
      'ANA-02',
      'ANA-03',
    ],
  },
  {
    key: 'field_service',
    name: 'Field Service & Contractors',
    summary: 'Jobs, van stock, site cash, and warranties.',
    modules: [
      'KRN-01',
      'KRN-02',
      'KRN-03',
      'KRN-04',
      'KRN-05',
      'KRN-06',
      'FIN-01',
      'FIN-02',
      'FIN-03',
      'FIN-04',
      'FIN-05',
      'FIN-06',
      'SAL-01',
      'SAL-02',
      'SAL-05',
      'SCM-01',
      'SCM-02',
      'SCM-03',
      'OPS-02',
      'OPS-03',
      'HRP-01',
      'HRP-02',
      'HRP-03',
      'HRP-04',
      'HRP-05',
      'CMP-01',
      'CMP-02',
      'CMP-03',
      'ANA-01',
      'ANA-02',
      'ANA-03',
    ],
  },
  {
    key: 'manufacturing',
    name: 'Manufacturing & Assembly',
    summary: 'Bills of materials, raw materials, and quality checks.',
    modules: [
      'KRN-01',
      'KRN-02',
      'KRN-03',
      'KRN-04',
      'KRN-05',
      'KRN-06',
      'FIN-01',
      'FIN-02',
      'FIN-03',
      'FIN-04',
      'FIN-06',
      'SAL-01',
      'SAL-02',
      'SAL-05',
      'SCM-01',
      'SCM-02',
      'SCM-03',
      'SCM-04',
      'OPS-01',
      'OPS-03',
      'OPS-04',
      'HRP-01',
      'HRP-02',
      'HRP-03',
      'HRP-04',
      'HRP-05',
      'CMP-01',
      'CMP-02',
      'CMP-03',
      'ANA-01',
      'ANA-02',
      'ANA-03',
    ],
  },
  {
    key: 'equipment_hire',
    name: 'Equipment Rentals & Hire',
    summary: 'Hire units, recurring invoices, and pre-hire checks.',
    modules: [
      'KRN-01',
      'KRN-02',
      'KRN-03',
      'KRN-04',
      'KRN-05',
      'KRN-06',
      'FIN-01',
      'FIN-02',
      'FIN-03',
      'FIN-04',
      'FIN-06',
      'SAL-01',
      'SAL-02',
      'SAL-04',
      'SAL-05',
      'SCM-01',
      'SCM-02',
      'SCM-03',
      'SCM-04',
      'OPS-02',
      'OPS-03',
      'OPS-04',
      'HRP-01',
      'HRP-02',
      'HRP-03',
      'HRP-04',
      'HRP-05',
      'CMP-01',
      'CMP-02',
      'CMP-03',
      'ANA-01',
      'ANA-02',
      'ANA-03',
    ],
  },
  {
    key: 'professional_services',
    name: 'Professional & IT Services',
    summary: 'Quotes, retainers, projects, and expenses.',
    modules: [
      'KRN-01',
      'KRN-02',
      'KRN-03',
      'KRN-04',
      'KRN-05',
      'KRN-06',
      'FIN-01',
      'FIN-02',
      'FIN-03',
      'FIN-04',
      'FIN-05',
      'FIN-06',
      'SAL-01',
      'SAL-02',
      'SAL-04',
      'SAL-05',
      'OPS-02',
      'HRP-01',
      'HRP-02',
      'HRP-03',
      'HRP-04',
      'HRP-05',
      'CMP-01',
      'CMP-02',
      'CMP-03',
      'ANA-01',
      'ANA-02',
      'ANA-03',
    ],
  },
  {
    key: 'transport',
    name: 'Transport & Logistics',
    summary: 'Trips, fleet, driver fuel, and dispatch.',
    modules: [
      'KRN-01',
      'KRN-02',
      'KRN-03',
      'KRN-04',
      'KRN-05',
      'KRN-06',
      'FIN-01',
      'FIN-02',
      'FIN-03',
      'FIN-04',
      'FIN-05',
      'FIN-06',
      'SAL-01',
      'SAL-02',
      'SCM-04',
      'OPS-03',
      'HRP-01',
      'HRP-02',
      'HRP-03',
      'HRP-04',
      'HRP-05',
      'CMP-01',
      'CMP-02',
      'CMP-03',
      'ANA-01',
      'ANA-02',
      'ANA-03',
    ],
  },
] as const satisfies readonly {
  key: string;
  name: string;
  summary: string;
  modules: readonly ModuleId[];
}[];

export type IndustryPresetKey = (typeof INDUSTRY_PRESETS)[number]['key'];

export type IndustryPreset = (typeof INDUSTRY_PRESETS)[number];

export function isIndustryPresetKey(value: string): value is IndustryPresetKey {
  return INDUSTRY_PRESETS.some((preset) => preset.key === value);
}

export function getIndustryPreset(key: IndustryPresetKey): IndustryPreset {
  const preset = INDUSTRY_PRESETS.find((item) => item.key === key);
  if (!preset) {
    throw new Error(`Unknown industry preset ${key}.`);
  }
  return preset;
}

export type ActivationPlan = {
  markedOn: ModuleId[];
  sequence: ModuleId[];
  pulledIn: ModuleId[];
};

/** ON modules plus every hard prerequisite, in an order that can be activated. */
export function industryActivationPlan(key: IndustryPresetKey): ActivationPlan {
  const marked = new Set<ModuleId>(getIndustryPreset(key).modules);
  return planFromMarked(marked);
}

export function planFromMarked(marked: ReadonlySet<ModuleId>): ActivationPlan {
  const sequence: ModuleId[] = [];
  const seen = new Set<ModuleId>();
  for (const id of activationOrder()) {
    if (!marked.has(id)) {
      continue;
    }
    for (const step of activationClosure(id)) {
      if (seen.has(step)) {
        continue;
      }
      seen.add(step);
      sequence.push(step);
    }
  }
  return {
    markedOn: [...marked],
    sequence,
    pulledIn: sequence.filter((id) => !marked.has(id)),
  };
}
