import type { StepInfo } from './types.js'

// ─── Trace Types ────────────────────────────────────────────────────────────

export interface TraceEntry {
  type: 'step' | 'tool_call' | 'tool_result' | 'llm_call' | 'compression' | 'skill' | 'provider_fallback'
  timestamp: number
  data: Record<string, unknown>
}

export interface Trace {
  id: string
  startTime: number
  endTime: number
  entries: TraceEntry[]
  steps: StepInfo[]
  totalTokens: number
  totalCost: number
  provider: string
}

// ─── Trace Collector ────────────────────────────────────────────────────────

export class TraceCollector {
  private entries: TraceEntry[] = []
  private startTime = Date.now()
  private traceId: string
  private providerId: string

  constructor(providerId: string) {
    this.traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.providerId = providerId
  }

  /** Record a trace entry */
  record(type: TraceEntry['type'], data: Record<string, unknown>): void {
    this.entries.push({ type, timestamp: Date.now(), data })
  }

  /** Build final trace snapshot */
  buildTrace(steps: StepInfo[], totalTokens: number, totalCost: number): Trace {
    return {
      id: this.traceId,
      startTime: this.startTime,
      endTime: Date.now(),
      entries: this.entries,
      steps,
      totalTokens,
      totalCost,
      provider: this.providerId,
    }
  }

  /** Reset for new run */
  reset(providerId?: string): void {
    this.entries = []
    this.startTime = Date.now()
    this.traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    if (providerId) this.providerId = providerId
  }

  /** Get raw entries (for streaming consumption) */
  getEntries(): ReadonlyArray<TraceEntry> {
    return this.entries
  }
}

// ─── Trace Replay ───────────────────────────────────────────────────────────

export class TraceReplay {
  constructor(private trace: Trace) {}

  /** Replay trace step by step */
  async replay(options?: {
    onStep?: (entry: TraceEntry, index: number) => void
    delayMs?: number
  }): Promise<void> {
    const delay = options?.delayMs ?? 100
    for (let i = 0; i < this.trace.entries.length; i++) {
      const entry = this.trace.entries[i]
      options?.onStep?.(entry, i)
      if (delay > 0 && i < this.trace.entries.length - 1) {
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  /** Get summary string */
  summary(): string {
    const lines: string[] = [
      `Trace: ${this.trace.id}`,
      `Provider: ${this.trace.provider}`,
      `Duration: ${this.trace.endTime - this.trace.startTime}ms`,
      `Steps: ${this.trace.steps.length}`,
      `Tokens: ${this.trace.totalTokens}`,
      `Cost: $${this.trace.totalCost.toFixed(4)}`,
      '',
    ]

    for (const entry of this.trace.entries) {
      const ts = new Date(entry.timestamp).toISOString().slice(11, 23)
      switch (entry.type) {
        case 'step':
          lines.push(`[${ts}] STEP #${entry.data.step}`)
          break
        case 'tool_call':
          lines.push(`[${ts}] 🔧 ${entry.data.tool}(${JSON.stringify(entry.data.args)?.slice(0, 80)})`)
          break
        case 'tool_result':
          lines.push(`[${ts}] 📤 ${entry.data.tool}: ${entry.data.error ? `❌ ${entry.data.error}` : '✅'}`)
          break
        case 'llm_call':
          lines.push(`[${ts}] 🤖 LLM call (${entry.data.tokens} tokens)`)
          break
        case 'compression':
          lines.push(`[${ts}] 🗜️ Context compressed`)
          break
        case 'skill':
          lines.push(`[${ts}] ⚡ Skill ${entry.data.action}: ${entry.data.name}`)
          break
        case 'provider_fallback':
          lines.push(`[${ts}] 🔄 Fallback: ${entry.data.from} → next (${entry.data.error})`)
          break
      }
    }

    return lines.join('\n')
  }

  /** Export as JSON */
  toJSON(): string {
    return JSON.stringify(this.trace, null, 2)
  }
}

// ─── Structured Logger ───────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  timestamp: number
  message: string
  data?: Record<string, unknown>
  traceId?: string
}

export class StructuredLogger {
  private logs: LogEntry[] = []
  private minLevel: LogLevel
  private traceId?: string

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  constructor(options?: { minLevel?: LogLevel; traceId?: string }) {
    this.minLevel = options?.minLevel ?? 'info'
    this.traceId = options?.traceId
  }

  debug(message: string, data?: Record<string, unknown>): void { this.log('debug', message, data) }
  info(message: string, data?: Record<string, unknown>): void { this.log('info', message, data) }
  warn(message: string, data?: Record<string, unknown>): void { this.log('warn', message, data) }
  error(message: string, data?: Record<string, unknown>): void { this.log('error', message, data) }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (this.levelPriority[level] < this.levelPriority[this.minLevel]) return

    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      message,
      data,
      traceId: this.traceId,
    }
    this.logs.push(entry)

    // Also output to console in dev
    const prefix = `[${level.toUpperCase()}]`
    const ts = new Date(entry.timestamp).toISOString().slice(11, 23)
    const dataStr = data ? ` ${JSON.stringify(data)}` : ''
    const output = `${prefix} ${ts} ${message}${dataStr}`
    
    switch (level) {
      case 'error': console.error(output); break
      case 'warn': console.warn(output); break
      default: console.log(output)
    }
  }

  /** Get all logs */
  getLogs(level?: LogLevel): ReadonlyArray<LogEntry> {
    if (level) return this.logs.filter(l => l.level === level)
    return this.logs
  }

  /** Export logs as newline-delimited JSON */
  exportNDJSON(): string {
    return this.logs.map(l => JSON.stringify(l)).join('\n')
  }

  /** Clear logs */
  clear(): void {
    this.logs = []
  }

  /** Set trace ID for correlation */
  setTraceId(id: string): void {
    this.traceId = id
  }
}
