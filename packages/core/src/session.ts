/**
 * Session Manager — concurrency safety + user-scoped data isolation
 *
 * Guarantees:
 * 1. Same Agent instance can serve multiple users concurrently
 * 2. Each user gets isolated messages, memory, state
 * 3. Same user gets concurrent lock (queue, not crash)
 * 4. Sessions persist to disk and can be restored
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import type { CoreMessage } from 'ai'
import type { AgentState } from './types.js'
import { AgentError } from './errors.js'

// ─── Types ─────────────────────────────────────────────────────────

export interface SessionData {
  sessionId: string
  userId: string
  messages: CoreMessage[]
  state: AgentState
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown>
}

export interface SessionConfig {
  /** Directory for session persistence (default: ./sessions) */
  storageDir: string
  /** Whether to persist sessions to disk (default: true) */
  persist: boolean
  /** Auto-save interval in ms (0 = disabled, default: 30000) */
  autoSaveIntervalMs: number
  /** Maximum concurrent runs per user (default: 1 — queue) */
  maxConcurrentPerUser: number
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  storageDir: './sessions',
  persist: true,
  autoSaveIntervalMs: 30_000,
  maxConcurrentPerUser: 1,
}

// ─── Per-User Session Store ────────────────────────────────────────

class UserSession {
  readonly userId: string
  readonly sessionId: string
  messages: CoreMessage[] = []
  state: AgentState
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown> = {}

  /** Queue of pending runs — ensures serial execution per user */
  private runQueue: Array<() => void> = []
  private running = false

  constructor(userId: string, sessionId?: string) {
    this.userId = userId
    this.sessionId = sessionId ?? `sess_${userId}_${Date.now()}`
    this.state = this.createInitialState()
    this.createdAt = Date.now()
    this.updatedAt = Date.now()
  }

  /** Acquire run lock — returns a release function */
  async acquire(): Promise<() => void> {
    if (!this.running) {
      this.running = true
      return () => this.release()
    }
    // Wait in queue
    return new Promise<() => void>((resolve) => {
      this.runQueue.push(() => {
        this.running = true
        resolve(() => this.release())
      })
    })
  }

  private release(): void {
    this.running = false
    this.updatedAt = Date.now()
    const next = this.runQueue.shift()
    if (next) next()
  }

  private createInitialState(): AgentState {
    return {
      step: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      startTime: Date.now(),
      toolCallCount: 0,
      aborted: false,
      messages: [],
    }
  }

  resetState(): void {
    this.state = this.createInitialState()
    this.messages = []
    this.updatedAt = Date.now()
  }

  toData(): SessionData {
    return {
      sessionId: this.sessionId,
      userId: this.userId,
      messages: [...this.messages],
      state: { ...this.state },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: { ...this.metadata },
    }
  }

  static fromData(data: SessionData): UserSession {
    const sess = new UserSession(data.userId, data.sessionId)
    sess.messages = data.messages
    sess.state = data.state
    sess.createdAt = data.createdAt
    sess.updatedAt = data.updatedAt
    sess.metadata = data.metadata
    return sess
  }
}

// ─── Session Manager ───────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, UserSession>()  // sessionId → UserSession
  private userIndex = new Map<string, Set<string>>()  // userId → sessionIds
  private config: SessionConfig
  private autoSaveTimer?: ReturnType<typeof setInterval>

  constructor(config?: Partial<SessionConfig>) {
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config }
    if (this.config.autoSaveIntervalMs > 0 && this.config.persist) {
      this.autoSaveTimer = setInterval(() => this.saveAll(), this.config.autoSaveIntervalMs)
    }
  }

  /** Create or get a session for a user */
  createSession(userId: string, sessionId?: string): UserSession {
    const id = sessionId ?? `sess_${userId}_${Date.now()}`
    const existing = this.sessions.get(id)
    if (existing) return existing

    const session = new UserSession(userId, id)
    this.sessions.set(id, session)

    if (!this.userIndex.has(userId)) {
      this.userIndex.set(userId, new Set())
    }
    this.userIndex.get(userId)!.add(id)

    return session
  }

  /** Get session by ID */
  getSession(sessionId: string): UserSession | undefined {
    return this.sessions.get(sessionId)
  }

  /** Get all sessions for a user */
  getUserSessions(userId: string): UserSession[] {
    const ids = this.userIndex.get(userId)
    if (!ids) return []
    return Array.from(ids)
      .map(id => this.sessions.get(id))
      .filter((s): s is UserSession => s !== undefined)
  }

  /** Get or create the latest session for a user */
  getLatestSession(userId: string): UserSession {
    const sessions = this.getUserSessions(userId)
    if (sessions.length === 0) return this.createSession(userId)

    // Return most recently updated
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    return sessions[0]
  }

  /** Run a function with session lock (concurrent-safe) */
  async withSession<T>(userId: string, fn: (session: UserSession) => Promise<T>): Promise<T> {
    const session = this.getLatestSession(userId)
    const release = await session.acquire()
    try {
      const result = await fn(session)
      if (this.config.persist) await this.saveSession(session)
      return result
    } catch (err) {
      if (this.config.persist) await this.saveSession(session) // save state even on error
      throw err
    } finally {
      release()
    }
  }

  /** Delete a session */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.sessions.delete(sessionId)
    const userSessions = this.userIndex.get(session.userId)
    if (userSessions) {
      userSessions.delete(sessionId)
      if (userSessions.size === 0) this.userIndex.delete(session.userId)
    }

    // Delete persisted file
    if (this.config.persist) {
      const filePath = this.getSessionPath(sessionId)
      if (existsSync(filePath)) {
        const { unlink } = await import('fs/promises')
        await unlink(filePath).catch(() => {})
      }
    }
  }

  // ─── Persistence ─────────────────────────────────────────────────

  /** Save a single session to disk */
  async saveSession(session: UserSession): Promise<void> {
    if (!this.config.persist) return
    const filePath = this.getSessionPath(session.sessionId)
    const dir = dirname(filePath)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFile(filePath, JSON.stringify(session.toData(), null, 2), 'utf-8')
  }

  /** Save all active sessions */
  async saveAll(): Promise<void> {
    if (!this.config.persist) return
    const saves = Array.from(this.sessions.values()).map(s => this.saveSession(s).catch(() => {}))
    await Promise.all(saves)
  }

  /** Load a session from disk */
  async loadSession(sessionId: string): Promise<UserSession | null> {
    const filePath = this.getSessionPath(sessionId)
    if (!existsSync(filePath)) return null

    try {
      const data = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(data) as SessionData
      const session = UserSession.fromData(parsed)
      this.sessions.set(sessionId, session)

      if (!this.userIndex.has(session.userId)) {
        this.userIndex.set(session.userId, new Set())
      }
      this.userIndex.get(session.userId)!.add(sessionId)

      return session
    } catch {
      throw new AgentError({
        code: 'SESSION_CORRUPTION',
        message: `Session file corrupted: ${sessionId}`,
        context: { sessionId },
      })
    }
  }

  /** Load all sessions from storage directory */
  async loadAllSessions(): Promise<number> {
    if (!existsSync(this.config.storageDir)) return 0

    const { readdir } = await import('fs/promises')
    const files = await readdir(this.config.storageDir)
    let loaded = 0

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const sessionId = file.replace('.json', '')
      try {
        await this.loadSession(sessionId)
        loaded++
      } catch { /* skip corrupted */ }
    }

    return loaded
  }

  /** Graceful shutdown — save all and stop timer */
  async shutdown(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer)
      this.autoSaveTimer = undefined
    }
    await this.saveAll()
  }

  private getSessionPath(sessionId: string): string {
    return join(this.config.storageDir, `${sessionId}.json`)
  }
}
