export const FIELD_MASK = '••••';

/**
 * Hides fields when the caller does not hold the exact permission.
 * Admin does not unlock a field by itself. The caller passes the key that may see it.
 */
export function maskFields<T extends Record<string, unknown>>(
  record: T,
  fields: readonly (keyof T)[],
  permissions: ReadonlySet<string>,
  requiredPermission: string,
): T {
  if (permissions.has(requiredPermission)) {
    return { ...record };
  }

  const masked = { ...record };
  for (const field of fields) {
    const value = masked[field];
    if (value !== null && value !== undefined && value !== '') {
      (masked as Record<string, unknown>)[field as string] = FIELD_MASK;
    }
  }
  return masked;
}
