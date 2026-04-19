import { describe, it, expect } from 'vitest';
import { extractTables, getStatementTypes } from '../src/sql-parse.js';

describe('extractTables (postgres dialect)', () => {
  const extract = (sql: string) => extractTables(sql, 'postgres');

  it('simple SELECT', () => {
    expect(extract('SELECT * FROM users')).toEqual(['users']);
  });

  it('JOIN', () => {
    expect(extract('SELECT * FROM users u JOIN orders o ON o.user_id = u.id').sort()).toEqual(['orders', 'users']);
  });

  it('subquery', () => {
    expect(extract('SELECT * FROM (SELECT id FROM users) u').sort()).toEqual(['users']);
  });

  it('CTE', () => {
    expect(
      extract('WITH x AS (SELECT * FROM users) SELECT * FROM x JOIN orders ON orders.id = x.id').sort()
    ).toEqual(expect.arrayContaining(['users', 'orders']));
  });

  it('UNION', () => {
    expect(
      extract('SELECT id FROM users UNION SELECT id FROM orders').sort()
    ).toEqual(['orders', 'users']);
  });

  it('INSERT', () => {
    expect(extract("INSERT INTO users (name) VALUES ('x')")).toEqual(['users']);
  });

  it('UPDATE', () => {
    expect(extract("UPDATE users SET name='x' WHERE id=1")).toEqual(['users']);
  });

  it('DELETE', () => {
    expect(extract('DELETE FROM users WHERE id=1')).toEqual(['users']);
  });

  it('CREATE TABLE', () => {
    expect(extract('CREATE TABLE foo (id INT)')).toEqual(['foo']);
  });

  it('ALTER TABLE', () => {
    expect(extract('ALTER TABLE foo ADD COLUMN x INT')).toEqual(['foo']);
  });

  it('DROP TABLE', () => {
    expect(extract('DROP TABLE foo')).toEqual(['foo']);
  });

  it('schema-qualified names', () => {
    expect(extract('SELECT * FROM public.users')).toEqual(['users']);
  });

  it('multi-statement returns union of tables', () => {
    expect(
      extract('SELECT * FROM users; DELETE FROM orders').sort()
    ).toEqual(['orders', 'users']);
  });

  it('throws on unparseable SQL', () => {
    expect(() => extract('this is not sql at all ;;;')).toThrow();
  });

  it('CREATE INDEX extracts target table', () => {
    expect(extract('CREATE INDEX ix ON secrets (id)')).toContain('secrets');
  });

  it('DROP INDEX extracts target table (MySQL dialect)', () => {
    expect(extractTables('DROP INDEX ix ON secrets', 'mysql')).toContain('secrets');
  });

  it('ALTER TABLE ... RENAME TO extracts both tables', () => {
    const result = extract('ALTER TABLE a RENAME TO b');
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  it('GRANT extracts target table', () => {
    expect(extract('GRANT SELECT ON secrets TO public')).toContain('secrets');
  });

  it('CREATE TRIGGER extracts target table', () => {
    const sql = "CREATE TRIGGER trg BEFORE INSERT ON secrets FOR EACH ROW EXECUTE FUNCTION f()";
    expect(extract(sql)).toContain('secrets');
  });

  it('CREATE VIEW extracts target view name', () => {
    expect(extract('CREATE VIEW secrets AS SELECT 1')).toContain('secrets');
  });

  it('CREATE OR REPLACE VIEW extracts target view name', () => {
    expect(extract('CREATE OR REPLACE VIEW secrets AS SELECT 1')).toContain('secrets');
  });

  it('DROP VIEW extracts target view name', () => {
    expect(extract('DROP VIEW secrets')).toContain('secrets');
  });
});

describe('getStatementTypes', () => {
  it('classifies SELECT as read', () => {
    expect(getStatementTypes('SELECT 1', 'postgres')).toEqual(['select']);
  });

  it('classifies INSERT as write', () => {
    expect(getStatementTypes("INSERT INTO users VALUES ('x')", 'postgres')).toEqual(['insert']);
  });

  it('classifies multi-statement with mixed types', () => {
    const types = getStatementTypes('SELECT 1; DELETE FROM x', 'postgres');
    expect(types).toContain('select');
    expect(types).toContain('delete');
  });
});
