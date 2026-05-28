/**
 * Memory System — Production-grade three-layer memory with importance decay
 *
 * Layer 1: WorkingMemory   — in-memory, per-session, ephemeral
 * Layer 2: ProjectMemory   — file-based (AGENT.md), persists across sessions
 * Layer 3: LongTermMemory  — SQLite + semantic search, with importance scoring & decay
 */

export type { MemoryItem, MemoryStore } from './types.js'

import type { MemoryItem, MemoryStore } from './types.js'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

// ─── Importance & Decay ────────────────────────────────────────────

/**
 * Memory importance signals — determines how quickly a memory decays
 * and whether it should be proactively evicted.
 */
export type ImportanceLevel = 'critical' | 'high' | 'normal' | 'low'

/** Half-life in hours for each importance level */
export const IMPORTANCE_HALFLIFE: Record<ImportanceLevel, number> = {
  critical: Infinity,  // never decays — user preferences, core instructions
  high: 720,           // 30 days — project decisions, error resolutions
  normal: 168,         // 7 days — current task context
  low: 24,             // 1 day — ephemeral observations
}

/** Base score for each importance level */
export const IMPORTANCE_BASE_SCORE: Record<ImportanceLevel, number> = {
  critical: 1.0,
  high: 0.8,
  normal: 0.5,
  low: 0.2,
}

/**
 * Calculate time-decayed relevance score.
 * Uses exponential decay: score = base * 0.5 ^ (age_hours / halflife)
 */
export function decayedScore(
  importance: ImportanceLevel,
  timestamp: number,
  now: number = Date.now(),
): number {
  const base = IMPORTANCE_BASE_SCORE[importance]
  const halflife = IMPORTANCE_HALFLIFE[importance]
  if (halflife === Infinity) return base  // critical items never decay
  const ageHours = (now - timestamp) / (1000 * 60 * 60)
  return base * Math.pow(0.5, ageHours / halflife)
}

/** Auto-classify importance from content heuristics */
export function classifyImportance(content: string, key: string): ImportanceLevel {
  const lower = `${key} ${content}`.toLowerCase()

  // Critical: user preferences, identity, rules
  if (/\b(always|never|must|prefer|i want|i like|i use|rule|policy)\b/.test(lower)) {
    return 'critical'
  }

  // High: errors resolved, architectural decisions, file paths
  if (/\b(fixed|resolved|decided|architecture|config|\.ts|\.js|\.json|src\/|packages\/)\b/.test(lower)) {
    return 'high'
  }

  // Low: trivial observations
  if (content.length < 30 || /^(note:|fyi:|btw:)/i.test(lower)) {
    return 'low'
  }

  return 'normal'
}

// ─── Working Memory (Layer 1) ──────────────────────────────────────

export class WorkingMemory implements MemoryStore {
  private store = new Map<string, MemoryItem>()

  async save(key: string, content: string, metadata?: Record<string, string>): Promise<void> {
    this.store.set(key, { key, content, metadata, timestamp: Date.now() })
  }

  async get(key: string): Promise<MemoryItem | null> {
    return this.store.get(key) ?? null
  }

  async search(query: string, topK = 5): Promise<MemoryItem[]> {
    const q = query.toLowerCase()
    return Array.from(this.store.values())
      .map(item => ({
        ...item,
        relevanceScore: this.keywordScore(item, q),
      }))
      .filter(item => item.relevanceScore > 0)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, topK)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  clear(): void {
    this.store.clear()
  }

  private keywordScore(item: MemoryItem, query: string): number {
    const text = `${item.key} ${item.content}`.toLowerCase()
    const words = query.split(/\s+/).filter(Boolean)
    return words.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0)
  }
}

// ─── Project Memory (Layer 2) ──────────────────────────────────────

export class ProjectMemory implements MemoryStore {
  private memories = new Map<string, MemoryItem>()

  constructor(private projectDir: string) {}

  /** Load memories from AGENT.md file */
  async load(): Promise<void> {
    const agentMdPath = join(this.projectDir, 'AGENT.md')
    if (!existsSync(agentMdPath)) return

    const content = await readFile(agentMdPath, 'utf-8')
    const sections = this.parseAgentMd(content)
    for (const [key, value] of sections) {
      this.memories.set(key, {
        key,
        content: value,
        metadata: { source: 'AGENT.md' },
        timestamp: Date.now(),
      })
    }
  }

  async save(key: string, content: string, metadata?: Record<string, string>): Promise<void> {
    this.memories.set(key, { key, content, metadata, timestamp: Date.now() })
    await this.persist()
  }

  async get(key: string): Promise<MemoryItem | null> {
    return this.memories.get(key) ?? null
  }

  async search(query: string, topK = 5): Promise<MemoryItem[]> {
    const q = query.toLowerCase()
    const isCJK = /[\u4e00-\u9fff]/.test(q)
    const qTokens = isCJK ? [...q] : q.split(/\s+/).filter(Boolean)

    return Array.from(this.memories.values())
      .map(item => {
        const text = `${item.key} ${item.content}`.toLowerCase()
        const score = qTokens.reduce((s, token) => s + (text.includes(token) ? 1 : 0), 0)
        return { ...item, relevanceScore: score }
      })
      .filter(item => item.relevanceScore > 0)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, topK)
  }

  async delete(key: string): Promise<void> {
    this.memories.delete(key)
    await this.persist()
  }

  async list(): Promise<string[]> {
    return Array.from(this.memories.keys())
  }

  /** Get all items (for full injection into system prompt) */
  getAll(): MemoryItem[] {
    return Array.from(this.memories.values())
  }

  /** Persist memories back to AGENT.md */
  private async persist(): Promise<void> {
    const lines: string[] = ['# AGENT.md — Project Memory\n']
    for (const [key, item] of this.memories) {
      lines.push(`## ${key}\n${item.content}\n`)
    }
    if (!existsSync(this.projectDir)) await mkdir(this.projectDir, { recursive: true })
    await writeFile(join(this.projectDir, 'AGENT.md'), lines.join('\n'), 'utf-8')
  }

  /** Parse AGENT.md sections into key-value pairs */
  private parseAgentMd(content: string): Map<string, string> {
    const map = new Map<string, string>()
    const lines = content.split('\n')
    let currentKey = ''
    let currentValue: string[] = []

    for (const line of lines) {
      const heading = line.match(/^##?\s+(.+)/)
      if (heading) {
        if (currentKey) map.set(currentKey, currentValue.join('\n').trim())
        currentKey = heading[1].trim()
        currentValue = []
      } else if (currentKey) {
        currentValue.push(line)
      }
    }
    if (currentKey) map.set(currentKey, currentValue.join('\n').trim())
    return map
  }
}

// ─── Long-term Memory (Layer 3) ────────────────────────────────────

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'

export interface LongTermMemoryConfig {
  dbPath: string
  /** Embedding dimension (default 384) */
  embeddingDim?: number
  /** Custom embedding function */
  embedFn?: (text: string) => Promise<number[]>
  /** Maximum memories to retain (evicts lowest-score when exceeded) */
  maxMemories?: number
  /** Enable importance decay scoring */
  enableDecay?: boolean
}

interface StoredMemory {
  key: string
  content: string
  metadata: string | null
  importance: string
  embedding: Uint8Array | null
  timestamp: number
}

export class LongTermMemory implements MemoryStore {
  private db: any = null  // SqlJsDatabase — typed as any for ease
  private dbPath: string
  private embedFn: ((text: string) => Promise<number[]>) | undefined
  private embeddingDim: number
  private maxMemories: number
  private enableDecay: boolean
  private ready: Promise<void>

  constructor(config: LongTermMemoryConfig) {
    this.dbPath = config.dbPath
    this.embedFn = config.embedFn
    this.embeddingDim = config.embeddingDim ?? 384
    this.maxMemories = config.maxMemories ?? 10000
    this.enableDecay = config.enableDecay ?? true
    this.ready = this.init()
  }

  // ─── Async Init (sql.js WASM) ──────────────────────────────────

  private async init(): Promise<void> {
    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs()

    // Try loading existing DB from disk
    try {
      const fs = await import('fs/promises')
      const buf = await fs.readFile(this.dbPath)
      this.db = new SQL.Database(new Uint8Array(buf))
    } catch {
      this.db = new SQL.Database()
    }
    this.initSchema()
  }

  private async ensureReady(): Promise<any> {
    await this.ready
    if (!this.db) throw new Error('Database not initialized')
    return this.db
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        importance TEXT NOT NULL DEFAULT 'normal',
        embedding BLOB,
        timestamp INTEGER NOT NULL
      );
    `)
    this.db.run('CREATE INDEX IF NOT EXISTS idx_memories_ts ON memories(timestamp);')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);')
  }

  private async persist(): Promise<void> {
    const db = await this.ensureReady()
    const data = db.export()
    const buffer = Buffer.from(data)
    const fs = await import('fs/promises')
    const path = await import('path')
    const dir = path.dirname(this.dbPath)
    try { await fs.mkdir(dir, { recursive: true }) } catch {}
    await fs.writeFile(this.dbPath, buffer)
  }

  // ─── CRUD ────────────────────────────────────────────────────────

  async save(key: string, content: string, metadata?: Record<string, string>): Promise<void> {
    const db = await this.ensureReady()
    const importance = classifyImportance(content, key)
    const embedding = this.embedFn ? await this.embedFn(content) : null
    const embeddingBlob = embedding
      ? Buffer.from(new Float32Array(embedding).buffer)
      : null

    db.run(
      'INSERT OR REPLACE INTO memories (key, content, metadata, importance, embedding, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [key, content, metadata ? JSON.stringify(metadata) : null, importance, embeddingBlob, Date.now()],
    )

    await this.evictIfNeeded()
    await this.persist()
  }

  async get(key: string): Promise<MemoryItem | null> {
    const db = await this.ensureReady()
    const stmt = db.prepare('SELECT * FROM memories WHERE key = ?')
    stmt.bind([key])
    if (!stmt.step()) { stmt.free(); return null }
    const row = stmt.getAsObject() as any
    stmt.free()
    return {
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      timestamp: row.timestamp as number,
    }
  }

  async search(query: string, topK = 5): Promise<MemoryItem[]> {
    const db = await this.ensureReady()

    if (!this.embedFn) {
      return this.keywordSearch(query, topK)
    }

    const queryEmbedding = await this.embedFn(query)
    const stmt = db.prepare('SELECT * FROM memories WHERE embedding IS NOT NULL')
    const rows: Array<StoredMemory & { score: number }> = []
    const now = Date.now()

    while (stmt.step()) {
      const row = stmt.getAsObject() as any
      const embedding = row.embedding
        ? Array.from(new Float32Array(row.embedding as ArrayBuffer))
        : null
      if (!embedding) continue
      const semanticScore = this.cosineSimilarity(queryEmbedding, embedding)
      const decayMultiplier = this.enableDecay
        ? decayedScore(row.importance as ImportanceLevel, row.timestamp as number, now)
        : 1.0
      rows.push({ ...row, score: semanticScore * decayMultiplier } as any)
    }
    stmt.free()

    rows.sort((a, b) => b.score - a.score)
    return rows.slice(0, topK).map(r => ({
      key: r.key as string,
      content: r.content as string,
      metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
      timestamp: r.timestamp as number,
      relevanceScore: r.score,
    }))
  }

  async delete(key: string): Promise<void> {
    const db = await this.ensureReady()
    db.run('DELETE FROM memories WHERE key = ?', [key])
    await this.persist()
  }

  async list(): Promise<string[]> {
    const db = await this.ensureReady()
    const stmt = db.prepare('SELECT key FROM memories')
    const keys: string[] = []
    while (stmt.step()) {
      keys.push((stmt.getAsObject() as any).key)
    }
    stmt.free()
    return keys
  }

  async close(): Promise<void> {
    const db = await this.ensureReady()
    await this.persist()
    db.close()
  }

  /** Get memories sorted by decayed importance (for inspection/debugging) */
  async getMemoriesByImportance(): Promise<Array<{ key: string; content: string; importance: ImportanceLevel; score: number }>> {
    const db = await this.ensureReady()
    const stmt = db.prepare('SELECT * FROM memories')
    const now = Date.now()
    const results: Array<{ key: string; content: string; importance: ImportanceLevel; score: number }> = []

    while (stmt.step()) {
      const row = stmt.getAsObject() as any
      results.push({
        key: row.key,
        content: row.content,
        importance: row.importance as ImportanceLevel,
        score: decayedScore(row.importance as ImportanceLevel, row.timestamp, now),
      })
    }
    stmt.free()
    results.sort((a, b) => b.score - a.score)
    return results
  }

  // ─── Private ─────────────────────────────────────────────────────

  private async evictIfNeeded(): Promise<void> {
    const db = await this.ensureReady()
    const countStmt = db.prepare('SELECT COUNT(*) as c FROM memories')
    countStmt.step()
    const count = (countStmt.getAsObject() as any).c
    countStmt.free()

    if (count <= this.maxMemories) return

    const evictCount = Math.ceil(count - this.maxMemories * 0.9)
    const now = Date.now()

    const stmt = db.prepare('SELECT key, importance, timestamp FROM memories WHERE importance != ?')
    stmt.bind(['critical'])
    const candidates: Array<{ key: string; score: number }> = []

    while (stmt.step()) {
      const row = stmt.getAsObject() as any
      candidates.push({
        key: row.key,
        score: decayedScore(row.importance as ImportanceLevel, row.timestamp, now),
      })
    }
    stmt.free()

    candidates.sort((a, b) => a.score - b.score)
    const toEvict = candidates.slice(0, evictCount).map(e => e.key)

    if (toEvict.length > 0) {
      for (const k of toEvict) {
        db.run('DELETE FROM memories WHERE key = ?', [k])
      }
    }
  }

  private keywordSearch(query: string, topK: number): MemoryItem[] {
    const q = `%${query.toLowerCase()}%`
    const now = Date.now()
    const db = this.db!  // guaranteed ready since search is async

    const stmt = db.prepare(
      'SELECT * FROM memories WHERE LOWER(content) LIKE ? OR LOWER(key) LIKE ? ORDER BY timestamp DESC'
    )
    stmt.bind([q, q])
    const rows: Array<{ row: any; score: number }> = []

    while (stmt.step()) {
      const row = stmt.getAsObject() as any
      const keywordScore = 0.5
      const decayMultiplier = this.enableDecay
        ? decayedScore(row.importance as ImportanceLevel, row.timestamp, now)
        : 1.0
      rows.push({ row, score: keywordScore * decayMultiplier })
    }
    stmt.free()

    rows.sort((a, b) => b.score - a.score)
    return rows.slice(0, topK).map(({ row, score }) => ({
      key: row.key as string,
      content: row.content as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      timestamp: row.timestamp as number,
      relevanceScore: score,
    }))
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }
}


// ─── Memory Injector (Budget-Aware) ────────────────────────────────

export class MemoryInjector {
  constructor(
    private working: WorkingMemory,
    private project: ProjectMemory,
    private longTerm?: LongTermMemory,
  ) {}

  /**
   * Collect relevant memories and format for context injection.
   * Now accepts budgetInfo from ContextManager for adaptive scaling.
   */
  async inject(
    query: string,
    topK = 5,
    budgetInfo?: { maxItemLength: number; remaining: number },
  ): Promise<string> {
    const parts: string[] = []
    const maxLen = budgetInfo?.maxItemLength ?? 2000

    // Project memory — always include (it's curated by user)
    const projectItems = await this.project.search(query, topK)
    if (projectItems.length > 0) {
      // If budget is tight, include fewer items
      const items = this.applyBudget(projectItems, budgetInfo)
      parts.push('## Project Memory')
      for (const item of items) {
        parts.push(`### ${item.key}\n${this.truncate(item.content, maxLen)}`)
      }
    }

    // Working memory — session context
    const workingItems = await this.working.search(query, topK)
    if (workingItems.length > 0) {
      const items = this.applyBudget(workingItems, budgetInfo)
      parts.push('## Working Context')
      for (const item of items) {
        parts.push(`- **${item.key}**: ${this.truncate(item.content, maxLen)}`)
      }
    }

    // Long-term memory (semantic search with decay scoring)
    if (this.longTerm) {
      const ltItems = await this.longTerm.search(query, topK)
      if (ltItems.length > 0) {
        const items = this.applyBudget(ltItems, budgetInfo)
        parts.push('## Relevant Memories')
        for (const item of items) {
          parts.push(`- ${this.truncate(item.content, maxLen)}`)
        }
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : ''
  }

  /** Store a new memory item across appropriate layers */
  async store(key: string, content: string, options?: {
    layer?: 'working' | 'project' | 'longterm'
    importance?: ImportanceLevel
    metadata?: Record<string, string>
  }): Promise<void> {
    const layer = options?.layer ?? 'working'

    switch (layer) {
      case 'working':
        await this.working.save(key, content, options?.metadata)
        break
      case 'project':
        await this.project.save(key, content, options?.metadata)
        break
      case 'longterm':
        if (this.longTerm) {
          await this.longTerm.save(key, content, options?.metadata)
        }
        break
    }
  }

  // ─── Budget Helpers ──────────────────────────────────────────────

  /** Trim items to fit remaining budget */
  private applyBudget(items: MemoryItem[], budget?: { maxItemLength: number; remaining: number }): MemoryItem[] {
    if (!budget) return items

    const result: MemoryItem[] = []
    let usedTokens = 0

    for (const item of items) {
      const estimate = Math.ceil(item.content.length / 3) // rough token estimate
      if (usedTokens + estimate > budget.remaining) break
      result.push(item)
      usedTokens += estimate
    }

    return result
  }

  /** Truncate content to max length */
  private truncate(content: string, maxLen: number): string {
    if (content.length <= maxLen) return content
    return content.slice(0, maxLen - 20) + '\n... [truncated]'
  }
}

// Importance utilities are exported inline via definitions above
