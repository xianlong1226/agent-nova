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

  /**
   * Publish a skill to a Git remote or npm registry
   *
   * Git mode:
   *   1. Initialize git repo in skill dir (if not already)
   *   2. Commit all files
   *   3. Push to remote
   *
   * npm mode:
   *   1. Generate package.json wrapper
   *   2. Run npm publish
   */
  async publish(
    name: string,
    options?: {
      remote?: string      // Git remote URL (e.g. git@github.com:user/skills.git)
      registry?: string    // npm registry URL (default: https://registry.npmjs.org)
      tag?: string         // Git branch or npm dist-tag (default: main / latest)
      dryRun?: boolean     // Preview without actually pushing
    },
  ): Promise<{ success: boolean; message: string; url?: string }> {
    const skillDir = join(this.skillsDir, name)
    if (!existsSync(skillDir)) {
      return { success: false, message: `Skill directory not found: ${skillDir}` }
    }

    // Load skill config for metadata
    const configPath = join(skillDir, 'skill.config.json')
    let skillConfig: any = { name, version: '1.0.0' }
    if (existsSync(configPath)) {
      try {
        skillConfig = JSON.parse(await readFile(configPath, 'utf-8'))
      } catch { /* use defaults */ }
    }

    // npm publish mode
    if (options?.registry || (!options?.remote && existsSync(join(skillDir, 'package.json')))) {
      return this.publishToNpm(skillDir, skillConfig, options)
    }

    // Git push mode (default)
    if (options?.remote) {
      return this.publishToGit(skillDir, name, { remote: options.remote, tag: options.tag, dryRun: options.dryRun })
    }

    return {
      success: false,
      message: 'No publish target specified. Provide --remote (Git URL) or --registry (npm URL)',
    }
  }

  /** Push skill to a Git remote */
  private async publishToGit(
    skillDir: string,
    name: string,
    options: { remote: string; tag?: string; dryRun?: boolean },
  ): Promise<{ success: boolean; message: string; url?: string }> {
    const branch = options.tag ?? 'main'

    const execCmd = (cmd: string) =>
      new Promise<string>((resolve, reject) => {
        exec(cmd, { cwd: skillDir }, (err, stdout, stderr) => {
          if (err) reject(new Error(`${cmd}: ${stderr || err.message}`))
          else resolve(stdout.trim())
        })
      })

    try {
      // Initialize git if needed
      if (!existsSync(join(skillDir, '.git'))) {
        await execCmd('git init')
      }

      // Add all files
      await execCmd('git add -A')

      // Commit
      try {
        await execCmd(`git commit -m "publish skill: ${name}"`)
      } catch {
        // Nothing to commit, that's fine
      }

      // Add remote
      try {
        await execCmd('git remote get-url origin')
        await execCmd(`git remote set-url origin ${options.remote}`)
      } catch {
        await execCmd(`git remote add origin ${options.remote}`)
      }

      if (options.dryRun) {
        return {
          success: true,
          message: `[DRY RUN] Would push ${name} to ${options.remote} (${branch})`,
          url: options.remote,
        }
      }

      // Push
      await execCmd(`git push -u origin HEAD:${branch} --force`)

      // Update manifest
      const manifest = this.manifests.get(name)
      if (manifest) {
        manifest.source = options.remote
        await this.save()
      }

      return {
        success: true,
        message: `✅ Published ${name} to ${options.remote} (${branch})`,
        url: options.remote,
      }
    } catch (err: any) {
      return { success: false, message: `Git publish failed: ${err.message}` }
    }
  }

  /** Publish skill as an npm package */
  private async publishToNpm(
    skillDir: string,
    skillConfig: any,
    options?: { registry?: string; tag?: string; dryRun?: boolean },
  ): Promise<{ success: boolean; message: string; url?: string }> {
    const pkgName = `@agentnova/skill-${skillConfig.name}` || `agentnova-skill-${skillConfig.name}`

    // Ensure package.json exists
    const pkgPath = join(skillDir, 'package.json')
    if (!existsSync(pkgPath)) {
      const pkgJson = {
        name: pkgName,
        version: skillConfig.version || '1.0.0',
        description: skillConfig.description || '',
        main: 'skill.config.json',
        files: ['**/*.json', '**/*.md', 'tools/**/*', 'knowledge/**/*'],
        keywords: skillConfig.tags || ['agentnova', 'skill'],
        license: 'MIT',
      }
      await writeFile(pkgPath, JSON.stringify(pkgJson, null, 2), 'utf-8')
    }

    const execCmd = (cmd: string) =>
      new Promise<string>((resolve, reject) => {
        exec(cmd, { cwd: skillDir }, (err, stdout, stderr) => {
          if (err) reject(new Error(`${cmd}: ${stderr || err.message}`))
          else resolve(stdout.trim())
        })
      })

    try {
      const registryFlag = options?.registry ? ` --registry ${options.registry}` : ''
      const tagFlag = options?.tag ? ` --tag ${options.tag}` : ''
      const dryRunFlag = options?.dryRun ? ' --dry-run' : ''

      if (options?.dryRun) {
        await execCmd(`npm pack${dryRunFlag}`)
        return {
          success: true,
          message: `[DRY RUN] Would publish ${pkgName}@${skillConfig.version} to npm`,
        }
      }

      await execCmd(`npm publish --access public${registryFlag}${tagFlag}`)

      const manifest = this.manifests.get(skillConfig.name)
      if (manifest) {
        manifest.source = pkgName
        await this.save()
      }

      return {
        success: true,
        message: `✅ Published ${pkgName}@${skillConfig.version} to npm`,
        url: `https://www.npmjs.com/package/${pkgName}`,
      }
    } catch (err: any) {
      return { success: false, message: `npm publish failed: ${err.message}` }
    }
  }
}
