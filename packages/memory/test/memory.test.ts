import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkingMemory, ProjectMemory, LongTermMemory, MemoryInjector } from '../src/index.js'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('WorkingMemory', () => {
  let memory: WorkingMemory

  beforeEach(() => { memory = new WorkingMemory() })

  it('should save and retrieve items', async () => {
    await memory.save('key1', 'hello world')
    const item = await memory.get('key1')
    expect(item).not.toBeNull()
    expect(item!.content).toBe('hello world')
  })

  it('should return null for missing keys', async () => {
    const item = await memory.get('nonexistent')
    expect(item).toBeNull()
  })

  it('should search by keywords', async () => {
    await memory.save('a', 'TypeScript is great')
    await memory.save('b', 'Python is also great')
    await memory.save('c', 'Rust is fast')

    const results = await memory.search('TypeScript')
    expect(results.length).toBe(1)
    expect(results[0].key).toBe('a')
  })

  it('should return empty for no matches', async () => {
    await memory.save('a', 'hello')
    const results = await memory.search('xyz')
    expect(results.length).toBe(0)
  })

  it('should delete items', async () => {
    await memory.save('del', 'to be deleted')
    await memory.delete('del')
    const item = await memory.get('del')
    expect(item).toBeNull()
  })

  it('should list all keys', async () => {
    await memory.save('k1', 'a')
    await memory.save('k2', 'b')
    const keys = await memory.list()
    expect(keys.sort()).toEqual(['k1', 'k2'])
  })

  it('should clear all items', async () => {
    await memory.save('a', 'x')
    await memory.clear()
    await expect(memory.list()).resolves.toEqual([])
  })
})

describe('ProjectMemory', () => {
  let tempDir: string
  let memory: ProjectMemory

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentnova-test-'))
    memory = new ProjectMemory(tempDir)
    await memory.load()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should save and retrieve items', async () => {
    await memory.save('偏好', '用中文回复')
    const item = await memory.get('偏好')
    expect(item).not.toBeNull()
    expect(item!.content).toBe('用中文回复')
  })

  it('should persist to AGENT.md', async () => {
    await memory.save('偏好', '用 TypeScript')
    const agentMdPath = join(tempDir, 'AGENT.md')
    expect(existsSync(agentMdPath)).toBe(true)
    const content = await readFile(agentMdPath, 'utf-8')
    expect(content).toContain('偏好')
    expect(content).toContain('用 TypeScript')
  })

  it('should load from existing AGENT.md', async () => {
    // First save
    await memory.save('偏好', '用 pnpm')
    // Create new instance loading from same dir
    const memory2 = new ProjectMemory(tempDir)
    await memory2.load()
    const item = await memory2.get('偏好')
    expect(item).not.toBeNull()
    expect(item!.content).toBe('用 pnpm')
  })

  it('should search items', async () => {
    await memory.save('style', '函数式编程')
    await memory.save('tool', 'pnpm')
    const results = await memory.search('函数式')
    expect(results.length).toBe(1)
    expect(results[0].key).toBe('style')
  })

  it('should delete items and persist', async () => {
    await memory.save('temp', 'temporary')
    await memory.delete('temp')
    const item = await memory.get('temp')
    expect(item).toBeNull()
  })
})

describe('LongTermMemory', () => {
  let tempDir: string
  let memory: LongTermMemory

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentnova-lt-'))
    memory = new LongTermMemory({ dbPath: join(tempDir, 'memories.db') })
  })

  afterEach(() => {
    memory.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should save and retrieve items', async () => {
    await memory.save('fact1', 'The sky is blue')
    const item = await memory.get('fact1')
    expect(item).not.toBeNull()
    expect(item!.content).toBe('The sky is blue')
  })

  it('should support keyword search without embeddings', async () => {
    await memory.save('a', 'React is a frontend framework')
    await memory.save('b', 'Vue is also a frontend framework')
    await memory.save('c', 'Rust is a systems language')

    const results = await memory.search('frontend')
    expect(results.length).toBe(2)
  })

  it('should support semantic search with embeddings', async () => {
    const memoryWithEmbed = new LongTermMemory({
      dbPath: join(tempDir, 'embed.db'),
      embedFn: async (text: string) => {
        // Simple mock: hash-like deterministic embedding
        const vec = new Array(16).fill(0)
        for (let i = 0; i < text.length; i++) {
          vec[i % 16] += text.charCodeAt(i) / 1000
        }
        // Normalize
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
        return vec.map(v => v / norm)
      },
      embeddingDim: 16,
    })

    await memoryWithEmbed.save('a', 'Machine learning models')
    await memoryWithEmbed.save('b', 'Cooking recipes')
    await memoryWithEmbed.save('c', 'Deep learning neural networks')

    const results = await memoryWithEmbed.search('learning algorithms')
    // Should return items related to ML
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.key === 'a' || r.key === 'c')).toBe(true)

    memoryWithEmbed.close()
  })

  it('should delete items', async () => {
    await memory.save('del', 'to delete')
    await memory.delete('del')
    const item = await memory.get('del')
    expect(item).toBeNull()
  })

  it('should list all keys', async () => {
    await memory.save('k1', 'a')
    await memory.save('k2', 'b')
    const keys = await memory.list()
    expect(keys.sort()).toEqual(['k1', 'k2'])
  })

  it('should upsert (insert or replace)', async () => {
    await memory.save('key', 'version 1')
    await memory.save('key', 'version 2')
    const item = await memory.get('key')
    expect(item!.content).toBe('version 2')
  })
})

describe('MemoryInjector', () => {
  let tempDir: string
  let working: WorkingMemory
  let project: ProjectMemory
  let injector: MemoryInjector

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentnova-inj-'))
    working = new WorkingMemory()
    project = new ProjectMemory(tempDir)
    await project.load()
    injector = new MemoryInjector(working, project)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should inject project memory', async () => {
    await project.save('风格', '函数式优先')
    const ctx = await injector.inject('代码风格')
    expect(ctx).toContain('Project Memory')
    expect(ctx).toContain('函数式优先')
  })

  it('should inject working memory', async () => {
    await working.save('当前任务', '重构 utils')
    const ctx = await injector.inject('重构')
    expect(ctx).toContain('Working Context')
    expect(ctx).toContain('重构 utils')
  })

  it('should return empty string when no memories', async () => {
    const ctx = await injector.inject('nothing here')
    expect(ctx).toBe('')
  })

  it('should store to specific layers', async () => {
    await injector.store('wk', 'working item', { layer: 'working' })
    await injector.store('pj', 'project item', { layer: 'project' })

    const wkItem = await working.get('wk')
    const pjItem = await project.get('pj')
    expect(wkItem!.content).toBe('working item')
    expect(pjItem!.content).toBe('project item')
  })
})
