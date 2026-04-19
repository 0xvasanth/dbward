import { z } from 'zod';

export type DbType = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'mongodb';

export type Allowlist =
  | { type: 'wildcard' }
  | { type: 'list'; tables: Set<string> };

export interface Config {
  dbType: DbType;
  dbUrl: string;
  allowlist: Allowlist;
  maxRows: number;
  queryTimeoutMs: number;
  readOnly: boolean;
}

const envSchema = z.object({
  DB_TYPE: z.enum(['postgres', 'mysql', 'sqlite', 'mssql', 'mongodb']),
  DB_URL: z.string().min(1),
  ALLOWED_TABLES: z.string().min(1),
  MAX_ROWS: z.coerce.number().int().positive().default(1000),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  READ_ONLY: z.string().optional(),
});

function parseAllowlist(raw: string, dbType: DbType): Allowlist {
  const trimmed = raw.trim();
  if (trimmed === '*') return { type: 'wildcard' };
  const parts = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error('ALLOWED_TABLES must contain at least one table or "*"');
  }
  const normalize = (s: string) => (dbType === 'mongodb' ? s : s.toLowerCase());
  return { type: 'list', tables: new Set(parts.map(normalize)) };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    dbType: parsed.DB_TYPE,
    dbUrl: parsed.DB_URL,
    allowlist: parseAllowlist(parsed.ALLOWED_TABLES, parsed.DB_TYPE),
    maxRows: parsed.MAX_ROWS,
    queryTimeoutMs: parsed.QUERY_TIMEOUT_MS,
    readOnly: parsed.READ_ONLY === 'true',
  };
}
