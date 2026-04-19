import type { Config } from '../config.js';
import type { DbAdapter } from './types.js';

export async function createAdapter(config: Config): Promise<DbAdapter> {
  switch (config.dbType) {
    case 'sqlite': {
      const { SqliteAdapter } = await import('./sqlite.js');
      return new SqliteAdapter(config.dbUrl);
    }
    case 'postgres': {
      const { PostgresAdapter } = await import('./postgres.js');
      return new PostgresAdapter(config.dbUrl, config.queryTimeoutMs);
    }
    case 'mysql': {
      const { MysqlAdapter } = await import('./mysql.js');
      return new MysqlAdapter(config.dbUrl, config.queryTimeoutMs);
    }
    default:
      throw new Error(`Adapter not yet implemented: ${config.dbType}`);
  }
}
