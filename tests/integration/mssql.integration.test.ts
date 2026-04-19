import { describe, it } from 'vitest';

const runContainers = process.env.TEST_INTEGRATION === '1';

describe.skipIf(!runContainers)('mssql integration (container)', () => {
  it.todo('end-to-end tool pipeline against MSSQL via testcontainers');
});
