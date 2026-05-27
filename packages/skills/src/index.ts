/**
 * Skill System — Load, isolate, and activate skills on demand
 *
 * Skill = Tools + Prompt + Knowledge + Config
 */

import type { ToolDefinition } from '@agentnova/tools'
import { z } from 'zod'
import { readFile, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'

// ─── Skill Types ───────────────────────────────────────────────────

export interface SkillConfig {
  name: string
  version: string
  description: string
  tools: ToolDefinition[]
  prompt: string
  knowledge: string[]
  activateOn?: (input: string) => boolean
  configSchema?: z.ZodType
  defaultConfig?: Record<string, unknown>
}

export interface Skill extends SkillConfig {
  dir: string
  active: boolean
  resolvedConfig: Record<string, unknown>
}

// ─── Skill Loader ──────────────────────────────────────────────────

export class SkillLoader {
  private skills: Map<string, Skill> = new Map()

  /** Load a skill from a directory */
  async loadFromDir(dir: string): Promise<Skill> {
    const resolvedDir = resolve(dir)

    // Read SKILL.md
    const skillMdPath = join(resolvedDir, 'SKILL.md')
    let prompt = ''
    if (existsSync(skillMdPath)) {
      prompt = await readFile(skillMdPath, 'utf-8')
    }

    // Try to load skill.config.ts (dynamic import)
    let config: Partial<SkillConfig> = {}
    const configPath = join(resolvedDir, 'skill.config.ts')
    if (existsSync(configPath)) {
      try {
        const mod = await import(configPath)
        if (mod.default) config = mod.default
      } catch {
        // Config load failure is non-fatal
      }
    }

    // Read knowledge files
    const knowledge: string[] = []
    const knowledgeDir = join(resolvedDir, 'knowledge')
    if (existsSync(knowledgeDir)) {
      const files = await readdir(knowledgeDir)
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.txt')) {
          const content = await readFile(join(knowledgeDir, file), 'utf-8')
          knowledge.push(content)
        }
      }
    }

    const skill: Skill = {
      name: config.name ?? dir.split('/').pop() ?? 'unknown',
      version: config.version ?? '0.0.1',
      description: config.description ?? '',
      tools: config.tools ?? [],
      prompt,
      knowledge,
      activateOn: config.activateOn,
      configSchema: config.configSchema,
      defaultConfig: config.defaultConfig ?? {},
      dir: resolvedDir,
      active: false,
      resolvedConfig: {},
    }

    this.skills.set(skill.name, skill)
    return skill
  }

  /** Load multiple skills from directories */
  async loadAll(dirs: string[]): Promise<Skill[]> {
    const skills: Skill[] = []
    for (const dir of dirs) {
      try {
        const skill = await this.loadFromDir(dir)
        skills.push(skill)
      } catch (err) {
        console.warn(`Failed to load skill from ${dir}:`, err)
      }
    }
    return skills
  }

  /** Activate skills relevant to the current input */
  async activateForInput(input: string): Promise<Skill[]> {
    const activated: Skill[] = []

    for (const skill of this.skills.values()) {
      if (skill.activateOn) {
        if (skill.activateOn(input)) {
          skill.active = true
          activated.push(skill)
        }
      } else {
        // Without activation function, skill stays inactive by default
        // unless explicitly activated
      }
    }

    return activated
  }

  /** Explicitly activate a skill by name */
  activate(name: string): Skill | undefined {
    const skill = this.skills.get(name)
    if (skill) skill.active = true
    return skill
  }

  /** Deactivate a skill by name */
  deactivate(name: string): Skill | undefined {
    const skill = this.skills.get(name)
    if (skill) skill.active = false
    return skill
  }

  /** Get all active skills */
  getActive(): Skill[] {
    return Array.from(this.skills.values()).filter(s => s.active)
  }

  /** Get tools from all active skills */
  getActiveTools(): ToolDefinition[] {
    return this.getActive().flatMap(s => s.tools)
  }

  /** Get prompt fragments from all active skills */
  getActivePrompts(): string[] {
    return this.getActive()
      .filter(s => s.prompt)
      .map(s => s.prompt)
  }

  /** Get knowledge from all active skills */
  getActiveKnowledge(): string[] {
    return this.getActive().flatMap(s => s.knowledge)
  }

  /** Get a skill by name */
  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /** List all skill names */
  list(): string[] {
    return Array.from(this.skills.keys())
  }
}

// ─── Skill Manifest (for sharing) ──────────────────────────────────

export interface SkillManifest {
  name: string
  version: string
  description: string
  author?: string
  source: string
  dependencies?: Record<string, string>
}

// ─── Skill Registry (for team sharing) ─────────────────────────────

export class SkillRegistry {
  private manifests: Map<string, SkillManifest> = new Map()

  /** Register a skill manifest */
  register(manifest: SkillManifest): void {
    this.manifests.set(manifest.name, manifest)
  }

  /** Search available skills */
  search(query: string): SkillManifest[] {
    const q = query.toLowerCase()
    return Array.from(this.manifests.values()).filter(
      m => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
    )
  }

  /** Get manifest by name */
  get(name: string): SkillManifest | undefined {
    return this.manifests.get(name)
  }

  /** List all available skills */
  list(): SkillManifest[] {
    return Array.from(this.manifests.values())
  }
}

// ─── Helper ────────────────────────────────────────────────────────

export function defineSkill(config: SkillConfig): SkillConfig {
  return config
}
