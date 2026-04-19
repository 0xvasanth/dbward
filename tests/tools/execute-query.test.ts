import { describe, it, expect } from 'vitest';
import { executeQueryHandler } from '../../src/tools/execute-query.js';
import type { DbAdapter } from '../../src/adapters/types.js';
import type { Config } from '../../src/config.js';
import { ToolError } from '../../src/errors.js';

const makeAdapter = (result: Record<string, unknown>): DbAdapter => ({
  connect: async () => {},
  close: async () => {},
  listTables: async () => [],
  describeTable: async () => [],
  execute: async () => result,
});

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    dbType: 'sqlite',
    dbUrl: ':memory:',
    allowlist: { type: 'list', tables: new Set(['users', 'orders']) },
    maxRows: 1000,
    queryTimeoutMs: 30000,
    readOnly: false,
    ...overrides,
  };
}

describe('executeQueryHandler (SQL)', () => {
  it('runs allowed SELECT', async () => {
    const adapter = makeAdapter({ rows: [{ id: 1 }] });
    const r = await executeQueryHandler(adapter, cfg(), {
      sql: 'SELECT * FROM users',
    });
    expect(r.rows).toEqual([{ id: 1 }]);
    expect(r.truncated).toBe(false);
    expect(r.returned).toBe(1);
  });

  it('truncates to maxRows', async () => {
    const adapter = makeAdapter({ rows: [{ x: 1 }, { x: 2 }, { x: 3 }] });
    const r = await executeQueryHandler(adapter, cfg({ maxRows: 2 }), {
      sql: 'SELECT * FROM users',
    });
    expect(r.rows).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.returned).toBe(2);
  });

  it('rejects disallowed table before calling adapter', async () => {
    let called = false;
    const adapter: DbAdapter = {
      connect: async () => {},
      close: async () => {},
      listTables: async () => [],
      describeTable: async () => [],
      execute: async () => {
        called = true;
        return {};
      },
    };
    await expect(
      executeQueryHandler(adapter, cfg(), { sql: 'SELECT * FROM secrets' }),
    ).rejects.toThrow(ToolError);
    expect(called).toBe(false);
  });

  it('returns rowsAffected for INSERT', async () => {
    const adapter = makeAdapter({ rowsAffected: 1 });
    const r = await executeQueryHandler(adapter, cfg(), {
      sql: "INSERT INTO users (name) VALUES ('x')",
    });
    expect(r.rowsAffected).toBe(1);
  });

  it('rejects INSERT in READ_ONLY mode', async () => {
    const adapter = makeAdapter({});
    await expect(
      executeQueryHandler(adapter, cfg({ readOnly: true }), {
        sql: "INSERT INTO users (name) VALUES ('x')",
      }),
    ).rejects.toThrow(ToolError);
  });
});
