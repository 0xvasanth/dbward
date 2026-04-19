export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
}

export interface SqlQuery {
  kind: 'sql';
  sql: string;
  params?: unknown[];
}

export interface MongoQuery {
  kind: 'mongo';
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

export type QueryRequest = SqlQuery | MongoQuery;

export interface QueryResult {
  rows?: unknown[];
  rowsAffected?: number;
  truncated?: boolean;
  returned?: number;
}

export interface DbAdapter {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTables(): Promise<string[]>;
  describeTable(table: string): Promise<ColumnInfo[]>;
  execute(query: QueryRequest): Promise<QueryResult>;
}
