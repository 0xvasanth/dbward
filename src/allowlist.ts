import type { Allowlist } from './config.js';

export type AllowlistMode = 'sql' | 'mongo';

export function isAllowed(
  allowlist: Allowlist,
  name: string,
  mode: AllowlistMode
): boolean {
  if (allowlist.type === 'wildcard') return true;
  const normalized = mode === 'sql' ? name.toLowerCase() : name;
  return allowlist.tables.has(normalized);
}
