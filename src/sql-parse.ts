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
  // tableList() (v5.4) misses some DDL statements (notably ALTER TABLE), so
  // we also walk the AST and harvest any table references we find there.
  const ast = parser.astify(sql, { database });
  const asts = Array.isArray(ast) ? ast : [ast];
  for (const node of asts) {
    for (const name of tablesFromAst(node)) {
      names.add(name.toLowerCase());
    }
  }
  return [...names];
}

type TableRef = { table?: string | null };

function tablesFromAst(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const out: string[] = [];
  const n = node as Record<string, unknown>;
  // ALTER TABLE: { type: 'alter', table: [{db, table}] }
  // DROP TABLE: { type: 'drop', name: [{db, table}] }
  // CREATE TABLE: { type: 'create', table: [{db, table}] }
  for (const key of ['table', 'name']) {
    const val = n[key];
    if (Array.isArray(val)) {
      for (const ref of val) {
        const t = (ref as TableRef)?.table;
        if (typeof t === 'string' && t.length > 0) out.push(t);
      }
    }
  }
  return out;
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
