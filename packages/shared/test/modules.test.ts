import { describe, expect, it } from 'vitest';
import {
  activationClosure,
  activationOrder,
  assertCanActivate,
  assertCanDeactivate,
  getModule,
  MODULE_IDS,
  MODULES,
  prerequisitesMissing,
} from '../src/modules';

const expectedIds = [
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
  'SAL-03',
  'SAL-04',
  'SAL-05',
  'SCM-01',
  'SCM-02',
  'SCM-03',
  'SCM-04',
  'OPS-01',
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
];

describe('module catalog', () => {
  it('lists the 36 blueprint modules once', () => {
    expect(MODULES).toHaveLength(36);
    expect([...MODULE_IDS]).toEqual(expectedIds);
    expect(new Set(MODULES.map((module) => module.id)).size).toBe(36);
  });

  it('orders every module after its hard prerequisites', () => {
    const order = activationOrder();
    expect(order[0]).toBe('KRN-01');
    expect(order).toHaveLength(36);

    const position = new Map(order.map((id, index) => [id, index]));
    for (const module of MODULES) {
      for (const prerequisite of module.prerequisites) {
        expect(position.get(prerequisite)).toBeLessThan(position.get(module.id) ?? -1);
      }
    }
  });

  it('keeps KRN-01 mandatory and blocks dependants from being removed first', () => {
    expect(getModule('KRN-01').canDisable).toBe(false);
    expect(() => assertCanDeactivate(new Set(), 'KRN-01')).toThrow(/cannot be disabled/);

    const active = new Set(activationClosure('FIN-02'));
    expect(prerequisitesMissing(new Set(), 'FIN-01')).toEqual(['KRN-01', 'KRN-03']);
    expect(() => assertCanDeactivate(active, 'FIN-01')).toThrow(/FIN-02/);
    expect(() =>
      assertCanActivate(new Set(['KRN-01', 'KRN-03', 'FIN-01']), 'FIN-06'),
    ).not.toThrow();
  });

  it('pulls the full prerequisite chain when point of sale is switched on', () => {
    const closure = activationClosure('SAL-03');
    expect(closure.at(-1)).toBe('SAL-03');
    expect(new Set(closure)).toEqual(
      new Set([
        'KRN-01',
        'KRN-02',
        'KRN-03',
        'FIN-01',
        'FIN-02',
        'FIN-04',
        'FIN-05',
        'SCM-01',
        'SAL-03',
      ]),
    );
    expect(() => assertCanActivate(new Set(closure.slice(0, -1)), 'SAL-03')).not.toThrow();
  });
});
