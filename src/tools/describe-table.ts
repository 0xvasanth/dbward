import type { DbAdapter, ColumnInfo } from '../adapters/types.js';
import type { Config } from '../config.js';
import { isAllowed } from '../allowlist.js';
import { ToolError } from '../errors.js';

export async function describeTableHandler(
  adapter: DbAdapter,
  config: Config,
  input: { table: string },
): Promise<{ columns: ColumnInfo[] }> {
  const mode = config.dbType === 'mongodb' ? 'mongo' : 'sql';
  if (!isAllowed(config.allowlist, input.table, mode)) {
    throw new ToolError(`Table '${input.table}' is not in ALLOWED_TABLES`);
  }
  const columns = await adapter.describeTable(input.table);
  return { columns };
}
