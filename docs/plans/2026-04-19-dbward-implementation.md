# dbward Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `dbward`, a TypeScript MCP server that exposes a single database connection (Postgres / MySQL / SQLite / MSSQL / MongoDB) to an agent with table-level allowlist enforcement.

**Architecture:** Single stdio MCP server. Engine selected at boot from `DB_TYPE`. Three tools: `list_tables`, `describe_table`, `execute_query`. SQL queries parsed with `node-sql-parser` and every referenced table checked against an env-configured allowlist before the driver runs them. Mongo uses a required `collection` arg checked directly.

**Tech Stack:** Node 20+, TypeScript, `@modelcontextprotocol/sdk`, `node-sql-parser`, `zod`, `vitest`, drivers `pg` / `mysql2` / `better-sqlite3` / `mssql` / `mongodb`.

**Design doc:** `docs/plans/2026-04-19-dbward-design.md`

---

## Build order rationale

1. Foundation first — scaffolding, config, allowlist primitives. No engine dependencies.
2. **SQLite first** as the reference adapter. It runs in-memory, needs no containers, and lets us prove the full tool pipeline before replicating across engines.
3. Wire one MCP server end-to-end with SQLite.
4. Add Postgres, MySQL, MSSQL — same adapter interface, same test shape.
5. Add Mongo last because it diverges from the SQL code path.
6. Polish: timeout, README, distribution.

TDD throughout. Frequent commits — after every task.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts` (stub)
- Create: `vitest.config.ts`

**Step 1: Initialize git and npm**

```bash
cd /Users/itsparser/Developer/dbmcp
git init
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk zod node-sql-parser
npm install --save-dev typescript @types/node vitest tsx
```

(Driver deps added in later tasks so install time isn't paid upfront.)

**Step 3: Replace `package.json`**

```json
{
  "name": "dbward",
  "version": "0.1.0",
  "description": "MCP server for any SQL or Mongo database with table-level allowlist enforcement",
  "type": "module",
  "bin": {
    "dbward": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "node-sql-parser": "^5.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

**Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 5: Create `.gitignore`**

```
node_modules
dist
*.log
.env
.DS_Store
coverage
```

**Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

**Step 7: Create `src/index.ts` stub**

```ts
#!/usr/bin/env node
// dbward — MCP server entry point. Wired in Task 16.
console.error('dbward: not yet implemented');
process.exit(1);
```

**Step 8: Verify build works**

```bash
npm run build
npm run typecheck
```

Expected: both succeed with no errors.

**Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold project with TypeScript, vitest, MCP SDK"
```

---

## Task 2: Config schema

Parse and validate env vars at startup.

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

**Step 1: Write failing tests**

```ts
// tests/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('parses required vars for postgres', () => {
    const cfg = loadConfig({
      DB_TYPE: 'postgres',
      DB_URL: 'postgres://localhost/test',
      ALLOWED_TABLES: 'users,orders',
    });
    expect(cfg.dbType).toBe('postgres');
    expect(cfg.dbUrl).toBe('postgres://localhost/test');
    expect(cfg.allowlist).toEqual({ type: 'list', tables: new Set(['users', 'orders']) });
    expect(cfg.maxRows).toBe(1000);
    expect(cfg.queryTimeoutMs).toBe(30000);
    expect(cfg.readOnly).toBe(false);
  });

  it('normalizes wildcard allowlist', () => {
    const cfg = loadConfig({
      DB_TYPE: 'sqlite',
      DB_URL: ':memory:',
      ALLOWED_TABLES: '*',
    });
    expect(cfg.allowlist).toEqual({ type: 'wildcard' });
  });

  it('trims whitespace and lowercases SQL table names', () => {
    const cfg = loadConfig({
      DB_TYPE: 'mysql',
      DB_URL: 'mysql://localhost/test',
      ALLOWED_TABLES: ' Users , Orders ',
    });
    expect(cfg.allowlist).toEqual({
      type: 'list',
      tables: new Set(['users', 'orders']),
    });
  });

  it('preserves case for Mongo collections', () => {
    const cfg = loadConfig({
      DB_TYPE: 'mongodb',
      DB_URL: 'mongodb://localhost/test',
      ALLOWED_TABLES: 'Users,Orders',
    });
    expect(cfg.allowlist).toEqual({
      type: 'list',
      tables: new Set(['Users', 'Orders']),
    });
  });

  it('rejects missing DB_TYPE', () => {
    expect(() => loadConfig({ DB_URL: 'x', ALLOWED_TABLES: '*' })).toThrow();
  });

  it('rejects unknown DB_TYPE', () => {
    expect(() =>
      loadConfig({ DB_TYPE: 'oracle', DB_URL: 'x', ALLOWED_TABLES: '*' })
    ).toThrow();
  });

  it('rejects empty ALLOWED_TABLES', () => {
    expect(() =>
      loadConfig({ DB_TYPE: 'sqlite', DB_URL: ':memory:', ALLOWED_TABLES: '' })
    ).toThrow();
  });

  it('respects MAX_ROWS, QUERY_TIMEOUT_MS, READ_ONLY', () => {
    const cfg = loadConfig({
      DB_TYPE: 'sqlite',
      DB_URL: ':memory:',
      ALLOWED_TABLES: '*',
      MAX_ROWS: '50',
      QUERY_TIMEOUT_MS: '5000',
      READ_ONLY: 'true',
    });
    expect(cfg.maxRows).toBe(50);
    expect(cfg.queryTimeoutMs).toBe(5000);
    expect(cfg.readOnly).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/config.test.ts
```

Expected: all fail ("Cannot find module").

**Step 3: Implement `src/config.ts`**

```ts
import { z } from 'zod';

export type DbType = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'mongodb';

export type Allowlist =
  | { type: 'wildcard' }
  | { type: 'list'; tables: Set<string> };

export interface Config {
  dbType: DbType;
  dbUrl: string;
  allowlist: Allowlist;
  maxRows: number;
  queryTimeoutMs: number;
  readOnly: boolean;
}

const envSchema = z.object({
  DB_TYPE: z.enum(['postgres', 'mysql', 'sqlite', 'mssql', 'mongodb']),
  DB_URL: z.string().min(1),
  ALLOWED_TABLES: z.string().min(1),
  MAX_ROWS: z.string().optional(),
  QUERY_TIMEOUT_MS: z.string().optional(),
  READ_ONLY: z.string().optional(),
});

function parseAllowlist(raw: string, dbType: DbType): Allowlist {
  const trimmed = raw.trim();
  if (trimmed === '*') return { type: 'wildcard' };
  const parts = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error('ALLOWED_TABLES must contain at least one table or "*"');
  }
  const normalize = (s: string) => (dbType === 'mongodb' ? s : s.toLowerCase());
  return { type: 'list', tables: new Set(parts.map(normalize)) };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    dbType: parsed.DB_TYPE,
    dbUrl: parsed.DB_URL,
    allowlist: parseAllowlist(parsed.ALLOWED_TABLES, parsed.DB_TYPE),
    maxRows: parsed.MAX_ROWS ? parseInt(parsed.MAX_ROWS, 10) : 1000,
    queryTimeoutMs: parsed.QUERY_TIMEOUT_MS
      ? parseInt(parsed.QUERY_TIMEOUT_MS, 10)
      : 30000,
    readOnly: parsed.READ_ONLY === 'true',
  };
}
```

**Step 4: Run tests**

```bash
npm test -- tests/config.test.ts
```

Expected: all pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: env config parsing and allowlist normalization"
```

---

## Task 3: Allowlist primitives

Pure functions for checking allowlist membership.

**Files:**
- Create: `src/allowlist.ts`
- Create: `tests/allowlist.test.ts`

**Step 1: Write failing tests**

```ts
// tests/allowlist.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowed } from '../src/allowlist.js';
import type { Allowlist } from '../src/config.js';

describe('isAllowed', () => {
  it('wildcard allows anything', () => {
    const a: Allowlist = { type: 'wildcard' };
    expect(isAllowed(a, 'users', 'sql')).toBe(true);
    expect(isAllowed(a, 'anything', 'sql')).toBe(true);
  });

  it('list matches case-insensitively for sql', () => {
    const a: Allowlist = { type: 'list', tables: new Set(['users', 'orders']) };
    expect(isAllowed(a, 'USERS', 'sql')).toBe(true);
    expect(isAllowed(a, 'Users', 'sql')).toBe(true);
    expect(isAllowed(a, 'secrets', 'sql')).toBe(false);
  });

  it('list matches case-sensitively for mongo', () => {
    const a: Allowlist = { type: 'list', tables: new Set(['Users', 'Orders']) };
    expect(isAllowed(a, 'Users', 'mongo')).toBe(true);
    expect(isAllowed(a, 'users', 'mongo')).toBe(false);
  });
});
```

**Step 2: Run — expect fail**

```bash
npm test -- tests/allowlist.test.ts
```

**Step 3: Implement `src/allowlist.ts`**

```ts
import type { Allowlist } from './config.js';

export type AllowlistMode = 'sql' | 'mongo';

export function isAllowed(
  allowlist: Allowlist,
  name: string,
  mode: AllowlistMode
): boolean {
  if (allowlist.type === 'wildcard') return true;
  const normalized = mode === 'sql' ? name.toLowerCase() : name;
  return allowlist.tables.has(normalized);
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: allowlist isAllowed() primitive"
```

---

## Task 4: SQL table extraction

Parse SQL and pull out every referenced table/view name.

**Files:**
- Create: `src/sql-parse.ts`
- Create: `tests/sql-parse.test.ts`

**Step 1: Write failing tests**

```ts
// tests/sql-parse.test.ts
import { describe, it, expect } from 'vitest';
import { extractTables, getStatementTypes } from '../src/sql-parse.js';

describe('extractTables (postgres dialect)', () => {
  const extract = (sql: string) => extractTables(sql, 'postgres');

  it('simple SELECT', () => {
    expect(extract('SELECT * FROM users')).toEqual(['users']);
  });

  it('JOIN', () => {
    expect(extract('SELECT * FROM users u JOIN orders o ON o.user_id = u.id').sort()).toEqual(['orders', 'users']);
  });

  it('subquery', () => {
    expect(extract('SELECT * FROM (SELECT id FROM users) u').sort()).toEqual(['users']);
  });

  it('CTE', () => {
    expect(
      extract('WITH x AS (SELECT * FROM users) SELECT * FROM x JOIN orders ON orders.id = x.id').sort()
    ).toEqual(expect.arrayContaining(['users', 'orders']));
  });

  it('UNION', () => {
    expect(
      extract('SELECT id FROM users UNION SELECT id FROM orders').sort()
    ).toEqual(['orders', 'users']);
  });

  it('INSERT', () => {
    expect(extract("INSERT INTO users (name) VALUES ('x')")).toEqual(['users']);
  });

  it('UPDATE', () => {
    expect(extract("UPDATE users SET name='x' WHERE id=1")).toEqual(['users']);
  });

  it('DELETE', () => {
    expect(extract('DELETE FROM users WHERE id=1')).toEqual(['users']);
  });

  it('CREATE TABLE', () => {
    expect(extract('CREATE TABLE foo (id INT)')).toEqual(['foo']);
  });

  it('ALTER TABLE', () => {
    expect(extract('ALTER TABLE foo ADD COLUMN x INT')).toEqual(['foo']);
  });

  it('DROP TABLE', () => {
    expect(extract('DROP TABLE foo')).toEqual(['foo']);
  });

  it('schema-qualified names', () => {
    expect(extract('SELECT * FROM public.users')).toEqual(['users']);
  });

  it('multi-statement returns union of tables', () => {
    expect(
      extract('SELECT * FROM users; DELETE FROM orders').sort()
    ).toEqual(['orders', 'users']);
  });

  it('throws on unparseable SQL', () => {
    expect(() => extract('this is not sql at all ;;;')).toThrow();
  });
});

describe('getStatementTypes', () => {
  it('classifies SELECT as read', () => {
    expect(getStatementTypes('SELECT 1', 'postgres')).toEqual(['select']);
  });

  it('classifies INSERT as write', () => {
    expect(getStatementTypes("INSERT INTO users VALUES ('x')", 'postgres')).toEqual(['insert']);
  });

  it('classifies multi-statement with mixed types', () => {
    const types = getStatementTypes('SELECT 1; DELETE FROM x', 'postgres');
    expect(types).toContain('select');
    expect(types).toContain('delete');
  });
});
```

**Step 2: Run — expect fail**

**Step 3: Implement `src/sql-parse.ts`**

```ts
import { Parser } from 'node-sql-parser';
import type { DbType } from './config.js';

const parser = new Parser();

const DIALECT: Record<Exclude<DbType, 'mongodb'>, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'Sqlite',
  mssql: 'TransactSQL',
};

export type SqlDbType = Exclude<DbType, 'mongodb'>;

/**
 * Extract every table/view referenced by a SQL statement (or multi-statement
 * batch). Returns lowercase, deduplicated names. Throws if the SQL can't be
 * parsed — caller must treat an unparseable query as rejected.
 */
export function extractTables(sql: string, dbType: SqlDbType): string[] {
  const database = DIALECT[dbType];
  const list = parser.tableList(sql, { database });
  const names = new Set<string>();
  for (const entry of list) {
    // entries are "<op>::<schema>::<table>"
    const parts = entry.split('::');
    const table = parts[parts.length - 1];
    if (table) names.add(table.toLowerCase());
  }
  return [...names];
}

/**
 * Classify each statement in the batch (select, insert, update, delete,
 * create, alter, drop, ...). Used by READ_ONLY enforcement.
 */
export function getStatementTypes(sql: string, dbType: SqlDbType): string[] {
  const database = DIALECT[dbType];
  const ast = parser.astify(sql, { database });
  const asts = Array.isArray(ast) ? ast : [ast];
  return asts.map((node) => (node as { type: string }).type);
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: SQL parser wrapper for table extraction"
```

---

## Task 5: SQL allowlist guard

Combine allowlist + table extraction into a single reject-or-pass decision.

**Files:**
- Create: `src/sql-guard.ts`
- Create: `tests/sql-guard.test.ts`

**Step 1: Write failing tests**

```ts
// tests/sql-guard.test.ts
import { describe, it, expect } from 'vitest';
import { checkSqlAllowed } from '../src/sql-guard.js';
import type { Config } from '../src/config.js';

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    dbType: 'postgres',
    dbUrl: 'x',
    allowlist: { type: 'list', tables: new Set(['users', 'orders']) },
    maxRows: 1000,
    queryTimeoutMs: 30000,
    readOnly: false,
    ...overrides,
  };
}

describe('checkSqlAllowed', () => {
  it('passes when all tables allowed', () => {
    expect(checkSqlAllowed('SELECT * FROM users', cfg())).toEqual({ ok: true });
  });

  it('rejects when any table disallowed', () => {
    const r = checkSqlAllowed('SELECT * FROM users JOIN secrets ON 1=1', cfg());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/secrets/);
  });

  it('rejects unparseable SQL', () => {
    const r = checkSqlAllowed('not valid sql ;;', cfg());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/parse/i);
  });

  it('wildcard skips table check', () => {
    expect(
      checkSqlAllowed('SELECT * FROM anything', cfg({ allowlist: { type: 'wildcard' } }))
    ).toEqual({ ok: true });
  });

  it('READ_ONLY rejects INSERT', () => {
    const r = checkSqlAllowed(
      "INSERT INTO users (name) VALUES ('x')",
      cfg({ readOnly: true })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/read.?only/i);
  });

  it('READ_ONLY allows SELECT', () => {
    expect(
      checkSqlAllowed('SELECT * FROM users', cfg({ readOnly: true }))
    ).toEqual({ ok: true });
  });

  it('rejects multi-statement if any statement disallowed', () => {
    const r = checkSqlAllowed(
      'SELECT * FROM users; DELETE FROM secrets',
      cfg()
    );
    expect(r.ok).toBe(false);
  });

  it('case-insensitive (schema-qualified)', () => {
    expect(
      checkSqlAllowed('SELECT * FROM public.USERS', cfg())
    ).toEqual({ ok: true });
  });
});
```

**Step 2: Run — expect fail**

**Step 3: Implement `src/sql-guard.ts`**

```ts
import type { Config } from './config.js';
import { isAllowed } from './allowlist.js';
import { extractTables, getStatementTypes, type SqlDbType } from './sql-parse.js';

export type GuardResult = { ok: true } | { ok: false; reason: string };

const WRITE_TYPES = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'create',
  'alter',
  'drop',
  'truncate',
  'rename',
]);

export function checkSqlAllowed(sql: string, config: Config): GuardResult {
  const dbType = config.dbType as SqlDbType;

  let tables: string[];
  let types: string[];
  try {
    tables = extractTables(sql, dbType);
    types = getStatementTypes(sql, dbType);
  } catch (err) {
    return { ok: false, reason: `Query could not be parsed: ${(err as Error).message}` };
  }

  if (config.readOnly) {
    const writes = types.filter((t) => WRITE_TYPES.has(t));
    if (writes.length > 0) {
      return {
        ok: false,
        reason: `READ_ONLY mode: statement type '${writes[0]}' is not allowed`,
      };
    }
  }

  for (const table of tables) {
    if (!isAllowed(config.allowlist, table, 'sql')) {
      return {
        ok: false,
        reason: `Table '${table}' is not in ALLOWED_TABLES`,
      };
    }
  }

  return { ok: true };
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: SQL allowlist guard combines parsing and checks"
```

---

## Task 6: Adapter interface + error helper

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/errors.ts`

**Step 1: Create `src/adapters/types.ts`**

```ts
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
}

export interface SqlQuery {
  kind: 'sql';
  sql: string;
  params?: unknown[];
}

export interface MongoQuery {
  kind: 'mongo';
  collection: string;
  operation:
    | 'find'
    | 'aggregate'
    | 'insertOne'
    | 'insertMany'
    | 'updateOne'
    | 'updateMany'
    | 'deleteOne'
    | 'deleteMany'
    | 'countDocuments';
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
  pipeline?: Record<string, unknown>[];
  documents?: Record<string, unknown>[];
}

export type QueryRequest = SqlQuery | MongoQuery;

export interface QueryResult {
  rows?: unknown[];
  rowsAffected?: number;
  truncated?: boolean;
  returned?: number;
}

export interface DbAdapter {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTables(): Promise<string[]>;
  describeTable(table: string): Promise<ColumnInfo[]>;
  execute(query: QueryRequest): Promise<QueryResult>;
}
```

**Step 2: Create `src/errors.ts`**

```ts
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Wraps a driver error so we never leak the underlying stack trace to the
 * agent. Logs the original to stderr for operator debugging.
 */
export function sanitizeDriverError(err: unknown, context: string): ToolError {
  const raw = err instanceof Error ? err : new Error(String(err));
  console.error(`[dbward] ${context}:`, raw.stack ?? raw.message);
  return new ToolError(`${context}: ${raw.message}`);
}
```

**Step 3: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: DbAdapter interface and error helper"
```

---

## Task 7: SQLite adapter

First real adapter. In-memory, no containers needed.

**Files:**
- Create: `src/adapters/sqlite.ts`
- Create: `tests/adapters/sqlite.test.ts`

**Step 1: Install driver**

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

**Step 2: Write failing tests**

```ts
// tests/adapters/sqlite.test.ts
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
```

**Step 3: Run — expect fail**

**Step 4: Implement `src/adapters/sqlite.ts`**

```ts
import Database from 'better-sqlite3';
import type {
  ColumnInfo,
  DbAdapter,
  QueryRequest,
  QueryResult,
} from './types.js';
import { sanitizeDriverError } from '../errors.js';

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database | null = null;

  constructor(private readonly path: string) {}

  async connect(): Promise<void> {
    this.db = new Database(this.path);
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  async listTables(): Promise<string[]> {
    const db = this.requireDb();
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    const db = this.requireDb();
    try {
      const rows = db.pragma(`table_info(${quoteIdent(table)})`) as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      return rows.map((r) => ({
        name: r.name,
        type: r.type,
        nullable: r.notnull === 0,
        default: r.dflt_value ?? undefined,
      }));
    } catch (err) {
      throw sanitizeDriverError(err, `describeTable(${table})`);
    }
  }

  async execute(query: QueryRequest): Promise<QueryResult> {
    if (query.kind !== 'sql') {
      throw new Error('SqliteAdapter only handles SQL queries');
    }
    const db = this.requireDb();
    try {
      const stmt = db.prepare(query.sql);
      if (stmt.reader) {
        const rows = stmt.all(...(query.params ?? [])) as unknown[];
        return { rows };
      }
      const info = stmt.run(...(query.params ?? []));
      return { rowsAffected: info.changes };
    } catch (err) {
      throw sanitizeDriverError(err, 'execute');
    }
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('SqliteAdapter: not connected');
    return this.db;
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
```

**Step 5: Run — expect pass**

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: SQLite adapter"
```

---

## Task 8: list_tables tool

**Files:**
- Create: `src/tools/list-tables.ts`
- Create: `tests/tools/list-tables.test.ts`

**Step 1: Write failing test**

```ts
// tests/tools/list-tables.test.ts
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
    const result = await listTablesHandler(
      mockAdapter(['users', 'secrets', 'orders']),
      baseCfg
    );
    expect(result.tables.sort()).toEqual(['orders', 'users']);
  });

  it('wildcard returns all', async () => {
    const result = await listTablesHandler(
      mockAdapter(['users', 'secrets', 'orders']),
      { ...baseCfg, allowlist: { type: 'wildcard' } }
    );
    expect(result.tables.sort()).toEqual(['orders', 'secrets', 'users']);
  });

  it('mongo filters case-sensitively', async () => {
    const result = await listTablesHandler(
      mockAdapter(['Users', 'users', 'Orders']),
      {
        ...baseCfg,
        dbType: 'mongodb',
        allowlist: { type: 'list', tables: new Set(['Users']) },
      }
    );
    expect(result.tables).toEqual(['Users']);
  });
});
```

**Step 2: Run — expect fail**

**Step 3: Implement `src/tools/list-tables.ts`**

```ts
import type { DbAdapter } from '../adapters/types.js';
import type { Config } from '../config.js';
import { isAllowed } from '../allowlist.js';

export async function listTablesHandler(
  adapter: DbAdapter,
  config: Config
): Promise<{ tables: string[] }> {
  const all = await adapter.listTables();
  const mode = config.dbType === 'mongodb' ? 'mongo' : 'sql';
  const filtered = all.filter((t) => isAllowed(config.allowlist, t, mode));
  return { tables: filtered };
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: list_tables tool handler"
```

---

## Task 9: describe_table tool

**Files:**
- Create: `src/tools/describe-table.ts`
- Create: `tests/tools/describe-table.test.ts`

**Step 1: Write failing test**

```ts
// tests/tools/describe-table.test.ts
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
```

**Step 2: Run — expect fail**

**Step 3: Implement `src/tools/describe-table.ts`**

```ts
import type { DbAdapter, ColumnInfo } from '../adapters/types.js';
import type { Config } from '../config.js';
import { isAllowed } from '../allowlist.js';
import { ToolError } from '../errors.js';

export async function describeTableHandler(
  adapter: DbAdapter,
  config: Config,
  input: { table: string }
): Promise<{ columns: ColumnInfo[] }> {
  const mode = config.dbType === 'mongodb' ? 'mongo' : 'sql';
  if (!isAllowed(config.allowlist, input.table, mode)) {
    throw new ToolError(`Table '${input.table}' is not in ALLOWED_TABLES`);
  }
  const columns = await adapter.describeTable(input.table);
  return { columns };
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: describe_table tool handler"
```

---

## Task 10: execute_query tool (SQL path)

**Files:**
- Create: `src/tools/execute-query.ts`
- Create: `tests/tools/execute-query.test.ts`

**Step 1: Write failing test**

```ts
// tests/tools/execute-query.test.ts
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
      executeQueryHandler(adapter, cfg(), { sql: 'SELECT * FROM secrets' })
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
      })
    ).rejects.toThrow(ToolError);
  });
});
```

**Step 2: Run — expect fail**

**Step 3: Implement `src/tools/execute-query.ts`**

```ts
import type { DbAdapter, QueryResult } from '../adapters/types.js';
import type { Config } from '../config.js';
import { checkSqlAllowed } from '../sql-guard.js';
import { isAllowed } from '../allowlist.js';
import { ToolError } from '../errors.js';

export interface SqlInput {
  sql: string;
  params?: unknown[];
}

export interface MongoInput {
  collection: string;
  operation:
    | 'find'
    | 'aggregate'
    | 'insertOne'
    | 'insertMany'
    | 'updateOne'
    | 'updateMany'
    | 'deleteOne'
    | 'deleteMany'
    | 'countDocuments';
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
  pipeline?: Record<string, unknown>[];
  documents?: Record<string, unknown>[];
}

const MONGO_WRITE_OPS = new Set([
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
]);

export async function executeQueryHandler(
  adapter: DbAdapter,
  config: Config,
  input: SqlInput | MongoInput
): Promise<QueryResult> {
  if (config.dbType === 'mongodb') {
    return executeMongo(adapter, config, input as MongoInput);
  }
  return executeSql(adapter, config, input as SqlInput);
}

async function executeSql(
  adapter: DbAdapter,
  config: Config,
  input: SqlInput
): Promise<QueryResult> {
  const check = checkSqlAllowed(input.sql, config);
  if (!check.ok) throw new ToolError(check.reason);

  const raw = await adapter.execute({
    kind: 'sql',
    sql: input.sql,
    params: input.params,
  });
  return applyMaxRows(raw, config.maxRows);
}

async function executeMongo(
  adapter: DbAdapter,
  config: Config,
  input: MongoInput
): Promise<QueryResult> {
  if (!input.collection || typeof input.collection !== 'string') {
    throw new ToolError('collection is required');
  }
  if (!isAllowed(config.allowlist, input.collection, 'mongo')) {
    throw new ToolError(
      `Collection '${input.collection}' is not in ALLOWED_TABLES`
    );
  }
  if (config.readOnly && MONGO_WRITE_OPS.has(input.operation)) {
    throw new ToolError(
      `READ_ONLY mode: operation '${input.operation}' is not allowed`
    );
  }
  const raw = await adapter.execute({ kind: 'mongo', ...input });
  return applyMaxRows(raw, config.maxRows);
}

function applyMaxRows(r: QueryResult, maxRows: number): QueryResult {
  if (!r.rows) return r;
  if (r.rows.length > maxRows) {
    return {
      rows: r.rows.slice(0, maxRows),
      truncated: true,
      returned: maxRows,
    };
  }
  return { ...r, truncated: false, returned: r.rows.length };
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: execute_query tool handler with maxRows truncation"
```

---

## Task 11: MCP server wiring (SQLite end-to-end)

Wire everything into an actual stdio MCP server.

**Files:**
- Modify: `src/index.ts`
- Create: `src/server.ts`

**Step 1: Replace `src/index.ts`**

```ts
#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createAdapter } from './adapters/factory.js';
import { startServer } from './server.js';

async function main() {
  const config = loadConfig();
  const adapter = await createAdapter(config);
  await adapter.connect();

  const shutdown = async () => {
    await adapter.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await startServer(adapter, config);
}

main().catch((err) => {
  console.error('[dbward] fatal:', err);
  process.exit(1);
});
```

**Step 2: Create `src/adapters/factory.ts`**

```ts
import type { Config } from '../config.js';
import type { DbAdapter } from './types.js';

export async function createAdapter(config: Config): Promise<DbAdapter> {
  switch (config.dbType) {
    case 'sqlite': {
      const { SqliteAdapter } = await import('./sqlite.js');
      return new SqliteAdapter(config.dbUrl);
    }
    // Other cases added in later tasks.
    default:
      throw new Error(`Adapter not yet implemented: ${config.dbType}`);
  }
}
```

**Step 3: Create `src/server.ts`**

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { DbAdapter } from './adapters/types.js';
import type { Config } from './config.js';
import { listTablesHandler } from './tools/list-tables.js';
import { describeTableHandler } from './tools/describe-table.js';
import { executeQueryHandler } from './tools/execute-query.js';
import { ToolError } from './errors.js';

function executeQuerySchema(dbType: Config['dbType']) {
  if (dbType === 'mongodb') {
    return {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        operation: {
          type: 'string',
          enum: [
            'find',
            'aggregate',
            'insertOne',
            'insertMany',
            'updateOne',
            'updateMany',
            'deleteOne',
            'deleteMany',
            'countDocuments',
          ],
        },
        filter: { type: 'object' },
        update: { type: 'object' },
        pipeline: { type: 'array', items: { type: 'object' } },
        documents: { type: 'array', items: { type: 'object' } },
      },
      required: ['collection', 'operation'],
    };
  }
  return {
    type: 'object',
    properties: {
      sql: { type: 'string' },
      params: { type: 'array' },
    },
    required: ['sql'],
  };
}

export async function startServer(adapter: DbAdapter, config: Config) {
  const server = new Server(
    { name: 'dbward', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_tables',
        description: 'List tables (or collections) visible to this MCP, filtered by the configured allowlist.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'describe_table',
        description: 'Return column/field info for the given table. Rejected if table is not in the allowlist.',
        inputSchema: {
          type: 'object',
          properties: { table: { type: 'string' } },
          required: ['table'],
        },
      },
      {
        name: 'execute_query',
        description:
          config.dbType === 'mongodb'
            ? 'Run a Mongo operation against the configured collection. Allowlist enforced on the collection arg.'
            : 'Run a SQL query. All referenced tables are extracted and checked against the allowlist before execution.',
        inputSchema: executeQuerySchema(config.dbType),
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      let result: unknown;
      switch (req.params.name) {
        case 'list_tables':
          result = await listTablesHandler(adapter, config);
          break;
        case 'describe_table':
          result = await describeTableHandler(adapter, config, {
            table: String(args.table ?? ''),
          });
          break;
        case 'execute_query':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await executeQueryHandler(adapter, config, args as any);
          break;
        default:
          throw new ToolError(`Unknown tool: ${req.params.name}`);
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: msg }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

**Step 4: Build and smoke-test**

```bash
npm run build
DB_TYPE=sqlite DB_URL=:memory: ALLOWED_TABLES=* node dist/index.js <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: JSON response listing the three tools.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire MCP stdio server with SQLite adapter"
```

---

## Task 12: Postgres adapter

**Files:**
- Create: `src/adapters/postgres.ts`
- Modify: `src/adapters/factory.ts`

**Step 1: Install driver**

```bash
npm install pg
npm install --save-dev @types/pg
```

**Step 2: Implement `src/adapters/postgres.ts`**

```ts
import pg from 'pg';
import type {
  ColumnInfo,
  DbAdapter,
  QueryRequest,
  QueryResult,
} from './types.js';
import { sanitizeDriverError } from '../errors.js';

export class PostgresAdapter implements DbAdapter {
  private client: pg.Client | null = null;

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  async connect(): Promise<void> {
    this.client = new pg.Client({
      connectionString: this.url,
      statement_timeout: this.timeoutMs,
    });
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client?.end();
    this.client = null;
  }

  async listTables(): Promise<string[]> {
    const client = this.require();
    const r = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ANY (current_schemas(false))
       ORDER BY table_name`
    );
    return r.rows.map((row) => row.table_name as string);
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    const client = this.require();
    try {
      const r = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = ANY (current_schemas(false))
           AND lower(table_name) = lower($1)
         ORDER BY ordinal_position`,
        [table]
      );
      return r.rows.map((row) => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        default: row.column_default,
      }));
    } catch (err) {
      throw sanitizeDriverError(err, `describeTable(${table})`);
    }
  }

  async execute(q: QueryRequest): Promise<QueryResult> {
    if (q.kind !== 'sql') throw new Error('PostgresAdapter only handles SQL');
    const client = this.require();
    try {
      const r = await client.query(q.sql, q.params ?? []);
      if (r.command === 'SELECT' || Array.isArray(r.rows) && r.rows.length > 0) {
        return { rows: r.rows };
      }
      return { rowsAffected: r.rowCount ?? 0 };
    } catch (err) {
      throw sanitizeDriverError(err, 'execute');
    }
  }

  private require(): pg.Client {
    if (!this.client) throw new Error('PostgresAdapter: not connected');
    return this.client;
  }
}
```

**Step 3: Update factory**

```ts
// src/adapters/factory.ts
import type { Config } from '../config.js';
import type { DbAdapter } from './types.js';

export async function createAdapter(config: Config): Promise<DbAdapter> {
  switch (config.dbType) {
    case 'sqlite': {
      const { SqliteAdapter } = await import('./sqlite.js');
      return new SqliteAdapter(config.dbUrl);
    }
    case 'postgres': {
      const { PostgresAdapter } = await import('./postgres.js');
      return new PostgresAdapter(config.dbUrl, config.queryTimeoutMs);
    }
    default:
      throw new Error(`Adapter not yet implemented: ${config.dbType}`);
  }
}
```

**Step 4: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: PostgreSQL adapter"
```

*Integration test requires a running Postgres; postponed to Task 16.*

---

## Task 13: MySQL adapter

**Files:**
- Create: `src/adapters/mysql.ts`
- Modify: `src/adapters/factory.ts`

**Step 1: Install driver**

```bash
npm install mysql2
```

**Step 2: Implement `src/adapters/mysql.ts`**

```ts
import mysql from 'mysql2/promise';
import type {
  ColumnInfo,
  DbAdapter,
  QueryRequest,
  QueryResult,
} from './types.js';
import { sanitizeDriverError } from '../errors.js';

export class MysqlAdapter implements DbAdapter {
  private conn: mysql.Connection | null = null;

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  async connect(): Promise<void> {
    this.conn = await mysql.createConnection({
      uri: this.url,
      connectTimeout: this.timeoutMs,
    });
  }

  async close(): Promise<void> {
    await this.conn?.end();
    this.conn = null;
  }

  async listTables(): Promise<string[]> {
    const c = this.require();
    const [rows] = await c.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() ORDER BY table_name`
    );
    return (rows as { name: string }[]).map((r) => r.name);
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    const c = this.require();
    try {
      const [rows] = await c.query(
        `SELECT column_name AS name, data_type AS type,
                is_nullable AS nullable, column_default AS dflt
         FROM information_schema.columns
         WHERE table_schema = DATABASE() AND lower(table_name) = lower(?)
         ORDER BY ordinal_position`,
        [table]
      );
      return (rows as Array<{ name: string; type: string; nullable: string; dflt: string | null }>).map((r) => ({
        name: r.name,
        type: r.type,
        nullable: r.nullable === 'YES',
        default: r.dflt ?? undefined,
      }));
    } catch (err) {
      throw sanitizeDriverError(err, `describeTable(${table})`);
    }
  }

  async execute(q: QueryRequest): Promise<QueryResult> {
    if (q.kind !== 'sql') throw new Error('MysqlAdapter only handles SQL');
    const c = this.require();
    try {
      const [result] = await c.query(q.sql, q.params ?? []);
      if (Array.isArray(result)) {
        return { rows: result as unknown[] };
      }
      const affected = (result as mysql.ResultSetHeader).affectedRows ?? 0;
      return { rowsAffected: affected };
    } catch (err) {
      throw sanitizeDriverError(err, 'execute');
    }
  }

  private require(): mysql.Connection {
    if (!this.conn) throw new Error('MysqlAdapter: not connected');
    return this.conn;
  }
}
```

**Step 3: Update factory** — add `mysql` case, same pattern as Postgres.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: MySQL adapter"
```

---

## Task 14: MSSQL adapter

**Files:**
- Create: `src/adapters/mssql.ts`
- Modify: `src/adapters/factory.ts`

**Step 1: Install driver**

```bash
npm install mssql
```

**Step 2: Implement `src/adapters/mssql.ts`**

```ts
import sql from 'mssql';
import type {
  ColumnInfo,
  DbAdapter,
  QueryRequest,
  QueryResult,
} from './types.js';
import { sanitizeDriverError } from '../errors.js';

export class MssqlAdapter implements DbAdapter {
  private pool: sql.ConnectionPool | null = null;

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  async connect(): Promise<void> {
    this.pool = await sql.connect({
      connectionString: this.url,
      requestTimeout: this.timeoutMs,
    } as sql.config & { connectionString: string });
  }

  async close(): Promise<void> {
    await this.pool?.close();
    this.pool = null;
  }

  async listTables(): Promise<string[]> {
    const p = this.require();
    const r = await p.request().query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' ORDER BY table_name`
    );
    return r.recordset.map((row) => row.table_name as string);
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    const p = this.require();
    try {
      const r = await p
        .request()
        .input('t', sql.VarChar, table)
        .query(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE lower(table_name) = lower(@t)
           ORDER BY ordinal_position`
        );
      return r.recordset.map((row) => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        default: row.column_default ?? undefined,
      }));
    } catch (err) {
      throw sanitizeDriverError(err, `describeTable(${table})`);
    }
  }

  async execute(q: QueryRequest): Promise<QueryResult> {
    if (q.kind !== 'sql') throw new Error('MssqlAdapter only handles SQL');
    const p = this.require();
    try {
      const req = p.request();
      (q.params ?? []).forEach((v, i) => req.input(`p${i}`, v as never));
      const boundSql = q.sql.replace(/\?/g, (_m, _o) => {
        return '';
      });
      // Simpler: mssql uses named params. If params provided, let driver handle.
      const result = q.params && q.params.length > 0 ? await req.query(boundSql || q.sql) : await req.query(q.sql);
      if (result.recordset && result.recordset.length >= 0 && result.rowsAffected.every((n) => n === 0)) {
        return { rows: result.recordset };
      }
      if (result.recordset && result.recordset.length > 0) {
        return { rows: result.recordset };
      }
      return { rowsAffected: result.rowsAffected.reduce((a, b) => a + b, 0) };
    } catch (err) {
      throw sanitizeDriverError(err, 'execute');
    }
  }

  private require(): sql.ConnectionPool {
    if (!this.pool) throw new Error('MssqlAdapter: not connected');
    return this.pool;
  }
}
```

**Step 3: Update factory** — add `mssql` case.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: MSSQL adapter"
```

---

## Task 15: MongoDB adapter

**Files:**
- Create: `src/adapters/mongodb.ts`
- Modify: `src/adapters/factory.ts`

**Step 1: Install driver**

```bash
npm install mongodb
```

**Step 2: Implement `src/adapters/mongodb.ts`**

```ts
import { MongoClient, type Db } from 'mongodb';
import type {
  ColumnInfo,
  DbAdapter,
  QueryRequest,
  QueryResult,
  MongoQuery,
} from './types.js';
import { sanitizeDriverError } from '../errors.js';

export class MongoAdapter implements DbAdapter {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  async connect(): Promise<void> {
    this.client = new MongoClient(this.url, {
      serverSelectionTimeoutMS: this.timeoutMs,
    });
    await this.client.connect();
    this.db = this.client.db();
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.db = null;
  }

  async listTables(): Promise<string[]> {
    const db = this.require();
    const cols = await db.listCollections().toArray();
    return cols.map((c) => c.name).sort();
  }

  async describeTable(name: string): Promise<ColumnInfo[]> {
    const db = this.require();
    try {
      const docs = await db
        .collection(name)
        .find({})
        .limit(20)
        .toArray();
      const fields = new Map<string, Set<string>>();
      for (const doc of docs) {
        for (const [k, v] of Object.entries(doc)) {
          if (!fields.has(k)) fields.set(k, new Set());
          fields.get(k)!.add(typeofMongo(v));
        }
      }
      return [...fields.entries()].map(([name, types]) => ({
        name,
        type: [...types].join('|'),
        nullable: true,
      }));
    } catch (err) {
      throw sanitizeDriverError(err, `describeTable(${name})`);
    }
  }

  async execute(q: QueryRequest): Promise<QueryResult> {
    if (q.kind !== 'mongo') throw new Error('MongoAdapter only handles Mongo queries');
    const db = this.require();
    const col = db.collection(q.collection);
    try {
      return await dispatchMongo(col, q);
    } catch (err) {
      throw sanitizeDriverError(err, 'execute');
    }
  }

  private require(): Db {
    if (!this.db) throw new Error('MongoAdapter: not connected');
    return this.db;
  }
}

function typeofMongo(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  return typeof v;
}

async function dispatchMongo(
  col: import('mongodb').Collection,
  q: MongoQuery
): Promise<QueryResult> {
  switch (q.operation) {
    case 'find':
      return { rows: await col.find(q.filter ?? {}).toArray() };
    case 'aggregate':
      return { rows: await col.aggregate(q.pipeline ?? []).toArray() };
    case 'countDocuments':
      return { rows: [{ count: await col.countDocuments(q.filter ?? {}) }] };
    case 'insertOne': {
      if (!q.documents?.[0]) throw new Error('insertOne requires documents[0]');
      const r = await col.insertOne(q.documents[0]);
      return { rowsAffected: r.acknowledged ? 1 : 0 };
    }
    case 'insertMany': {
      if (!q.documents?.length) throw new Error('insertMany requires documents');
      const r = await col.insertMany(q.documents);
      return { rowsAffected: r.insertedCount };
    }
    case 'updateOne': {
      const r = await col.updateOne(q.filter ?? {}, q.update ?? {});
      return { rowsAffected: r.modifiedCount };
    }
    case 'updateMany': {
      const r = await col.updateMany(q.filter ?? {}, q.update ?? {});
      return { rowsAffected: r.modifiedCount };
    }
    case 'deleteOne': {
      const r = await col.deleteOne(q.filter ?? {});
      return { rowsAffected: r.deletedCount };
    }
    case 'deleteMany': {
      const r = await col.deleteMany(q.filter ?? {});
      return { rowsAffected: r.deletedCount };
    }
  }
}
```

**Step 3: Update factory** — add `mongodb` case.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: MongoDB adapter"
```

---

## Task 16: Integration tests (testcontainers)

Skip locally unless `TEST_INTEGRATION=1`. Only SQLite runs in standard CI.

**Files:**
- Create: `tests/integration/sqlite.integration.test.ts`
- Create: `tests/integration/postgres.integration.test.ts`
- Create: `tests/integration/mysql.integration.test.ts`
- Create: `tests/integration/mssql.integration.test.ts`
- Create: `tests/integration/mongodb.integration.test.ts`

**Step 1: Install testcontainers**

```bash
npm install --save-dev testcontainers
```

**Step 2: Add sqlite integration test that covers the full tool pipeline**

```ts
// tests/integration/sqlite.integration.test.ts
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
    await expect(
      describeTableHandler(a, cfg, { table: 'secrets' })
    ).rejects.toThrow(ToolError);
  });

  it('execute_query allowed SELECT', async () => {
    const r = await executeQueryHandler(a, cfg, { sql: 'SELECT * FROM users' });
    expect(r.rows).toHaveLength(2);
  });

  it('execute_query rejects JOIN to disallowed table', async () => {
    await expect(
      executeQueryHandler(a, cfg, {
        sql: 'SELECT * FROM users JOIN secrets ON 1=1',
      })
    ).rejects.toThrow(ToolError);
  });
});
```

**Step 3: (Optional, gated) Write testcontainer-based tests for pg/mysql/mssql/mongo**

Each follows the same pattern: start a container, seed minimal data, run the three handlers against it, verify allowlist rejection. Gate with:

```ts
const runContainers = process.env.TEST_INTEGRATION === '1';
describe.skipIf(!runContainers)('postgres container', () => { /* ... */ });
```

Leaving the full container test bodies to the implementing engineer (each is ~30 lines).

**Step 4: Run**

```bash
npm test
```

Expected: sqlite integration passes; container tests skipped unless `TEST_INTEGRATION=1`.

**Step 5: Commit**

```bash
git add -A
git commit -m "test: end-to-end tool pipeline against SQLite"
```

---

## Task 17: README + distribution

**Files:**
- Create: `README.md`

**Step 1: Write `README.md`**

```markdown
# dbward

An MCP server that exposes a single database connection to an MCP-capable agent, with explicit per-table/collection allowlist enforcement.

Supports PostgreSQL, MySQL, SQLite, MSSQL, and MongoDB. Every SQL query is parsed before execution and checked against the allowlist; there is no deny list — whitelist only.

## Install

```bash
npx dbward
```

## Configuration

All config is via environment variables.

| Var | Required | Notes |
|-----|----------|-------|
| `DB_TYPE` | yes | `postgres` \| `mysql` \| `sqlite` \| `mssql` \| `mongodb` |
| `DB_URL` | yes | Connection string or SQLite file path |
| `ALLOWED_TABLES` | yes | Comma-separated list, or `*` for all |
| `MAX_ROWS` | no | Default 1000 |
| `QUERY_TIMEOUT_MS` | no | Default 30000 |
| `READ_ONLY` | no | `true` to reject writes |

## Example — Claude Desktop

```json
{
  "mcpServers": {
    "mydb": {
      "command": "npx",
      "args": ["-y", "dbward"],
      "env": {
        "DB_TYPE": "postgres",
        "DB_URL": "postgres://user:pass@localhost/app",
        "ALLOWED_TABLES": "users,orders,order_items"
      }
    }
  }
}
```

## Tools

- `list_tables` — lists tables/collections, filtered to the allowlist
- `describe_table` — columns or sampled Mongo fields for one table
- `execute_query` — run a SQL statement (or a Mongo operation); allowlist enforced

## Safety model

- SQL queries are parsed with `node-sql-parser`. Every referenced table is extracted and checked. Unparseable queries are rejected.
- For Mongo, `collection` is a required tool argument and is checked directly.
- `READ_ONLY=true` blocks non-SELECT SQL and Mongo writes.
- `MAX_ROWS` caps returned rows; response flags `truncated: true` when hit.

## Publishing

```bash
npm run build
npm publish
```
```

**Step 2: Commit**

```bash
git add -A
git commit -m "docs: README with config, examples, and safety model"
```

---

## Task 18: Publish prep

**Step 1: Smoke test against all three tools over stdio**

```bash
DB_TYPE=sqlite DB_URL=:memory: ALLOWED_TABLES=* npm run dev
# In another terminal, send JSON-RPC requests and verify responses.
```

**Step 2: Verify `files` in package.json ships only `dist` + README**

```bash
npm pack --dry-run
```

Expected: `dist/`, `README.md`, `package.json` only. No `src`, no `tests`.

**Step 3: Tag and commit**

```bash
git tag v0.1.0
```

*Do NOT `npm publish` without user confirmation — that's a public, one-way action.*

---

## Definition of done

- All unit tests pass: `npm test`
- `npm run typecheck` clean
- `npm run build` produces working `dist/index.js`
- Smoke test against SQLite in-memory returns real data via stdio
- Allowlist rejection verified end-to-end for each tool
- README published
- Ready to `npm publish` (awaiting user confirmation)
