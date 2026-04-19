# dbward — Design

**Date:** 2026-04-19
**Status:** Design validated, ready for implementation
**npm package:** `dbward`

## Summary

`dbward` is a single-connection MCP server that exposes any of five databases (PostgreSQL, MySQL, SQLite, MSSQL, MongoDB) to an MCP-capable agent, with per-table/collection whitelist enforcement. Configuration is env-only. Tool surface is deliberately small: `list_tables`, `describe_table`, `execute_query`.

## Goals

- One MCP instance per database connection.
- Full CRUD + DDL supported via raw queries (not pre-baked operations).
- Enforce a table/collection **allowlist** (wildcard `*` supported). No deny list.
- Prevent bypass: SQL is parsed and every referenced table is checked before the driver runs it.
- Fail safe: unparseable SQL or disallowed tables are rejected, not silently passed through.

## Non-goals

- No multi-tenant auth inside the MCP itself — one instance, one connection, one allowlist.
- No query rewriting or row-level security.
- No connection pooling across tenants.
- No built-in migrations / admin UI.

## Stack

- **Language:** TypeScript, Node.js 20+
- **MCP:** `@modelcontextprotocol/sdk` over stdio
- **SQL parsing:** `node-sql-parser` (handles PostgreSQL, MySQL, SQLite, TransactSQL dialects)
- **Drivers:** `pg`, `mysql2`, `better-sqlite3`, `mssql`, `mongodb`
- **Validation:** `zod`
- **Tests:** `vitest` + `testcontainers` for integration

## Architecture

```
┌─────────────────────────────┐
│  MCP stdio server (SDK)     │
├─────────────────────────────┤
│  Tool handlers              │
├─────────────────────────────┤
│  Allowlist guard            │
├─────────────────────────────┤
│  Driver adapter interface   │
├─────────────────────────────┤
│  pg │ mysql2 │ sqlite │ mssql │ mongodb │
└─────────────────────────────┘
```

Engine is selected once at boot from `DB_TYPE`. Only the chosen adapter's driver is loaded (lazy import) so unused drivers don't inflate startup cost.

## Configuration (env vars only)

### Required

| Var | Values | Notes |
|-----|--------|-------|
| `DB_TYPE` | `postgres` \| `mysql` \| `sqlite` \| `mssql` \| `mongodb` | selects adapter |
| `DB_URL` | connection string or file path | e.g. `postgres://...`, `mongodb://...`, `/path/to.sqlite` |
| `ALLOWED_TABLES` | comma-separated list or `*` | applies to tables and Mongo collections |

### Optional

| Var | Default | Notes |
|-----|---------|-------|
| `MAX_ROWS` | `1000` | hard cap on returned rows |
| `QUERY_TIMEOUT_MS` | `30000` | per-query timeout |
| `READ_ONLY` | `false` | if `true`, reject non-SELECT SQL and Mongo writes |

Config is parsed via `zod` at startup. Missing/invalid → fail fast before MCP handshake.

`ALLOWED_TABLES` is normalized to `{ type: 'wildcard' }` or `{ type: 'list', tables: Set<string> }`. SQL matching is case-insensitive; Mongo matching is case-sensitive.

## Tool contract

### `list_tables`
- Input: none
- Output: `{ tables: string[] }` — filtered to allowlist
- SQL: `information_schema.tables` / `sqlite_master`
- Mongo: `db.listCollections()`

### `describe_table`
- Input: `{ table: string }`
- Output: `{ columns: Array<{ name, type, nullable, default? }>, indexes?: [...] }`
- Rejects if `table` not in allowlist
- SQL: `information_schema.columns`
- Mongo: samples N docs (default 20), infers field types (best-effort)

### `execute_query`

**SQL engines:**
```ts
{ sql: string, params?: unknown[] }
```
- Parsed with `node-sql-parser` using the dialect matching `DB_TYPE`.
- Referenced tables extracted and checked against allowlist.
- `READ_ONLY=true` rejects non-SELECT.
- `SELECT` result sliced to `MAX_ROWS`; response includes `{ truncated: boolean, returned: number }`.
- Non-SELECT returns `{ rowsAffected: number }`.

**Mongo:**
```ts
{
  collection: string,
  operation: 'find'|'aggregate'|'insertOne'|'insertMany'|'updateOne'|'updateMany'|'deleteOne'|'deleteMany'|'countDocuments',
  filter?, update?, pipeline?, documents?
}
```
- `collection` checked against allowlist directly.
- `find`/`aggregate` sliced to `MAX_ROWS`.

**Errors:** All tools return MCP `isError: true` with a structured message. Never leak driver stack traces.

## Allowlist enforcement

### SQL path

1. `node-sql-parser` parses query with the dialect matching `DB_TYPE`.
2. `parser.tableList(sql)` returns entries like `"select::public::users"` → extract name, lowercase.
3. Every referenced table must be in the allowlist; any miss → reject before the driver runs.
4. CTEs, subqueries, joins, UNIONs, DDL all flow through the same extraction.
5. Parse failure → reject with `"Query could not be parsed"`. Never fall back.
6. `READ_ONLY=true` → reject non-SELECT.
7. Multi-statement queries: all statements must pass.

### Mongo path

No parsing. `collection` arg is required on every call and checked directly. `READ_ONLY=true` rejects `insert*`/`update*`/`delete*`.

### Defense in depth

- Allowlist check runs **before** the driver call.
- Wildcard mode skips the check but logs the query.
- Rejections come back as MCP tool errors, not thrown exceptions.
- Every rejection is logged to stderr with a reason.

## Project layout

```
dbward/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # MCP server entry, wires tools
│   ├── config.ts              # zod env schema, allowlist normalizer
│   ├── allowlist.ts           # isAllowed(), extractTables() wrappers
│   ├── tools/
│   │   ├── list-tables.ts
│   │   ├── describe-table.ts
│   │   └── execute-query.ts
│   ├── adapters/
│   │   ├── types.ts           # DbAdapter interface
│   │   ├── postgres.ts
│   │   ├── mysql.ts
│   │   ├── sqlite.ts
│   │   ├── mssql.ts
│   │   └── mongodb.ts
│   └── errors.ts              # toolError() helper
└── tests/
    ├── allowlist.test.ts
    ├── config.test.ts
    ├── tools.test.ts
    └── integration/
        ├── postgres.test.ts
        ├── mysql.test.ts
        ├── sqlite.test.ts
        ├── mssql.test.ts
        └── mongodb.test.ts
```

### `DbAdapter` interface

```ts
interface DbAdapter {
  connect(): Promise<void>
  close(): Promise<void>
  listTables(): Promise<string[]>
  describeTable(t: string): Promise<ColumnInfo[]>
  execute(q: QueryRequest): Promise<QueryResult>
}
```

## Testing strategy

- **Unit (always run):** allowlist extraction against tricky SQL fixtures (CTEs, `WITH RECURSIVE`, subqueries, UNION, DDL, multi-statement, schema-qualified names, quoted identifiers); config validation; tool dispatch with mock adapter.
- **Integration (opt-in via `TEST_INTEGRATION=1`):** real drivers via `testcontainers` for pg/mysql/mssql/mongo, in-memory sqlite. Each test brings up a DB, seeds it, asserts tools work end-to-end and allowlist rejection actually prevents the driver call.
- **Security tests:** attempt bypass — comments, case variations, schema-qualified names, quoted identifiers, UNION to blocked table. All must reject.

## Distribution

- Published as npm package `dbward`
- Runnable via `npx dbward`
- README documents Claude Desktop / Code config snippet

## Example launch

```bash
DB_TYPE=postgres \
DB_URL=postgres://localhost/mydb \
ALLOWED_TABLES=users,orders \
MAX_ROWS=500 \
npx dbward
```
