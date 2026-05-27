/**
 * Skill Market — Team sharing via Git repos or npm packages
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { exec } from 'child_process'

// ─── Manifest ──────────────────────────────────────────────────────────────

export interface SkillManifest {
  name: string
  version: string
  description: string
  author?: string
  source: string           // git repo URL or npm package name
  dependencies?: Record<string, string>
  tags?: string[]
}

// ─── Registry Config ───────────────────────────────────────────────────────

export interface SkillRegistryConfig {
  /** Directory for installed skills */
  skillsDir: string
  /** Registry file path (stores manifest index) */
  registryFile?: string
}

// ─── Skill Registry ────────────────────────────────────────────────────────

export class SkillRegistry {
  private manifests: Map<string, SkillManifest> = new Map()
  private skillsDir: string
  private registryFile: string

  constructor(config: SkillRegistryConfig) {
    this.skillsDir = config.skillsDir
    this.registryFile = config.registryFile ?? join(config.skillsDir, 'registry.json')
  }

  /** Load registry from disk */
  async load(): Promise<void> {
    if (!existsSync(this.registryFile)) return
    const data = await readFile(this.registryFile, 'utf-8')
    const arr: SkillManifest[] = JSON.parse(data)
    for (const m of arr) {
      this.manifests.set(m.name, m)
    }
  }

  /** Save registry to disk */
  async save(): Promise<void> {
    if (!existsSync(this.skillsDir)) await mkdir(this.skillsDir, { recursive: true })
    const arr = Array.from(this.manifests.values())
    await writeFile(this.registryFile, JSON.stringify(arr, null, 2), 'utf-8')
  }

  /** Register a skill manifest */
  register(manifest: SkillManifest): void {
    this.manifests.set(manifest.name, manifest)
  }

  /** Search available skills by name, description, or tags */
  search(query: string): SkillManifest[] {
    const q = query.toLowerCase()
    const qChars = [...q]
    return Array.from(this.manifests.values()).filter(m => {
      const text = `${m.name} ${m.description} ${(m.tags ?? []).join(' ')}`.toLowerCase()
      // Word match or CJK char match
      if (text.includes(q)) return true
      return qChars.some(c => text.includes(c))
    })
  }

  /** Get manifest by name */
  get(name: string): SkillManifest | undefined {
    return this.manifests.get(name)
  }

  /** List all available skills */
  list(): SkillManifest[] {
    return Array.from(this.manifests.values())
  }

  /** Install a skill from git repo */
  async install(source: string, options?: { name?: string }): Promise<SkillManifest> {
    const skillName = options?.name ?? source.split('/').pop()?.replace('.git', '') ?? 'unknown'
    const targetDir = join(this.skillsDir, skillName)

    if (existsSync(targetDir)) {
      throw new Error(`Skill "${skillName}" already installed at ${targetDir}`)
    }

    await new Promise<void>((resolve, reject) => {
      const cmd = source.startsWith('http') || source.endsWith('.git')
        ? `git clone --depth 1 ${source} ${targetDir}`
        : `npm pack ${source} --pack-destination ${this.skillsDir} && cd ${this.skillsDir} && tar xf *.tgz && rm *.tgz`

      exec(cmd, (err) => {
        if (err) reject(new Error(`Install failed: ${err.message}`))
        else resolve()
      })
    })

    // Try to read manifest from installed skill
    const manifest: SkillManifest = {
      name: skillName,
      version: '1.0.0',
      description: `Installed from ${source}`,
      source,
    }

    // Try to load skill.config.json/ts for metadata
    const configPath = join(targetDir, 'skill.config.json')
    if (existsSync(configPath)) {
      try {
        const configData = JSON.parse(await readFile(configPath, 'utf-8'))
        manifest.version = configData.version ?? manifest.version
        manifest.description = configData.description ?? manifest.description
        manifest.author = configData.author
        manifest.tags = configData.tags
      } catch { /* ignore */ }
    }

    this.register(manifest)
    await this.save()
    return manifest
  }

  /** Uninstall a skill by name */
  async uninstall(name: string): Promise<boolean> {
    if (!this.manifests.has(name)) return false
    this.manifests.delete(name)
    await this.save()

    // Remove skill directory
    const skillDir = join(this.skillsDir, name)
    if (existsSync(skillDir)) {
      await new Promise<void>((resolve, reject) => {
        exec(`rm -rf ${skillDir}`, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }

    return true
  }
}
