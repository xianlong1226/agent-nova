/**
 * Memory System — Three-layer memory architecture
 *
 * Layer 1: WorkingMemory   — in-memory, per-session
 * Layer 2: ProjectMemory   — file-based, like CLAUDE.md
 * Layer 3: LongTermMemory  — SQLite + embedding similarity
 */

export type { MemoryItem, MemoryStore } from './types.js'

import type { MemoryItem, MemoryStore } from './types.js'

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

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

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
    // For CJK: match any character overlap; for others: word-based
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

import Database from 'better-sqlite3'

export interface LongTermMemoryConfig {
  dbPath: string
  /** Embedding dimension (default 384 for small models) */
  embeddingDim?: number
  /** Custom embedding function */
  embedFn?: (text: string) => Promise<number[]>
}

export class LongTermMemory implements MemoryStore {
  private db: Database.Database
  private embedFn: ((text: string) => Promise<number[]>) | undefined
  private embeddingDim: number

  constructor(config: LongTermMemoryConfig) {
    this.db = new Database(config.dbPath)
    this.embedFn = config.embedFn
    this.embeddingDim = config.embeddingDim ?? 384
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding BLOB,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_ts ON memories(timestamp);
    `)
  }

  async save(key: string, content: string, metadata?: Record<string, string>): Promise<void> {
    const embedding = this.embedFn ? await this.embedFn(content) : null
    const embeddingBlob = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null

    this.db.prepare(`
      INSERT OR REPLACE INTO memories (key, content, metadata, embedding, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(key, content, metadata ? JSON.stringify(metadata) : null, embeddingBlob, Date.now())
  }

  async get(key: string): Promise<MemoryItem | null> {
    const row = this.db.prepare('SELECT * FROM memories WHERE key = ?').get(key) as any
    if (!row) return null
    return {
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      timestamp: row.timestamp,
    }
  }

  async search(query: string, topK = 5): Promise<MemoryItem[]> {
    if (!this.embedFn) {
      // Fallback: keyword search
      return this.keywordSearch(query, topK)
    }

    const queryEmbedding = await this.embedFn(query)

    const rows = this.db.prepare('SELECT * FROM memories WHERE embedding IS NOT NULL').all() as any[]

    const scored = rows.map(row => {
      const embedding = Array.from(new Float32Array(row.embedding.buffer))
      const similarity = this.cosineSimilarity(queryEmbedding, embedding)
      return { row, similarity }
    })

    scored.sort((a, b) => b.similarity - a.similarity)

    return scored.slice(0, topK).map(({ row, similarity }) => ({
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      timestamp: row.timestamp,
      relevanceScore: similarity,
    }))
  }

  async delete(key: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE key = ?').run(key)
  }

  async list(): Promise<string[]> {
    const rows = this.db.prepare('SELECT key FROM memories').all() as any[]
    return rows.map(r => r.key)
  }

  close(): void {
    this.db.close()
  }

  private keywordSearch(query: string, topK: number): MemoryItem[] {
    const q = `%${query.toLowerCase()}%`
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE LOWER(content) LIKE ? OR LOWER(key) LIKE ? ORDER BY timestamp DESC LIMIT ?'
    ).all(q, q, topK) as any[]

    return rows.map(row => ({
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      timestamp: row.timestamp,
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

// ─── Memory Injector ───────────────────────────────────────────────

export class MemoryInjector {
  constructor(
    private working: WorkingMemory,
    private project: ProjectMemory,
    private longTerm?: LongTermMemory,
  ) {}

  /** Collect relevant memories and format for context injection */
  async inject(query: string, topK = 5): Promise<string> {
    const parts: string[] = []

    // Project memory — always include
    const projectItems = await this.project.search(query, topK)
    if (projectItems.length > 0) {
      parts.push('## Project Memory')
      for (const item of projectItems) {
        parts.push(`### ${item.key}\n${item.content}`)
      }
    }

    // Working memory
    const workingItems = await this.working.search(query, topK)
    if (workingItems.length > 0) {
      parts.push('## Working Context')
      for (const item of workingItems) {
        parts.push(`- **${item.key}**: ${item.content}`)
      }
    }

    // Long-term memory (semantic search)
    if (this.longTerm) {
      const ltItems = await this.longTerm.search(query, topK)
      if (ltItems.length > 0) {
        parts.push('## Relevant Memories')
        for (const item of ltItems) {
          parts.push(`- ${item.content}`)
        }
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : ''
  }

  /** Store a new memory item across appropriate layers */
  async store(key: string, content: string, options?: {
    layer?: 'working' | 'project' | 'longterm'
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
}
