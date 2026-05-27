/**
 * Memory System — Three-layer memory architecture
 *
 * Layer 1: Working Memory (in-memory, per-session)
 * Layer 2: Project Memory (file-based, like CLAUDE.md)
 * Layer 3: Long-term Memory (SQLite + embeddings, cross-session)
 */

// ─── Memory Item ───────────────────────────────────────────────────

export interface MemoryItem {
  key: string
  content: string
  metadata?: Record<string, string>
  timestamp: number
  relevanceScore?: number
}

// ─── Memory Store Interface ────────────────────────────────────────

export interface MemoryStore {
  /** Store a memory item */
  save(key: string, content: string, metadata?: Record<string, string>): Promise<void>

  /** Get a memory item by key */
  get(key: string): Promise<MemoryItem | null>

  /** Search memories by semantic similarity */
  search(query: string, topK?: number): Promise<MemoryItem[]>

  /** Delete a memory item */
  delete(key: string): Promise<void>

  /** List all keys */
  list(): Promise<string[]>
}

// ─── Working Memory (Layer 1) ──────────────────────────────────────

export class WorkingMemory implements MemoryStore {
  private store: Map<string, MemoryItem> = new Map()

  async save(key: string, content: string, metadata?: Record<string, string>): Promise<void> {
    this.store.set(key, { key, content, metadata, timestamp: Date.now() })
  }

  async get(key: string): Promise<MemoryItem | null> {
    return this.store.get(key) ?? null
  }

  async search(query: string, topK = 5): Promise<MemoryItem[]> {
    // Simple keyword matching for working memory
    const q = query.toLowerCase()
    const scored = Array.from(this.store.values())
      .map(item => ({
        ...item,
        relevanceScore: item.content.toLowerCase().includes(q) ? 1 : 0,
      }))
      .filter(item => item.relevanceScore > 0)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, topK)
    return scored
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  /** Clear all working memory */
  clear(): void {
    this.store.clear()
  }
}

// ─── Project Memory (Layer 2) ──────────────────────────────────────

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

export class ProjectMemory implements MemoryStore {
  private memories: Map<string, MemoryItem> = new Map()

  constructor(private projectDir: string) {}

  /** Load memories from AGENT.md file */
  async load(): Promise<void> {
    const agentMdPath = join(this.projectDir, 'AGENT.md')
    if (!existsSync(agentMdPath)) return

    const content = await readFile(agentMdPath, 'utf-8')
    // Parse sections as memory items
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
    return Array.from(this.memories.values())
      .filter(item => item.content.toLowerCase().includes(q) || item.key.toLowerCase().includes(q))
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
    const dir = this.projectDir
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'AGENT.md'), lines.join('\n'), 'utf-8')
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

// ─── Memory Injector ───────────────────────────────────────────────

export class MemoryInjector {
  constructor(
    private working: WorkingMemory,
    private project: ProjectMemory,
    private longTerm?: MemoryStore,
  ) {}

  /** Collect relevant memories and format for context injection */
  async inject(query: string, topK = 5): Promise<string> {
    const parts: string[] = []

    // Project memory (always include — it's like CLAUDE.md)
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
}
