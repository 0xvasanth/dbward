import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SqliteAdapter } from '../src/adapters/sqlite.js';
import { connectServer } from '../src/server.js';
import type { Config } from '../src/config.js';
import type { DbAdapter } from '../src/adapters/types.js';

const baseCfg: Config = {
  dbType: 'sqlite',
  dbUrl: ':memory:',
  allowlist: { type: 'wildcard' },
  maxRows: 1000,
  queryTimeoutMs: 30000,
  readOnly: false,
};

describe('MCP server integration', () => {
  let adapter: DbAdapter;
  let client: Client;

  beforeEach(async () => {
    adapter = new SqliteAdapter(':memory:');
    await adapter.connect();
    await adapter.execute({
      kind: 'sql',
      sql: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
    });
    await adapter.execute({
      kind: 'sql',
      sql: `INSERT INTO users (id, name) VALUES (1, 'alice'), (2, 'bob')`,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await connectServer(adapter, baseCfg, serverTransport);

    client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await adapter.close();
  });

  it('lists all three tools', async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name).sort();
    expect(names).toEqual(['describe_table', 'execute_query', 'list_tables']);
  });

  it('calls list_tables and returns seeded tables', async () => {
    const res = await client.callTool({ name: 'list_tables', arguments: {} });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toEqual({ tables: ['users'] });
  });

  it('calls describe_table and returns column info', async () => {
    const res = await client.callTool({
      name: 'describe_table',
      arguments: { table: 'users' },
    });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.columns.map((c: { name: string }) => c.name)).toEqual(['id', 'name']);
  });

  it('calls execute_query and returns rows', async () => {
    const res = await client.callTool({
      name: 'execute_query',
      arguments: { sql: 'SELECT id, name FROM users ORDER BY id' },
    });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.rows).toEqual([
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ]);
  });

  it('returns isError for unknown tool', async () => {
    const res = await client.callTool({ name: 'no_such_tool', arguments: {} });
    expect(res.isError).toBe(true);
  });

  it('returns isError for allowlist violation', async () => {
    const cfg: Config = {
      ...baseCfg,
      allowlist: { type: 'list', tables: new Set(['users']) },
    };
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const secondAdapter = new SqliteAdapter(':memory:');
    await secondAdapter.connect();
    await secondAdapter.execute({
      kind: 'sql',
      sql: `CREATE TABLE secrets (id INTEGER)`,
    });
    await connectServer(secondAdapter, cfg, st);
    const c2 = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
    await c2.connect(ct);
    try {
      const res = await c2.callTool({
        name: 'describe_table',
        arguments: { table: 'secrets' },
      });
      expect(res.isError).toBe(true);
      const content = res.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toMatch(/not in ALLOWED_TABLES/);
    } finally {
      await c2.close();
      await secondAdapter.close();
    }
  });
});
