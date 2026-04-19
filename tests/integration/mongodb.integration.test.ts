import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoAdapter } from '../../src/adapters/mongodb.js';
import { listTablesHandler } from '../../src/tools/list-tables.js';
import { describeTableHandler } from '../../src/tools/describe-table.js';
import { executeQueryHandler } from '../../src/tools/execute-query.js';
import type { Config } from '../../src/config.js';
import { ToolError } from '../../src/errors.js';

const runContainers = process.env.TEST_INTEGRATION === '1';
const url = 'mongodb://dbward:dbward@localhost:37017/dbward_test?authSource=admin';

const cfg: Config = {
  dbType: 'mongodb',
  dbUrl: url,
  allowlist: { type: 'list', tables: new Set(['dbward_users']) },
  maxRows: 1000,
  queryTimeoutMs: 15000,
  readOnly: false,
};

describe.skipIf(!runContainers)('mongodb integration (container)', () => {
  let adapter: MongoAdapter;
  let rawClient: MongoClient;

  beforeAll(async () => {
    adapter = new MongoAdapter(url, 15000);
    rawClient = new MongoClient(url, { serverSelectionTimeoutMS: 15000 });
    try {
      await adapter.connect();
      await rawClient.connect();
    } catch (err) {
      throw new Error(
        `Could not connect to MongoDB at ${url}. ` +
          `Did you run \`docker compose up -d\` and wait for the service to be healthy? ` +
          `Underlying error: ${(err as Error).message}`,
      );
    }
  });

  afterAll(async () => {
    await adapter?.close();
    await rawClient?.close();
  });

  beforeEach(async () => {
    // Seed via the driver directly — cleaner than round-tripping through the
    // adapter (which requires the write op to pass the allowlist check).
    const db = rawClient.db();
    await db.collection('dbward_users').deleteMany({});
    await db.collection('dbward_secrets').deleteMany({});
    await db.collection('dbward_users').insertMany([
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ]);
    await db.collection('dbward_secrets').insertOne({ id: 1 });
  });

  it('list_tables filters by allowlist', async () => {
    const r = await listTablesHandler(adapter, cfg);
    expect(r.tables).toContain('dbward_users');
    expect(r.tables).not.toContain('dbward_secrets');
  });

  it('describe_table works for allowed table', async () => {
    const r = await describeTableHandler(adapter, cfg, { table: 'dbward_users' });
    // Mongo schema is inferred from sampling up to 20 docs — we just need
    // to see the fields we inserted.
    const names = r.columns.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('name');
  });

  it('describe_table rejects disallowed table', async () => {
    await expect(describeTableHandler(adapter, cfg, { table: 'dbward_secrets' })).rejects.toThrow(
      ToolError,
    );
  });

  it('execute_query allowed find returns rows', async () => {
    const r = await executeQueryHandler(adapter, cfg, {
      collection: 'dbward_users',
      operation: 'find',
      filter: {},
    });
    expect(r.rows).toHaveLength(2);
  });

  it('execute_query rejects disallowed collection', async () => {
    await expect(
      executeQueryHandler(adapter, cfg, {
        collection: 'dbward_secrets',
        operation: 'find',
        filter: {},
      }),
    ).rejects.toThrow(ToolError);
  });
});
