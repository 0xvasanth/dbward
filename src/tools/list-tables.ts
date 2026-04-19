import type { DbAdapter } from '../adapters/types.js';
import type { Config } from '../config.js';
import { isAllowed } from '../allowlist.js';

export async function listTablesHandler(
  adapter: DbAdapter,
  config: Config
): Promise<{ tables: string[] }> {
  const all = await adapter.listTables();
  const mode = config.dbType === 'mongodb' ? 'mongo' : 'sql';
  const filtered = all.filter((t) => isAllowed(config.allowlist, t, mode));
  return { tables: filtered };
}
