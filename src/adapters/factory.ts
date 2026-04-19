import type { Config } from '../config.js';
import type { DbAdapter } from './types.js';

export async function createAdapter(config: Config): Promise<DbAdapter> {
  switch (config.dbType) {
    case 'sqlite': {
      const { SqliteAdapter } = await import('./sqlite.js');
      return new SqliteAdapter(config.dbUrl);
    }
    default:
      throw new Error(`Adapter not yet implemented: ${config.dbType}`);
  }
}
