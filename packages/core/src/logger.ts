import type { ToolLogger, ToolContext, AgentStateSnapshot } from '@agentnova/tools'

/** Simple console logger implementation */
export class ConsoleToolLogger implements ToolLogger {
  constructor(private prefix: string = 'AgentNova') {}

  info(message: string, data?: Record<string, unknown>): void {
    console.log(`[${this.prefix}] INFO: ${message}`, data ?? '')
  }

  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(`[${this.prefix}] WARN: ${message}`, data ?? '')
  }

  error(message: string, data?: Record<string, unknown>): void {
    console.error(`[${this.prefix}] ERROR: ${message}`, data ?? '')
  }
}

/** Create a ToolContext for tool execution */
export function createToolContext(
  state: AgentStateSnapshot,
  workingDir: string,
  abortSignal: AbortSignal,
  approvalFn: (request: any) => Promise<any>,
): ToolContext {
  return {
    agentState: state,
    workingDir,
    abortSignal,
    askApproval: approvalFn,
    logger: new ConsoleToolLogger(),
  }
}
