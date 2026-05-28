import type { ToolDefinition } from '@agentnova/tools'

/**
 * Lightweight wrapper around SkillLoader.
 * Extracted from agent.ts to keep concerns separate.
 */
export class SkillLoaderWorker {
  private skills: Array<{
    name: string
    tools: ToolDefinition[]
    prompt: string
    active: boolean
    activateOn?: (input: string) => boolean
  }> = []

  async loadAll(dirs: string[]): Promise<void> {
    const { SkillLoader } = await import('@agentnova/skills')
    const loader = new SkillLoader()
    const loaded = await loader.loadAll(dirs)
    this.skills = loaded.map(s => ({
      name: s.name,
      tools: s.tools ?? [],
      prompt: s.prompt ?? '',
      active: s.active,
      activateOn: (s as any).activateOn,
    }))
  }

  activateForInput(input: string): Array<{ name: string; active: boolean }> {
    const activated: Array<{ name: string; active: boolean }> = []
    for (const skill of this.skills) {
      if (skill.activateOn?.(input) && !skill.active) {
        skill.active = true
        activated.push(skill)
      }
    }
    return activated
  }

  getActiveTools(): ToolDefinition[] {
    return this.skills.filter(s => s.active).flatMap(s => s.tools)
  }

  getActivePrompts(): string[] {
    return this.skills.filter(s => s.active && s.prompt).map(s => s.prompt)
  }
}
