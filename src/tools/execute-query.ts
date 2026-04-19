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
