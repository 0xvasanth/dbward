import { describe, it, expect } from 'vitest';
import { describeTableHandler } from '../../src/tools/describe-table.js';
import type { DbAdapter, ColumnInfo } from '../../src/adapters/types.js';
import type { Config } from '../../src/config.js';
import { ToolError } from '../../src/errors.js';

const cols: ColumnInfo[] = [
  { name: 'id', type: 'INTEGER', nullable: false },
  { name: 'name', type: 'TEXT', nullable: false },
];

const mockAdapter: DbAdapter = {
  connect: async () => {},
  close: async () => {},
  listTables: async () => [],
  describeTable: async () => cols,
  execute: async () => ({}),
};

const cfg: Config = {
  dbType: 'sqlite',
  dbUrl: ':memory:',
  allowlist: { type: 'list', tables: new Set(['users']) },
  maxRows: 1000,
  queryTimeoutMs: 30000,
  readOnly: false,
};

describe('describeTableHandler', () => {
  it('returns columns for allowed table', async () => {
    const r = await describeTableHandler(mockAdapter, cfg, { table: 'users' });
    expect(r.columns).toEqual(cols);
  });

  it('rejects disallowed table before calling adapter', async () => {
    let called = false;
    const spy: DbAdapter = {
      ...mockAdapter,
      describeTable: async () => {
        called = true;
        return cols;
      },
    };
    await expect(
      describeTableHandler(spy, cfg, { table: 'secrets' })
    ).rejects.toThrow(ToolError);
    expect(called).toBe(false);
  });
});
