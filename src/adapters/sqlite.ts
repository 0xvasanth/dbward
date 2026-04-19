import Database from 'better-sqlite3';
import type { ColumnInfo, DbAdapter, QueryRequest, QueryResult } from './types.js';
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
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
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
