import { describe, it, expect } from 'vitest'

describe('SkillLoader', () => {
  it('should export SkillLoader', async () => {
    const { SkillLoader } = await import('../src/loader.js')
    expect(SkillLoader).toBeDefined()
  })
})
