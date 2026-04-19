#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createAdapter } from './adapters/factory.js';
import { startServer } from './server.js';

async function main() {
  const config = loadConfig();
  const adapter = await createAdapter(config);
  await adapter.connect();

  const shutdown = async () => {
    await adapter.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await startServer(adapter, config);
}

main().catch((err) => {
  console.error('[dbward] fatal:', err);
  process.exit(1);
});
