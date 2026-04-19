import pkg from 'node-sql-parser';
import type { DbType } from './config.js';

const { Parser } = pkg;
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
  const ast = parser.astify(sql, { database });
  const asts = Array.isArray(ast) ? ast : [ast];
  const names = new Set<string>();
  const collected: string[] = [];
  for (const node of asts) {
    harvestTables(node, collected);
  }
  for (const name of collected) {
    if (name.length > 0) names.add(name.toLowerCase());
  }
  return [...names];
}

/**
 * Recursively walk the AST and harvest every table reference. node-sql-parser
 * is inconsistent: some statements put targets at `.table` as `[{db, table}]`
 * arrays, some as a singular `{db, table}` object, and ALTER's RENAME TO puts
 * the target as a bare string at `expr[].table`. A fully recursive walker that
 * collects any string-valued `table` property covers all shapes.
 *
 * For `column_ref` nodes (`o.id` -> `{type:'column_ref', table:'o', column:'id'}`)
 * we skip ONLY the node's own `table` field (it's an alias, not a real table),
 * but still recurse into the rest of its children — Postgres UPDATE set-list
 * entries are column_refs whose `value.ast` carries the assigned expression,
 * which may include subqueries referencing forbidden tables.
 * GRANT statements are handled specially because node-sql-parser places the
 * target at `on.priv_level[].name` rather than anywhere called `table`.
 */
function harvestTables(node: unknown, out: string[], visited: WeakSet<object> = new WeakSet()): void {
  if (!node || typeof node !== 'object') return;
  if (visited.has(node)) return;
  visited.add(node);
  if (Array.isArray(node)) {
    for (const item of node) harvestTables(item, out, visited);
    return;
  }
  const n = node as Record<string, unknown>;

  // column_ref nodes (`o.id` -> {type:'column_ref', table:'o', column:'id'})
  // carry an ALIAS at `table`, not a real table ref. We must NOT harvest that
  // field, but we still have to recurse into the node's other children — e.g.
  // in Postgres, UPDATE set-list entries are column_ref nodes whose assigned
  // value's AST lives at `value.ast`, which can contain subqueries referencing
  // forbidden tables. Previously we short-circuited here and missed them.
  const isColumnRef = n.type === 'column_ref';

  // Direct table-as-string at this node (covers ALTER RENAME TO's expr[].table
  // as well as the inner `table: 'x'` inside a {db, table} ref object). Skip
  // for column_ref since its `table` field is an alias.
  if (!isColumnRef && typeof n.table === 'string' && n.table.length > 0) {
    out.push(n.table);
  }

  // GRANT target lives at on.priv_level[].name, not anywhere named `table`.
  if (n.type === 'grant' && n.on && typeof n.on === 'object') {
    const privLevel = (n.on as Record<string, unknown>).priv_level;
    if (Array.isArray(privLevel)) {
      for (const p of privLevel) {
        if (p && typeof p === 'object') {
          const name = (p as Record<string, unknown>).name;
          if (typeof name === 'string' && name.length > 0) {
            out.push(name);
          }
        }
      }
    }
  }

  // CREATE VIEW target lives at view.view (not view.table).
  if (n.type === 'create' && n.keyword === 'view' && n.view && typeof n.view === 'object') {
    const viewName = (n.view as Record<string, unknown>).view;
    if (typeof viewName === 'string' && viewName.length > 0) {
      out.push(viewName);
    }
  }

  for (const [k, v] of Object.entries(n)) {
    // For column_ref: skip the alias `table` field, but still walk siblings
    // like `value.ast` where subqueries hide.
    if (isColumnRef && k === 'table') continue;
    harvestTables(v, out, visited);
  }
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
