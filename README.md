<div align="center">

# DBward

> MCP server for PostgreSQL, MySQL, SQLite, MSSQL and MongoDB — with per-table allowlist enforcement.

[![npm version](https://img.shields.io/npm/v/dbward.svg?style=flat-square)](https://www.npmjs.com/package/dbward)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](#contributing)

</div>

`dbward` connects your MCP-capable agent (Claude Desktop, Claude Code, Cursor, …) to a database — but only to the tables you allow. Every SQL query is parsed before it runs and rejected if it touches anything outside the whitelist.

- **Five engines:** PostgreSQL, MySQL, SQLite, MSSQL, MongoDB
- **Whitelist-only:** no deny list; unknown tables are rejected
- **AST-based enforcement:** SQL is parsed, not string-matched
- **Zero config files:** everything is an environment variable
- **Fail-closed:** unparseable queries are rejected, never guessed

---

## Quick start

```bash
DB_TYPE=postgres \
DB_URL="postgres://user:pass@localhost:5432/app" \
ALLOWED_TABLES="users,orders" \
npx dbward
```

That's it. The server speaks MCP over stdio.

### In Claude Desktop / Claude Code

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

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_TYPE` | yes | — | `postgres` \| `mysql` \| `sqlite` \| `mssql` \| `mongodb` |
| `DB_URL` | yes | — | Connection string or SQLite file path |
| `ALLOWED_TABLES` | yes | — | Comma-separated list, or `*` for everything |
| `MAX_ROWS` | no | `1000` | Cap on returned rows |
| `QUERY_TIMEOUT_MS` | no | `30000` | Per-query timeout |
| `READ_ONLY` | no | `false` | Set `true` to block writes and DDL |

---

## Tools

Three tools are exposed to the agent.

| Tool | Purpose |
|---|---|
| `list_tables` | Lists tables / collections visible through the allowlist |
| `describe_table` | Columns / field info; rejected if the table isn't allowed |
| `execute_query` | Runs a SQL statement or Mongo operation |

### `execute_query` — SQL

```ts
// Input
{ sql: string, params?: unknown[] }

// Output
{ rows: [...], truncated: boolean, returned: number }  // SELECT
{ rowsAffected: number }                               // DML / DDL
```

### `execute_query` — MongoDB

```ts
{
  collection: string,
  operation:
    | 'find' | 'aggregate' | 'countDocuments'
    | 'insertOne' | 'insertMany'
    | 'updateOne' | 'updateMany'
    | 'deleteOne' | 'deleteMany',
  filter?:   Record<string, unknown>,
  update?:   Record<string, unknown>,
  pipeline?: Record<string, unknown>[],
  documents?: Record<string, unknown>[]
}
```

---

## Safety model

- SQL is parsed with [`node-sql-parser`](https://www.npmjs.com/package/node-sql-parser). Every referenced table is extracted and checked against the allowlist **before** the driver sees the query.
- Unparseable SQL is rejected — we never guess.
- MongoDB checks the required `collection` argument directly.
- `READ_ONLY=true` blocks non-SELECT SQL (including DDL and GRANT / REVOKE) and Mongo writes.
- `MAX_ROWS` caps rows returned and sets `truncated: true` on the response when hit.
- Driver errors are logged to stderr but sanitized before reaching the agent.

### Known parser gaps

These statements are rejected as unparseable (fail-closed):

- `MERGE`, `COPY`, `EXPLAIN`
- `SELECT … FOR UPDATE`
- `DELETE … USING` (PostgreSQL)
- Writable CTEs (`WITH x AS (DELETE … RETURNING …) …`)
- `CREATE MATERIALIZED VIEW`

Refusing queries we can't safely analyze beats approving them on a guess.

### MSSQL parameters

MSSQL uses named parameters — write `@p0`, `@p1`, … not `?`.

---

## Development

```bash
git clone https://github.com/0xvasanth/dbward.git
cd dbward
npm install
npm test            # unit + in-memory SQLite integration
npm run typecheck   # tsc --noEmit
npm run build       # -> dist/
```

### Integration tests against real databases

A `docker-compose.yml` is included. It brings up PostgreSQL, MySQL, MSSQL and MongoDB on non-default host ports so local installs aren't disturbed.

```bash
docker compose up -d
TEST_INTEGRATION=1 npm test
docker compose down -v
```

| Service | Host port | Credentials |
|---|---|---|
| PostgreSQL | `15432` | `dbward` / `dbward` |
| MySQL      | `13306` | `dbward` / `dbward` |
| MSSQL      | `11433` | `sa` / `Dbward_Test_123!` |
| MongoDB    | `37017` | `dbward` / `dbward` |

---

## Contributing

Contributions are very welcome.

1. Fork the repo and create a feature branch
2. Write tests first (we use TDD)
3. `npm test` and `npm run typecheck` must be clean
4. Open a PR with a clear description

For bug reports and feature requests, please open an [issue](https://github.com/0xvasanth/dbward/issues).

### Reporting security vulnerabilities

Please **do not** open a public issue for security problems. Email the maintainer directly instead — see the commit log for contact.

---

## License

[MIT](LICENSE) © Vasanth
