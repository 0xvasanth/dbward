import { describe, it, expect } from 'vitest';
import { listTablesHandler } from '../../src/tools/list-tables.js';
import type { DbAdapter } from '../../src/adapters/types.js';
import type { Config } from '../../src/config.js';

const mockAdapter = (tables: string[]): DbAdapter => ({
  connect: async () => {},
  close: async () => {},
  listTables: async () => tables,
  describeTable: async () => [],
  execute: async () => ({}),
});

const baseCfg: Config = {
  dbType: 'sqlite',
  dbUrl: ':memory:',
  allowlist: { type: 'list', tables: new Set(['users', 'orders']) },
  maxRows: 1000,
  queryTimeoutMs: 30000,
  readOnly: false,
};

describe('listTablesHandler', () => {
  it('filters to allowlist for sql', async () => {
    const result = await listTablesHandler(mockAdapter(['users', 'secrets', 'orders']), baseCfg);
    expect(result.tables.sort()).toEqual(['orders', 'users']);
  });

  it('wildcard returns all', async () => {
    const result = await listTablesHandler(mockAdapter(['users', 'secrets', 'orders']), {
      ...baseCfg,
      allowlist: { type: 'wildcard' },
    });
    expect(result.tables.sort()).toEqual(['orders', 'secrets', 'users']);
  });

  it('mongo filters case-sensitively', async () => {
    const result = await listTablesHandler(mockAdapter(['Users', 'users', 'Orders']), {
      ...baseCfg,
      dbType: 'mongodb',
      allowlist: { type: 'list', tables: new Set(['Users']) },
    });
    expect(result.tables).toEqual(['Users']);
  });
});
