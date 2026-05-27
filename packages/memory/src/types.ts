/**
 * Shared memory types
 */

export interface MemoryItem {
  key: string
  content: string
  metadata?: Record<string, string>
  timestamp: number
  relevanceScore?: number
}

export interface MemoryStore {
  save(key: string, content: string, metadata?: Record<string, string>): Promise<void>
  get(key: string): Promise<MemoryItem | null>
  search(query: string, topK?: number): Promise<MemoryItem[]>
  delete(key: string): Promise<void>
  list(): Promise<string[]>
}
