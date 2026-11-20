import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_SCREENS } from '../src/columns';
import { moduleAvailability, moduleBySlug, moduleIndex } from '../src/module-index';
import { MODULE_IDS, MODULES } from '../src/modules';

describe('module index', () => {
  const index = moduleIndex();

  it('lists every blueprint module once, with a client name and no codes', () => {
    expect(index).toHaveLength(36);
    expect(index.map((entry) => entry.id)).toEqual([...MODULE_IDS]);
    expect(new Set(index.map((entry) => entry.slug)).size).toBe(36);
    for (const entry of index) {
      expect(entry.name).not.toMatch(/[A-Z]{3}-\d{2}/);
      expect(`${entry.area} ${entry.name} ${entry.summary}`).not.toMatch(
        /kernel|rbac|blueprint|tier|add-on/i,
      );
      expect(entry.summary).not.toMatch(/stub|TODO|beta|prototype|lorem/i);
      expect(entry.summary.endsWith('.')).toBe(true);
    }
    expect(index.some((entry) => entry.area === 'Company')).toBe(true);
  });

  it('lights up only modules that have a screen', () => {
    const built = new Set(BUILT_SCREENS.map((screen) => screen.moduleId));
    for (const entry of index) {
      expect(entry.built).toBe(built.has(entry.id));
      if (entry.built) {
        expect(entry.href.startsWith('/modules/')).toBe(false);
      } else {
        expect(entry.href).toBe(`/modules/${entry.slug}`);
      }
    }
  });

  it('follows the company switches', () => {
    const stock = moduleBySlug('stock');
    const quotes = moduleBySlug('quotes');
    expect(stock && moduleAvailability(stock, ['SCM-01'])).toBe('ready');
    expect(stock && moduleAvailability(stock, [])).toBe('locked');
    expect(quotes && moduleAvailability(quotes, ['SAL-01'])).toBe('ready');
    const invoices = moduleBySlug('invoices');
    expect(invoices && moduleAvailability(invoices, ['FIN-02'])).toBe('ready');
    expect(invoices?.area).toBe('Sales');
  });

  it('matches the blueprint and the roadmap ids', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const blueprint = readFileSync(
      resolve(root, 'docs/blueprint/Modular_ERP_Operations_Map_v7.md'),
      'utf8',
    );
    const roadmap = JSON.parse(
      readFileSync(resolve(root, 'docs/progress/roadmap.json'), 'utf8'),
    ) as { items: { id: string; moduleId?: string }[] };
    for (const module of MODULES) {
      expect(blueprint).toContain(module.id);
    }
    const known = new Set<string>(MODULE_IDS);
    for (const item of roadmap.items) {
      if (known.has(item.id)) {
        expect(index.some((entry) => entry.id === item.id)).toBe(true);
      }
      if (item.moduleId) {
        expect(known.has(item.moduleId)).toBe(true);
      }
    }
  });
});
