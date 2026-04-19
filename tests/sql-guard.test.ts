import { describe, it, expect } from 'vitest';
import { checkSqlAllowed } from '../src/sql-guard.js';
import type { Config } from '../src/config.js';

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    dbType: 'postgres',
    dbUrl: 'x',
    allowlist: { type: 'list', tables: new Set(['users', 'orders']) },
    maxRows: 1000,
    queryTimeoutMs: 30000,
    readOnly: false,
    ...overrides,
  };
}

describe('checkSqlAllowed', () => {
  it('passes when all tables allowed', () => {
    expect(checkSqlAllowed('SELECT * FROM users', cfg())).toEqual({ ok: true });
  });

  it('rejects when any table disallowed', () => {
    const r = checkSqlAllowed('SELECT * FROM users JOIN secrets ON 1=1', cfg());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/secrets/);
  });

  it('rejects unparseable SQL', () => {
    const r = checkSqlAllowed('not valid sql ;;', cfg());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/parse/i);
  });

  it('wildcard skips table check', () => {
    expect(
      checkSqlAllowed('SELECT * FROM anything', cfg({ allowlist: { type: 'wildcard' } }))
    ).toEqual({ ok: true });
  });

  it('READ_ONLY rejects INSERT', () => {
    const r = checkSqlAllowed(
      "INSERT INTO users (name) VALUES ('x')",
      cfg({ readOnly: true })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/read.?only/i);
  });

  it('READ_ONLY allows SELECT', () => {
    expect(
      checkSqlAllowed('SELECT * FROM users', cfg({ readOnly: true }))
    ).toEqual({ ok: true });
  });

  it('rejects multi-statement if any statement disallowed', () => {
    const r = checkSqlAllowed(
      'SELECT * FROM users; DELETE FROM secrets',
      cfg()
    );
    expect(r.ok).toBe(false);
  });

  it('case-insensitive (schema-qualified)', () => {
    expect(
      checkSqlAllowed('SELECT * FROM public.USERS', cfg())
    ).toEqual({ ok: true });
  });
});
