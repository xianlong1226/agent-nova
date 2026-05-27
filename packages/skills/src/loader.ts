import { readFile, readdir, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { SkillConfig, Skill } from './types.js'
import type { ToolDefinition } from '@agentnova/tools'

// ─── Skill Loader ──────────────────────────────────────────────────────────

export class SkillLoader {
  /**
   * Load all skills from the given directories.
   * Each skill directory should contain a skill.config.json or skill.config.ts file.
   */
  async loadAll(dirs: string[]): Promise<Skill[]> {
    const skills: Skill[] = []
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillDir = join(dir, entry.name)
        try {
          const skill = await this.loadOne(skillDir)
          if (skill) skills.push(skill)
        } catch (err) {
          // Skip malformed skills silently
          console.warn(`[SkillLoader] Failed to load skill from ${skillDir}: ${err}`)
        }
      }
    }
    return skills
  }

  /** Load a single skill from a directory */
  async loadOne(dir: string): Promise<Skill | null> {
    const configPath = join(dir, 'skill.config.json')
    if (!existsSync(configPath)) return null

    const raw = await readFile(configPath, 'utf-8')
    const config: SkillConfig = JSON.parse(raw)

    // Load prompt file if referenced
    let prompt = config.prompt
    if (prompt && !prompt.includes('\n')) {
      // It's a file path
      const promptPath = resolve(dir, prompt)
      if (existsSync(promptPath)) {
        prompt = await readFile(promptPath, 'utf-8')
      }
    }

    // Load knowledge files
    let knowledge: string[] = []
    if (config.knowledge?.length) {
      knowledge = await Promise.all(
        config.knowledge.map(async (kRef) => {
          const kPath = resolve(dir, kRef)
          if (existsSync(kPath)) {
            return await readFile(kPath, 'utf-8')
          }
          return kRef // It's inline knowledge content
        })
      )
    }

    // Load tools from skill's tools.json if exists
    let tools: ToolDefinition[] = config.tools ?? []
    const toolsPath = join(dir, 'tools.json')
    if (existsSync(toolsPath)) {
      try {
        const toolsData = JSON.parse(await readFile(toolsPath, 'utf-8'))
        if (Array.isArray(toolsData)) {
          tools = [...tools, ...toolsData]
        }
      } catch { /* ignore */ }
    }

    // Build the full prompt with injected knowledge
    let fullPrompt = prompt ?? ''
    if (knowledge.length > 0) {
      fullPrompt += '\n\n## Knowledge\n\n' + knowledge.map((k, i) => `### Source ${i + 1}\n${k}`).join('\n\n')
    }

    return {
      ...config,
      dir,
      tools,
      prompt: fullPrompt || undefined,
      active: false,
      resolvedConfig: config.defaultConfig ?? {},
    }
  }
}

// ─── Skill Definition Helper ───────────────────────────────────────────────

export function defineSkill(config: SkillConfig): SkillConfig {
  return config
}
