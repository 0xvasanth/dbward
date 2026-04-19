import sql from 'mssql';
import type { ColumnInfo, DbAdapter, QueryRequest, QueryResult } from './types.js';
import { sanitizeDriverError } from '../errors.js';

export class MssqlAdapter implements DbAdapter {
  private pool: sql.ConnectionPool | null = null;

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async connect(): Promise<void> {
    // mssql ConnectionPool accepts either a config object or a connection
    // string. Timeout is honored per-request on the Request instance in v11+;
    // we keep timeoutMs around for that purpose.
    void this.timeoutMs;
    this.pool = new sql.ConnectionPool(this.url);
    await this.pool.connect();
  }

  async close(): Promise<void> {
    await this.pool?.close();
    this.pool = null;
  }

  async listTables(): Promise<string[]> {
    const p = this.require();
    const r = await p.request().query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' ORDER BY table_name`,
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
           ORDER BY ordinal_position`,
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
      // Bind positional params as @p0, @p1, ... the user's SQL must use @p0 syntax.
      (q.params ?? []).forEach((v, i) => req.input(`p${i}`, v as never));
      const result = await req.query(q.sql);
      // Heuristic: if recordset has rows, it's a SELECT
      if (result.recordset && result.recordset.length > 0) {
        return { rows: result.recordset };
      }
      const affected = Array.isArray(result.rowsAffected)
        ? result.rowsAffected.reduce((a, b) => a + b, 0)
        : 0;
      if (affected > 0 || !result.recordset) {
        return { rowsAffected: affected };
      }
      // Empty SELECT result
      return { rows: [] };
    } catch (err) {
      throw sanitizeDriverError(err, 'execute');
    }
  }

  private require(): sql.ConnectionPool {
    if (!this.pool) throw new Error('MssqlAdapter: not connected');
    return this.pool;
  }
}
