import type { LogLevel } from './trace.js'
export type { LogLevel } from './trace.js'

/**
 * Production Logger — file output, level filtering, sampling, rotation
 */

export interface LoggerConfig {
  /** Minimum log level (default: 'info') */
  minLevel?: LogLevel
  /** Whether to also output to console (default: true in dev, false in prod) */
  console?: boolean
  /** Log file path (default: no file output) */
  filePath?: string
  /** Maximum log file size in bytes before rotation (default: 10MB) */
  maxFileSize?: number
  /** Number of rotated log files to keep (default: 3) */
  maxFiles?: number
  /** Sampling rate for debug/info logs: 1 = every, 10 = every 10th (default: 1) */
  samplingRate?: number
  /** Trace ID for correlation */
  traceId?: string
}

export interface LogEntry {
  level: LogLevel
  timestamp: number
  message: string
  data?: Record<string, unknown>
  traceId?: string
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export class StructuredLogger {
  private logs: LogEntry[] = []
  private minLevel: LogLevel
  private consoleOutput: boolean
  private filePath?: string
  private maxFileSize: number
  private maxFiles: number
  private samplingRate: number
  private traceId?: string
  private writeQueue: Promise<void> = Promise.resolve()
  private logCounts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }

  constructor(config?: LoggerConfig) {
    this.minLevel = config?.minLevel ?? 'info'
    this.consoleOutput = config?.console ?? (process.env.NODE_ENV !== 'production')
    this.filePath = config?.filePath
    this.maxFileSize = config?.maxFileSize ?? 10 * 1024 * 1024
    this.maxFiles = config?.maxFiles ?? 3
    this.samplingRate = config?.samplingRate ?? 1
    this.traceId = config?.traceId
  }

  debug(message: string, data?: Record<string, unknown>): void { this.log('debug', message, data) }
  info(message: string, data?: Record<string, unknown>): void { this.log('info', message, data) }
  warn(message: string, data?: Record<string, unknown>): void { this.log('warn', message, data) }
  error(message: string, data?: Record<string, unknown>): void { this.log('error', message, data) }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return

    // Sampling: only apply to debug and info
    if (level === 'debug' || level === 'info') {
      this.logCounts[level]++
      if (this.samplingRate > 1 && this.logCounts[level] % this.samplingRate !== 1) return
    }

    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      message,
      data,
      traceId: this.traceId,
    }
    this.logs.push(entry)

    const ts = new Date(entry.timestamp).toISOString().slice(11, 23)
    const prefix = `[${level.toUpperCase()}]`
    const dataStr = data ? ` ${JSON.stringify(data)}` : ''
    const output = `${prefix} ${ts} ${message}${dataStr}`

    if (this.consoleOutput) {
      switch (level) {
        case 'error': console.error(output); break
        case 'warn': console.warn(output); break
        default: console.log(output)
      }
    }

    // Async file write (queued to avoid race conditions)
    if (this.filePath) {
      this.writeQueue = this.writeQueue.then(() => this.writeToFile(entry)).catch(() => {})
    }
  }

  private async writeToFile(entry: LogEntry): Promise<void> {
    if (!this.filePath) return
    const { appendFile, stat, rename } = await import('fs/promises')
    const { existsSync } = await import('fs')

    // Check rotation
    try {
      if (existsSync(this.filePath)) {
        const stats = await stat(this.filePath)
        if (stats.size >= this.maxFileSize) {
          await this.rotateLogs()
        }
      }
    } catch { /* ignore rotation errors */ }

    const line = JSON.stringify(entry) + '\n'
    try {
      await appendFile(this.filePath, line, 'utf-8')
    } catch {
      // Directory might not exist
      const { mkdir } = await import('fs/promises')
      const { dirname } = await import('path')
      await mkdir(dirname(this.filePath), { recursive: true })
      await appendFile(this.filePath, line, 'utf-8')
    }
  }

  private async rotateLogs(): Promise<void> {
    if (!this.filePath) return
    const { rename, unlink } = await import('fs/promises')
    const { existsSync } = await import('fs')

    // Delete oldest
    const oldest = `${this.filePath}.${this.maxFiles}`
    if (existsSync(oldest)) await unlink(oldest).catch(() => {})

    // Shift: .3 → .4 (deleted above), .2 → .3, .1 → .2, base → .1
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = `${this.filePath}.${i}`
      const to = `${this.filePath}.${i + 1}`
      if (existsSync(from)) await rename(from, to).catch(() => {})
    }
    await rename(this.filePath, `${this.filePath}.1`).catch(() => {})
  }

  /** Get all logs (in-memory) */
  getLogs(level?: LogLevel): ReadonlyArray<LogEntry> {
    if (level) return this.logs.filter(l => l.level === level)
    return this.logs
  }

  /** Export as newline-delimited JSON */
  exportNDJSON(): string {
    return this.logs.map(l => JSON.stringify(l)).join('\n')
  }

  /** Clear in-memory logs */
  clear(): void {
    this.logs = []
  }

  /** Set trace ID */
  setTraceId(id: string): void {
    this.traceId = id
  }
}

/** Legacy console-only logger for tool context backward compat */
export class ConsoleToolLogger {
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
  state: any,
  workingDir: string,
  abortSignal: AbortSignal,
  approvalFn: (request: any) => Promise<any>,
): any {
  return {
    agentState: state,
    workingDir,
    abortSignal,
    askApproval: approvalFn,
    logger: new ConsoleToolLogger(),
  }
}
