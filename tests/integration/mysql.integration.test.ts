import { describe, it } from 'vitest';

const runContainers = process.env.TEST_INTEGRATION === '1';

describe.skipIf(!runContainers)('mysql integration (container)', () => {
  it.todo('end-to-end tool pipeline against MySQL via testcontainers');
});
