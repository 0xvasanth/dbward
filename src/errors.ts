export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function sanitizeDriverError(err: unknown, context: string): ToolError {
  const raw = err instanceof Error ? err : new Error(String(err));
  console.error(`[dbward] ${context}:`, raw.stack ?? raw.message);
  return new ToolError(`${context}: ${raw.message}`);
}
