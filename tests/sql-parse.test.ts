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
