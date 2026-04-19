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

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number
  ) {}

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
      if (r.command === 'SELECT') {
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
