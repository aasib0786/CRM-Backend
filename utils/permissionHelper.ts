/**
 * permissionHelpers.ts
 *
 * Replaces the old flattenOverrides / buildOverridesFromPermissions helpers
 * that worked with flat permission_key strings (e.g. "SALES_INVOICE_VIEW").
 *
 * The backend now stores permissions as jsonb blobs identical to the roles table:
 *   { sales_invoice: { view: true, create: false, ... }, ... }
 *
 * These helpers convert between the frontend's permissionOverrides shape
 * and the jsonb shape expected by the API.
 */

import type { ModuleKey, ModuleAction } from '@/types/shared';

type OverridesMap = Partial<Record<ModuleKey, Partial<Record<ModuleAction, boolean>>>>;
type JsonbPermissions = Record<string, Record<string, boolean>>;

/**
 * Convert frontend permissionOverrides → jsonb permissions object.
 *
 * permissionOverrides only contains entries the user explicitly changed.
 * We send these directly — the backend merges them on top of role defaults.
 *
 * Before: flattenOverrides(overrides) → ["SALES_INVOICE_VIEW", ...]
 * After:  overridesToJsonb(overrides) → { sales_invoice: { view: true }, ... }
 */
export const overridesToJsonb = (
  overrides: OverridesMap,
): JsonbPermissions => {
  const result: JsonbPermissions = {};
  for (const [moduleKey, actionMap] of Object.entries(overrides)) {
    if (!actionMap) continue;
    result[moduleKey] = {};
    for (const [action, val] of Object.entries(actionMap)) {
      result[moduleKey][action] = Boolean(val);
    }
  }
  return result;
};

/**
 * Convert jsonb permissions object → frontend permissionOverrides shape.
 *
 * Used when loading an existing user for editing — we receive the full
 * merged snapshot from user_permissions and need to show it in the matrix.
 *
 * Before: buildOverridesFromPermissions(permissions: string[]) → OverridesMap
 * After:  jsonbToOverrides(permissions: JsonbPermissions)      → OverridesMap
 */
export const jsonbToOverrides = (
  permissions: JsonbPermissions | Record<string, unknown> | undefined | null,
): OverridesMap => {
  if (!permissions || typeof permissions !== 'object') return {};
  const overrides: OverridesMap = {};
  for (const [moduleKey, actionMap] of Object.entries(permissions)) {
    if (!actionMap || typeof actionMap !== 'object') continue;
    overrides[moduleKey as ModuleKey] = {};
    for (const [action, val] of Object.entries(actionMap as Record<string, unknown>)) {
      if (['view', 'create', 'edit', 'delete'].includes(action)) {
        (overrides[moduleKey as ModuleKey] as Record<string, boolean>)[action] = Boolean(val);
      }
    }
  }
  return overrides;
};