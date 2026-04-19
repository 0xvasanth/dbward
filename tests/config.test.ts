import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('parses required vars for postgres', () => {
    const cfg = loadConfig({
      DB_TYPE: 'postgres',
      DB_URL: 'postgres://localhost/test',
      ALLOWED_TABLES: 'users,orders',
    });
    expect(cfg.dbType).toBe('postgres');
    expect(cfg.dbUrl).toBe('postgres://localhost/test');
    expect(cfg.allowlist).toEqual({ type: 'list', tables: new Set(['users', 'orders']) });
    expect(cfg.maxRows).toBe(1000);
    expect(cfg.queryTimeoutMs).toBe(30000);
    expect(cfg.readOnly).toBe(false);
  });

  it('normalizes wildcard allowlist', () => {
    const cfg = loadConfig({
      DB_TYPE: 'sqlite',
      DB_URL: ':memory:',
      ALLOWED_TABLES: '*',
    });
    expect(cfg.allowlist).toEqual({ type: 'wildcard' });
  });

  it('trims whitespace and lowercases SQL table names', () => {
    const cfg = loadConfig({
      DB_TYPE: 'mysql',
      DB_URL: 'mysql://localhost/test',
      ALLOWED_TABLES: ' Users , Orders ',
    });
    expect(cfg.allowlist).toEqual({
      type: 'list',
      tables: new Set(['users', 'orders']),
    });
  });

  it('preserves case for Mongo collections', () => {
    const cfg = loadConfig({
      DB_TYPE: 'mongodb',
      DB_URL: 'mongodb://localhost/test',
      ALLOWED_TABLES: 'Users,Orders',
    });
    expect(cfg.allowlist).toEqual({
      type: 'list',
      tables: new Set(['Users', 'Orders']),
    });
  });

  it('rejects missing DB_TYPE', () => {
    expect(() => loadConfig({ DB_URL: 'x', ALLOWED_TABLES: '*' })).toThrow();
  });

  it('rejects unknown DB_TYPE', () => {
    expect(() => loadConfig({ DB_TYPE: 'oracle', DB_URL: 'x', ALLOWED_TABLES: '*' })).toThrow();
  });

  it('rejects empty ALLOWED_TABLES', () => {
    expect(() =>
      loadConfig({ DB_TYPE: 'sqlite', DB_URL: ':memory:', ALLOWED_TABLES: '' }),
    ).toThrow();
  });

  it('respects MAX_ROWS, QUERY_TIMEOUT_MS, READ_ONLY', () => {
    const cfg = loadConfig({
      DB_TYPE: 'sqlite',
      DB_URL: ':memory:',
      ALLOWED_TABLES: '*',
      MAX_ROWS: '50',
      QUERY_TIMEOUT_MS: '5000',
      READ_ONLY: 'true',
    });
    expect(cfg.maxRows).toBe(50);
    expect(cfg.queryTimeoutMs).toBe(5000);
    expect(cfg.readOnly).toBe(true);
  });

  it('rejects non-numeric MAX_ROWS', () => {
    expect(() =>
      loadConfig({
        DB_TYPE: 'sqlite',
        DB_URL: ':memory:',
        ALLOWED_TABLES: '*',
        MAX_ROWS: 'abc',
      }),
    ).toThrow();
  });

  it('rejects partially-numeric MAX_ROWS', () => {
    expect(() =>
      loadConfig({
        DB_TYPE: 'sqlite',
        DB_URL: ':memory:',
        ALLOWED_TABLES: '*',
        MAX_ROWS: '100abc',
      }),
    ).toThrow();
  });
});
