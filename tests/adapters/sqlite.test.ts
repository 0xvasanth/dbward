import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/adapters/sqlite.js';
import type { DbAdapter } from '../../src/adapters/types.js';

describe('SqliteAdapter', () => {
  let adapter: DbAdapter;

  beforeEach(async () => {
    adapter = new SqliteAdapter(':memory:');
    await adapter.connect();
    await adapter.execute({
      kind: 'sql',
      sql: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT)`,
    });
    await adapter.execute({
      kind: 'sql',
      sql: `INSERT INTO users (id, name) VALUES (1, 'alice'), (2, 'bob')`,
    });
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('listTables returns created tables', async () => {
    expect(await adapter.listTables()).toEqual(['users']);
  });

  it('describeTable returns columns', async () => {
    const cols = await adapter.describeTable('users');
    expect(cols.map((c) => c.name)).toEqual(['id', 'name', 'created_at']);
    const nameCol = cols.find((c) => c.name === 'name')!;
    expect(nameCol.nullable).toBe(false);
  });

  it('execute SELECT returns rows', async () => {
    const result = await adapter.execute({
      kind: 'sql',
      sql: 'SELECT id, name FROM users ORDER BY id',
    });
    expect(result.rows).toEqual([
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ]);
  });

  it('execute INSERT returns rowsAffected', async () => {
    const result = await adapter.execute({
      kind: 'sql',
      sql: "INSERT INTO users (id, name) VALUES (3, 'carol')",
    });
    expect(result.rowsAffected).toBe(1);
  });

  it('execute with params', async () => {
    const result = await adapter.execute({
      kind: 'sql',
      sql: 'SELECT name FROM users WHERE id = ?',
      params: [1],
    });
    expect(result.rows).toEqual([{ name: 'alice' }]);
  });
});
