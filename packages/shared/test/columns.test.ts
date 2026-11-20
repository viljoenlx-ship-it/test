import { describe, expect, it } from 'vitest';
import {
  columnLayoutError,
  defaultColumnLayouts,
  orderColumns,
  parseColumnLayouts,
  screensForModules,
} from '../src/columns';

describe('column layouts', () => {
  it('uses every column until a client saves a shorter list', () => {
    expect(parseColumnLayouts(undefined).stock).toEqual(defaultColumnLayouts().stock);
    expect(parseColumnLayouts({ stock: ['price', 'name', 'name', 'nope'] }).stock).toEqual([
      'price',
      'name',
    ]);
  });

  it('refuses a list with no columns', () => {
    expect(columnLayoutError({ contacts: [] })).toBe('Contacts needs at least one column.');
    expect(columnLayoutError({ stock: ['name'] })).toBeNull();
  });

  it('orders only columns the screen is allowed to show', () => {
    const columns = [
      { key: 'name', header: 'Item' },
      { key: 'code', header: 'Code' },
      { key: 'price', header: 'Selling price' },
    ];
    expect(orderColumns(columns, ['price', 'name']).map((column) => column.key)).toEqual([
      'price',
      'name',
    ]);
  });

  it('hides modules that are not built or not switched on', () => {
    const labels = screensForModules(['KRN-01', 'SAL-03', 'SCM-01']).map((screen) => screen.label);
    expect(labels).toEqual(['People', 'Stock']);
    expect(screensForModules(['KRN-04']).map((screen) => screen.path)).toEqual([
      '/settings/pipelines',
    ]);
  });
});
