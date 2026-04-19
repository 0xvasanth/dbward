import { describe, it, expect } from 'vitest';
import { isAllowed } from '../src/allowlist.js';
import type { Allowlist } from '../src/config.js';

describe('isAllowed', () => {
  it('wildcard allows anything', () => {
    const a: Allowlist = { type: 'wildcard' };
    expect(isAllowed(a, 'users', 'sql')).toBe(true);
    expect(isAllowed(a, 'anything', 'sql')).toBe(true);
  });

  it('list matches case-insensitively for sql', () => {
    const a: Allowlist = { type: 'list', tables: new Set(['users', 'orders']) };
    expect(isAllowed(a, 'USERS', 'sql')).toBe(true);
    expect(isAllowed(a, 'Users', 'sql')).toBe(true);
    expect(isAllowed(a, 'secrets', 'sql')).toBe(false);
  });

  it('list matches case-sensitively for mongo', () => {
    const a: Allowlist = { type: 'list', tables: new Set(['Users', 'Orders']) };
    expect(isAllowed(a, 'Users', 'mongo')).toBe(true);
    expect(isAllowed(a, 'users', 'mongo')).toBe(false);
  });
});
