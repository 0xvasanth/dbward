import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/adapters/sqlite.js';
import { listTablesHandler } from '../../src/tools/list-tables.js';
import { describeTableHandler } from '../../src/tools/describe-table.js';
import { executeQueryHandler } from '../../src/tools/execute-query.js';
import type { Config } from '../../src/config.js';
import { ToolError } from '../../src/errors.js';

const cfg: Config = {
  dbType: 'sqlite',
  dbUrl: ':memory:',
  allowlist: { type: 'list', tables: new Set(['users']) },
  maxRows: 1000,
  queryTimeoutMs: 30000,
  readOnly: false,
};

describe('sqlite end-to-end tool pipeline', () => {
  let a: SqliteAdapter;

  beforeEach(async () => {
    a = new SqliteAdapter(':memory:');
    await a.connect();
    await a.execute({ kind: 'sql', sql: 'CREATE TABLE users (id INT, name TEXT)' });
    await a.execute({ kind: 'sql', sql: 'CREATE TABLE secrets (id INT)' });
    await a.execute({
      kind: 'sql',
      sql: "INSERT INTO users (id, name) VALUES (1, 'a'), (2, 'b')",
    });
  });

  afterEach(() => a.close());

  it('list_tables filters by allowlist', async () => {
    expect(await listTablesHandler(a, cfg)).toEqual({ tables: ['users'] });
  });

  it('describe_table works for allowed table', async () => {
    const r = await describeTableHandler(a, cfg, { table: 'users' });
    expect(r.columns.map((c) => c.name)).toEqual(['id', 'name']);
  });

  it('describe_table rejects disallowed', async () => {
    await expect(describeTableHandler(a, cfg, { table: 'secrets' })).rejects.toThrow(ToolError);
  });

  it('execute_query allowed SELECT', async () => {
    const r = await executeQueryHandler(a, cfg, { sql: 'SELECT * FROM users' });
    expect(r.rows).toHaveLength(2);
  });

  it('execute_query rejects JOIN to disallowed table', async () => {
    await expect(
      executeQueryHandler(a, cfg, {
        sql: 'SELECT * FROM users JOIN secrets ON 1=1',
      }),
    ).rejects.toThrow(ToolError);
  });
});
