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

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number
  ) {}

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
      return (
        rows as Array<{
          name: string;
          type: string;
          nullable: string;
          dflt: string | null;
        }>
      ).map((r) => ({
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
