import { describe, it, expect } from 'vitest'

describe('agentnova package', () => {
  it('should re-export core modules', async () => {
    const mod = await import('../src/index.js')
    expect(mod.Agent).toBeDefined()
    expect(mod.createAgent).toBeDefined()
    expect(mod.ToolRegistry).toBeDefined()
    expect(mod.PermissionGuard).toBeDefined()
    expect(mod.ProviderRouter).toBeDefined()
    expect(mod.WorkingMemory).toBeDefined()
  })
})
