import { z } from 'zod'
import type { ToolDefinition } from '@agentnova/tools'

// ─── Skill Config ──────────────────────────────────────────────────────

export interface SkillConfig {
  name: string
  version: string
  description: string
  tools?: ToolDefinition[]
  prompt?: string
  knowledge?: string[]
  activateOn?: (input: string) => boolean
  configSchema?: z.ZodType
  defaultConfig?: Record<string, unknown>
}

export interface Skill extends SkillConfig {
  dir: string
  active: boolean
  resolvedConfig: Record<string, unknown>
}

export interface SkillManifest {
  name: string
  version: string
  description: string
  author?: string
  source: string
  dependencies?: Record<string, string>
  tags?: string[]
}
