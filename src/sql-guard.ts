import type { Config } from './config.js';
import { isAllowed } from './allowlist.js';
import { extractTables, getStatementTypes, type SqlDbType } from './sql-parse.js';

export type GuardResult = { ok: true } | { ok: false; reason: string };

const WRITE_TYPES = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'create',
  'alter',
  'drop',
  'truncate',
  'rename',
  'grant',
  'revoke',
]);

export function checkSqlAllowed(sql: string, config: Config): GuardResult {
  const dbType = config.dbType as SqlDbType;

  let tables: string[];
  let types: string[];
  try {
    tables = extractTables(sql, dbType);
    types = getStatementTypes(sql, dbType);
  } catch (err) {
    return { ok: false, reason: `Query could not be parsed: ${(err as Error).message}` };
  }

  if (config.readOnly) {
    const writes = types.filter((t) => WRITE_TYPES.has(t));
    if (writes.length > 0) {
      return {
        ok: false,
        reason: `READ_ONLY mode: statement type '${writes[0]}' is not allowed`,
      };
    }
  }

  for (const table of tables) {
    if (!isAllowed(config.allowlist, table, 'sql')) {
      return {
        ok: false,
        reason: `Table '${table}' is not in ALLOWED_TABLES`,
      };
    }
  }

  return { ok: true };
}
