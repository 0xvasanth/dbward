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

- SQL queries are parsed with `node-sql-parser`. Every referenced table is extracted and checked. Unparseable queries are rejected (fail-closed).
- The allowlist is strict whitelist — there is no deny list.
- For Mongo, `collection` is a required tool argument and is checked directly.
- `READ_ONLY=true` blocks non-SELECT SQL (including DDL, GRANT/REVOKE) and Mongo writes.
- `MAX_ROWS` caps returned rows; response flags `truncated: true` when hit.

### Known parser limitations

The bundled SQL parser does not recognize every dialect-specific statement. The following are rejected as unparseable (fail-closed):

- `MERGE`, `COPY`, `EXPLAIN`, `SELECT ... FOR UPDATE`
- `DELETE ... USING` (PostgreSQL)
- Writable CTEs (`WITH x AS (DELETE ... RETURNING ...) ...`)
- `CREATE MATERIALIZED VIEW`

This is a trade-off: refusing queries we can't safely analyze beats approving them on a guess.

### MSSQL parameters

The MSSQL adapter passes positional params as `@p0`, `@p1`, ... — your SQL must use that style, not `?`.

## Tools exposed to the agent

### `list_tables`
Input: none.  
Returns: `{ tables: string[] }` filtered to the allowlist.

### `describe_table`
Input: `{ table: string }`.  
Returns: `{ columns: Array<{ name, type, nullable, default? }> }` for SQL; sampled-field inference for Mongo.

### `execute_query` (SQL)
Input: `{ sql: string, params?: unknown[] }`.  
Returns: `{ rows: [...], truncated: boolean, returned: number }` for SELECT; `{ rowsAffected: number }` otherwise.

### `execute_query` (Mongo)
Input: `{ collection: string, operation: 'find'|'aggregate'|'insertOne'|... , filter?, update?, pipeline?, documents? }`.  
Returns: same shape as SQL.

## Development

```bash
npm install
npm test         # unit tests (67 tests)
npm run build    # -> dist/
npm run dev      # run from source (requires env vars)
```

## Integration testing

All adapters except SQLite (which uses in-memory) require running databases. A `docker-compose.yml` is provided:

```bash
docker compose up -d
# wait for all services to be healthy
docker compose ps
# run integration tests
TEST_INTEGRATION=1 npm test
# tear down
docker compose down -v
```

Ports used on the host:
- Postgres: 15432
- MySQL: 13306
- MSSQL: 11433
- MongoDB: 37017

Services run as user `dbward` / password `dbward` (MSSQL uses `sa` / `Dbward_Test_123!`) against a database/collection called `dbward_test`.

## License

MIT (to be added).
