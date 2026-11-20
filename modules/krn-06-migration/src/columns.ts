import type { ImportField } from './target';

export function normaliseHeader(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Match file headers to fields. A remembered match wins, then the field name,
 * its label, and its aliases. Each field is used at most once.
 */
export function matchColumns(
  headers: string[],
  fields: readonly ImportField[],
  saved: ReadonlyMap<string, string>,
): Record<string, string | null> {
  const known = new Map<string, string>();
  for (const field of fields) {
    for (const alias of [field.key, field.label, ...field.aliases]) {
      const key = normaliseHeader(alias);
      if (key && !known.has(key)) {
        known.set(key, field.key);
      }
    }
  }

  const used = new Set<string>();
  const map: Record<string, string | null> = {};

  for (const header of headers) {
    const remembered = saved.get(normaliseHeader(header));
    if (remembered && fields.some((field) => field.key === remembered) && !used.has(remembered)) {
      map[header] = remembered;
      used.add(remembered);
    }
  }

  for (const header of headers) {
    if (map[header]) {
      continue;
    }
    const key = known.get(normaliseHeader(header));
    if (key && !used.has(key)) {
      map[header] = key;
      used.add(key);
    } else {
      map[header] = null;
    }
  }

  return map;
}

export function unmappedRequired(
  fields: readonly ImportField[],
  columnMap: Record<string, string | null>,
): ImportField[] {
  const mapped = new Set(Object.values(columnMap).filter((key): key is string => key !== null));
  return fields.filter((field) => field.required && !mapped.has(field.key));
}
