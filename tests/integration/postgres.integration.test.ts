import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgresAdapter } from '../../src/adapters/postgres.js';
import { listTablesHandler } from '../../src/tools/list-tables.js';
import { describeTableHandler } from '../../src/tools/describe-table.js';
import { executeQueryHandler } from '../../src/tools/execute-query.js';
import type { Config } from '../../src/config.js';
import { ToolError } from '../../src/errors.js';

const runContainers = process.env.TEST_INTEGRATION === '1';
const url = 'postgres://dbward:dbward@localhost:15432/dbward_test';

const cfg: Config = {
  dbType: 'postgres',
  dbUrl: url,
  allowlist: { type: 'list', tables: new Set(['dbward_users']) },
  maxRows: 1000,
  queryTimeoutMs: 15000,
  readOnly: false,
};

describe.skipIf(!runContainers)('postgres integration (container)', () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(url, 15000);
    try {
      await adapter.connect();
    } catch (err) {
      throw new Error(
        `Could not connect to Postgres at ${url}. ` +
          `Did you run \`docker compose up -d\` and wait for the service to be healthy? ` +
          `Underlying error: ${(err as Error).message}`
      );
    }
  });

  afterAll(async () => {
    await adapter?.close();
  });

  beforeEach(async () => {
    await adapter.execute({ kind: 'sql', sql: 'DROP TABLE IF EXISTS dbward_users' });
    await adapter.execute({ kind: 'sql', sql: 'DROP TABLE IF EXISTS dbward_secrets' });
    await adapter.execute({
      kind: 'sql',
      sql: 'CREATE TABLE dbward_users (id INT, name TEXT)',
    });
    await adapter.execute({
      kind: 'sql',
      sql: 'CREATE TABLE dbward_secrets (id INT)',
    });
    await adapter.execute({
      kind: 'sql',
      sql: "INSERT INTO dbward_users (id, name) VALUES (1, 'alice'), (2, 'bob')",
    });
  });

  it('list_tables filters by allowlist', async () => {
    const r = await listTablesHandler(adapter, cfg);
    expect(r.tables).toContain('dbward_users');
    expect(r.tables).not.toContain('dbward_secrets');
  });

  it('describe_table works for allowed table', async () => {
    const r = await describeTableHandler(adapter, cfg, { table: 'dbward_users' });
    const names = r.columns.map((c) => c.name.toLowerCase());
    expect(names).toContain('id');
    expect(names).toContain('name');
  });

  it('describe_table rejects disallowed table', async () => {
    await expect(
      describeTableHandler(adapter, cfg, { table: 'dbward_secrets' })
    ).rejects.toThrow(ToolError);
  });

  it('execute_query allowed SELECT returns rows', async () => {
    const r = await executeQueryHandler(adapter, cfg, {
      sql: 'SELECT * FROM dbward_users',
    });
    expect(r.rows).toHaveLength(2);
  });

  it('execute_query rejects JOIN to disallowed table', async () => {
    await expect(
      executeQueryHandler(adapter, cfg, {
        sql: 'SELECT * FROM dbward_users JOIN dbward_secrets ON 1=1',
      })
    ).rejects.toThrow(ToolError);
  });
});
