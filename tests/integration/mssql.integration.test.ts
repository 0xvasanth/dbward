import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MssqlAdapter } from '../../src/adapters/mssql.js';
import { listTablesHandler } from '../../src/tools/list-tables.js';
import { describeTableHandler } from '../../src/tools/describe-table.js';
import { executeQueryHandler } from '../../src/tools/execute-query.js';
import type { Config } from '../../src/config.js';
import { ToolError } from '../../src/errors.js';

const runContainers = process.env.TEST_INTEGRATION === '1';
// MSSQL Developer edition uses a self-signed cert, so we must
// TrustServerCertificate. The adapter accepts the standard tedious-style
// connection string directly.
const url =
  'Server=localhost,11433;User Id=sa;Password=Dbward_Test_123!;Database=master;Encrypt=true;TrustServerCertificate=true';

const cfg: Config = {
  dbType: 'mssql',
  dbUrl: url,
  allowlist: { type: 'list', tables: new Set(['dbward_users']) },
  maxRows: 1000,
  queryTimeoutMs: 15000,
  readOnly: false,
};

describe.skipIf(!runContainers)('mssql integration (container)', () => {
  let adapter: MssqlAdapter;

  beforeAll(async () => {
    adapter = new MssqlAdapter(url, 15000);
    try {
      await adapter.connect();
    } catch (err) {
      throw new Error(
        `Could not connect to MSSQL at localhost:11433. ` +
          `Did you run \`docker compose up -d\` and wait for the service to be healthy? ` +
          `Underlying error: ${(err as Error).message}`
      );
    }
  });

  afterAll(async () => {
    await adapter?.close();
  });

  beforeEach(async () => {
    // MSSQL 2016+ supports DROP TABLE IF EXISTS. Values are inlined in the
    // seed INSERT since execute-query enforces @p0-style positional params.
    await adapter.execute({ kind: 'sql', sql: 'DROP TABLE IF EXISTS dbward_users' });
    await adapter.execute({ kind: 'sql', sql: 'DROP TABLE IF EXISTS dbward_secrets' });
    await adapter.execute({
      kind: 'sql',
      sql: 'CREATE TABLE dbward_users (id INT, name NVARCHAR(255))',
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
