import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { DbAdapter } from './adapters/types.js';
import type { Config } from './config.js';
import { listTablesHandler } from './tools/list-tables.js';
import { describeTableHandler } from './tools/describe-table.js';
import { executeQueryHandler } from './tools/execute-query.js';
import { ToolError } from './errors.js';

function executeQuerySchema(dbType: Config['dbType']) {
  if (dbType === 'mongodb') {
    return {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        operation: {
          type: 'string',
          enum: [
            'find',
            'aggregate',
            'insertOne',
            'insertMany',
            'updateOne',
            'updateMany',
            'deleteOne',
            'deleteMany',
            'countDocuments',
          ],
        },
        filter: { type: 'object' },
        update: { type: 'object' },
        pipeline: { type: 'array', items: { type: 'object' } },
        documents: { type: 'array', items: { type: 'object' } },
      },
      required: ['collection', 'operation'],
    };
  }
  return {
    type: 'object',
    properties: {
      sql: { type: 'string' },
      params: { type: 'array' },
    },
    required: ['sql'],
  };
}

export function buildServer(adapter: DbAdapter, config: Config): Server {
  const server = new Server({ name: 'dbward', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_tables',
        description:
          'List tables (or collections) visible to this MCP, filtered by the configured allowlist.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'describe_table',
        description:
          'Return column/field info for the given table. Rejected if table is not in the allowlist.',
        inputSchema: {
          type: 'object',
          properties: { table: { type: 'string' } },
          required: ['table'],
        },
      },
      {
        name: 'execute_query',
        description:
          config.dbType === 'mongodb'
            ? 'Run a Mongo operation against the configured collection. Allowlist enforced on the collection arg.'
            : 'Run a SQL query. All referenced tables are extracted and checked against the allowlist before execution.',
        inputSchema: executeQuerySchema(config.dbType),
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      let result: unknown;
      switch (req.params.name) {
        case 'list_tables':
          result = await listTablesHandler(adapter, config);
          break;
        case 'describe_table':
          result = await describeTableHandler(adapter, config, {
            table: String(args.table ?? ''),
          });
          break;
        case 'execute_query':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await executeQueryHandler(adapter, config, args as any);
          break;
        default:
          throw new ToolError(`Unknown tool: ${req.params.name}`);
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: msg }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startServer(adapter: DbAdapter, config: Config) {
  const server = buildServer(adapter, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function connectServer(adapter: DbAdapter, config: Config, transport: Transport) {
  const server = buildServer(adapter, config);
  await server.connect(transport);
  return server;
}
