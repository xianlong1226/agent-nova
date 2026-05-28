#!/usr/bin/env node
/**
 * AgentNova CLI — Quick scaffolding, tool/skill management, and agent runner
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'fs'
import { join, resolve, basename } from 'path'

const args = process.argv.slice(2)
const command = args[0]

// ─── Templates ─────────────────────────────────────────────────────

const TOOL_TEMPLATE = (name: string) => `import { z } from 'zod'
import { defineTool } from 'agentnova'

export const ${camelCase(name)} = defineTool({
  name: '${name}',
  description: 'TODO: 描述这个工具做什么',
  parameters: z.object({
    input: z.string().describe('TODO: 输入参数描述'),
  }),
  permission: {
    level: 'read', // read | write | dangerous
    description: 'TODO: 权限说明',
  },
  execute: async ({ input }, ctx) => {
    ctx.logger.info('Executing ${name}', { input })

    // TODO: 实现工具逻辑
    return { result: input }
  },
})
`

const SKILL_TEMPLATE = (name: string) => `{
  "name": "${name}",
  "version": "1.0.0",
  "description": "TODO: 描述这个技能",
  "tools": [],
  "prompt": "SKILL.md",
  "knowledge": [],
  "defaultConfig": {}
}
`

const SKILL_MD_TEMPLATE = (name: string) => `# ${titleCase(name)} Skill

## 能力
TODO: 描述这个技能的核心能力

## 何时使用
- TODO: 触发条件1
- TODO: 触发条件2

## 工作流程
1. TODO: 第一步
2. TODO: 第二步
3. TODO: 第三步

## 输出格式
TODO: 描述期望的输出

## 注意事项
- TODO: 限制或警告
`

const SKILL_TOOL_TEMPLATE = (name: string) => `import { z } from 'zod'
import { defineTool } from 'agentnova'

/**
 * ${name} 技能专属工具
 */
export const ${camelCase(name)}Tool = defineTool({
  name: '${name}.exec',
  description: 'TODO: ${name} 技能专用工具',
  parameters: z.object({
    action: z.enum(['analyze', 'report']).describe('执行的动作'),
  }),
  permission: { level: 'read' },
  execute: async ({ action }, ctx) => {
    ctx.logger.info('${name} tool executing', { action })
    return { action, result: 'TODO' }
  },
})
`

// ─── create ────────────────────────────────────────────────────────

function createProject(name: string) {
  const dir = resolve(name)

  if (existsSync(dir)) {
    console.error(`❌ Directory "${name}" already exists`)
    process.exit(1)
  }

  console.log(`✨ Creating AgentNova project: ${name}`)

  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'skills'), { recursive: true })
  mkdirSync(join(dir, 'src/tools'), { recursive: true })

  // package.json
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'tsx src/index.ts',
      build: 'tsc',
    },
    dependencies: {
      agentnova: '^0.1.0',
      ai: '^4.3.0',
      '@ai-sdk/openai': '^1.3.0',
      zod: '^3.24.0',
    },
    devDependencies: {
      typescript: '^5.8.0',
      tsx: '^4.19.0',
    },
  }, null, 2))

  // tsconfig.json
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      outDir: 'dist',
      rootDir: 'src',
    },
    include: ['src'],
  }, null, 2))

  // AGENT.md
  writeFileSync(join(dir, 'AGENT.md'), `# ${name} Agent Memory

## 偏好
- 用中文回复

## 项目约定
- 使用 pnpm
`)

  // src/index.ts
  writeFileSync(join(dir, 'src', 'index.ts'), `import { quickAgent } from 'agentnova'
import { createOpenAI } from '@ai-sdk/openai'

// 配置 Provider（支持任何 OpenAI 兼容 API）
const provider = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
})

const agent = quickAgent({
  router: createRouter(
    [{ id: 'default', model: provider('gpt-4o') }],
    'default',
  ),
  systemPrompt: \`你是一个智能助手，帮助用户完成任务。
你可以读写文件、执行命令。
用中文回复。\`,
  workingDir: process.cwd(),
})

// 运行
const prompt = process.argv[2]
if (!prompt) {
  console.log('Usage: pnpm dev "your prompt here"')
  process.exit(0)
}

const result = await agent.run(prompt, {
  onStep: (step) => {
    if (step.text) process.stdout.write(step.text)
    if (step.toolCalls?.length) {
      for (const tc of step.toolCalls) {
        process.stdout.write(\`\\n🔧 \${tc.tool}(\${JSON.stringify(tc.args)})\\n\`)
      }
    }
  },
})

console.log('\\n\\n✅ Done in', result.totalDurationMs, 'ms')
console.log('📊 Steps:', result.steps.length, '| Tokens:', result.state.totalTokensUsed)
`)

  // src/tools/.gitkeep
  writeFileSync(join(dir, 'src/tools/.gitkeep'), '')

  // .env.example
  writeFileSync(join(dir, '.env.example'), `# OpenAI Compatible API
OPENAI_API_KEY=sk-xxx
# OPENAI_BASE_URL=https://api.openai.com/v1

# DeepSeek
# OPENAI_API_KEY=sk-xxx
# OPENAI_BASE_URL=https://api.deepseek.com/v1

# 通义千问
# OPENAI_API_KEY=sk-xxx
# OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
`)

  // .gitignore
  writeFileSync(join(dir, '.gitignore'), `node_modules/
dist/
.env
*.log
`)

  console.log(`
✅ Project created!

  cd ${name}
  pnpm install
  cp .env.example .env  # 填入你的 API Key
  pnpm dev "你好，帮我看看当前目录有什么文件"
`)
}

// ─── add-tool ──────────────────────────────────────────────────────

function addTool(name?: string) {
  if (!name) {
    console.error('❌ Usage: agentnova add-tool <tool-name>')
    console.error('   Example: agentnova add-tool db.query')
    process.exit(1)
  }

  const toolsDir = resolve('src/tools')
  if (!existsSync(toolsDir)) {
    mkdirSync(toolsDir, { recursive: true })
  }

  // 把 tool name 中的点转为路径分隔，如 db.query → tools/db/query.ts
  const parts = name.split('.')
  const fileName = parts[parts.length - 1] + '.ts'
  const subDir = parts.length > 1
    ? join(toolsDir, ...parts.slice(0, -1))
    : toolsDir

  if (!existsSync(subDir)) {
    mkdirSync(subDir, { recursive: true })
  }

  const filePath = join(subDir, fileName)
  if (existsSync(filePath)) {
    console.error(`❌ File already exists: ${filePath}`)
    process.exit(1)
  }

  writeFileSync(filePath, TOOL_TEMPLATE(name))
  console.log(`✅ Tool created: ${filePath}`)
  console.log(`\n   记得在 src/index.ts 中导入并注册：`)
  console.log(`   import { ${camelCase(name)} } from './tools/${parts.join('/')}.js'`)
  console.log(`   // 加入 tools 数组: [..., ${camelCase(name)}]`)
}

// ─── add-skill ─────────────────────────────────────────────────────

function addSkill(name?: string) {
  if (!name) {
    console.error('❌ Usage: agentnova add-skill <skill-name>')
    console.error('   Example: agentnova add-skill code-review')
    process.exit(1)
  }

  const skillsDir = resolve('skills')
  const skillDir = join(skillsDir, name)

  if (existsSync(skillDir)) {
    console.error(`❌ Skill directory already exists: ${skillDir}`)
    process.exit(1)
  }

  mkdirSync(skillDir, { recursive: true })
  mkdirSync(join(skillDir, 'tools'), { recursive: true })
  mkdirSync(join(skillDir, 'knowledge'), { recursive: true })

  writeFileSync(join(skillDir, 'skill.config.json'), SKILL_TEMPLATE(name))
  writeFileSync(join(skillDir, 'SKILL.md'), SKILL_MD_TEMPLATE(name))
  writeFileSync(join(skillDir, 'tools', 'index.ts'), SKILL_TOOL_TEMPLATE(name))
  writeFileSync(join(skillDir, 'knowledge', '.gitkeep'), '')

  console.log(`✅ Skill created: ${skillDir}/`)
  console.log(`\n   文件结构：`)
  console.log(`   skills/${name}/`)
  console.log(`   ├── skill.config.json   # 技能配置`)
  console.log(`   ├── SKILL.md            # 技能提示词（LLM 读取）`)
  console.log(`   ├── tools/              # 技能专属工具`)
  console.log(`   └── knowledge/          # 技能知识库`)
  console.log(`\n   记得在创建 Agent 时指定 skillDirs: ['skills']`)
}

// ─── run ───────────────────────────────────────────────────────────

async function runAgent() {
  const prompt = args.slice(1).join(' ')
  if (!prompt) {
    console.error('❌ Usage: agentnova run "your prompt here"')
    process.exit(1)
  }

  // 动态加载项目入口
  const entryPath = resolve('src/index.ts')
  if (!existsSync(entryPath)) {
    console.error('❌ No src/index.ts found. Are you in an AgentNova project?')
    process.exit(1)
  }

  // 使用 tsx 直接运行
  const { exec } = await import('child_process')
  const child = exec(`npx tsx "${entryPath}" "${prompt.replace(/"/g, '\\"')}"`, {
    cwd: process.cwd(),
    env: { ...process.env },
  })

  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  child.on('exit', (code) => process.exit(code ?? 0))
}

// ─── skill commands ────────────────────────────────────────────────

async function skillCommand() {
  const sub = args[1]
  const skillsDir = resolve('skills')

  const { SkillRegistry } = await import('@agentnova/skills')
  const registry = new SkillRegistry({ skillsDir })
  await registry.load()

  switch (sub) {
    case 'list':
    case 'ls': {
      const skills = registry.list()
      if (skills.length === 0) {
        console.log('📋 No skills installed. Use `agentnova skill install <source>` to add one.')
        break
      }
      console.log('📋 Installed skills:\n')
      for (const s of skills) {
        console.log(`  ${s.name} v${s.version} — ${s.description}`)
        if (s.tags?.length) console.log(`    tags: ${s.tags.join(', ')}`)
      }
      break
    }

    case 'search': {
      const query = args.slice(2).join(' ')
      if (!query) {
        console.error('❌ Usage: agentnova skill search <query>')
        process.exit(1)
      }
      const results = registry.search(query)
      if (results.length === 0) {
        console.log(`🔍 No skills matching "${query}"`)
      } else {
        console.log(`🔍 Skills matching "${query}":\n`)
        for (const s of results) {
          console.log(`  ${s.name} v${s.version} — ${s.description}`)
        }
      }
      break
    }

    case 'install':
    case 'add': {
      const source = args[2]
      if (!source) {
        console.error('❌ Usage: agentnova skill install <git-repo-or-npm-package>')
        process.exit(1)
      }
      console.log(`📥 Installing skill from: ${source}`)
      try {
        const manifest = await registry.install(source)
        console.log(`✅ Installed: ${manifest.name} v${manifest.version}`)
        console.log(`   ${manifest.description}`)
      } catch (err: any) {
        console.error(`❌ Install failed: ${err.message}`)
        process.exit(1)
      }
      break
    }

    case 'uninstall':
    case 'remove':
    case 'rm': {
      const name = args[2]
      if (!name) {
        console.error('❌ Usage: agentnova skill uninstall <name>')
        process.exit(1)
      }
      const removed = await registry.uninstall(name)
      if (removed) {
        console.log(`🗑️  Uninstalled: ${name}`)
      } else {
        console.log(`⚠️  Skill "${name}" not found`)
      }
      break
    }

    case 'publish': {
      const skillName = args[2]
      if (!skillName) {
        console.error('❌ Usage: agentnova skill publish <skill-name> [--remote <git-url> | --registry <npm-url>]')
        process.exit(1)
      }

      // Parse options
      const remoteIdx = args.indexOf('--remote')
      const registryIdx = args.indexOf('--registry')
      const tagIdx = args.indexOf('--tag')
      const dryRunIdx = args.indexOf('--dry-run')

      const publishOpts: any = {}
      if (remoteIdx >= 0 && args[remoteIdx + 1]) publishOpts.remote = args[remoteIdx + 1]
      if (registryIdx >= 0 && args[registryIdx + 1]) publishOpts.registry = args[registryIdx + 1]
      if (tagIdx >= 0 && args[tagIdx + 1]) publishOpts.tag = args[tagIdx + 1]
      if (dryRunIdx >= 0) publishOpts.dryRun = true

      console.log(`📦 Publishing skill: ${skillName}`)
      try {
        const result = await registry.publish(skillName, publishOpts)
        console.log(result.message)
        if (result.url) console.log(`   🔗 ${result.url}`)
      } catch (err: any) {
        console.error(`❌ Publish failed: ${err.message}`)
        process.exit(1)
      }
      break
    }

    default:
      console.log(`
⚡ Skill commands:

  agentnova skill list               List installed skills
  agentnova skill search <query>     Search skills
  agentnova skill install <src>      Install from git repo or npm
  agentnova skill uninstall <name>   Remove a skill
  agentnova skill publish <name>     Publish to Git remote or npm registry
`)
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function camelCase(str: string): string {
  return str
    .replace(/[-_.](\w)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase())
}

function titleCase(str: string): string {
  return str
    .split(/[-_.]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ─── Main ──────────────────────────────────────────────────────────

if (!command) {
  console.log(`
🔮 AgentNova CLI — Universal Agent Development Framework

Commands:
  create <name>           Create a new agent project
  add-tool <name>         Add a custom tool (e.g. add-tool db.query)
  add-skill <name>        Add a skill template (e.g. add-skill code-review)
  run "prompt"            Run the agent in current project
  skill <subcommand>      Manage skills
  
  Skill subcommands:
    list                  List installed skills
    search <query>        Search available skills
    install <source>      Install from git repo or npm
    uninstall <name>      Remove a skill
    publish <name>        Package a skill for distribution

Examples:
  agentnova create my-agent && cd my-agent
  agentnova add-tool slack.notify
  agentnova add-skill code-review
  agentnova run "帮我看看有哪些文件"
`)
  process.exit(0)
}

switch (command) {
  case 'create':
  case 'new':
    if (!args[1]) {
      console.error('❌ Please provide a project name: agentnova create my-agent')
      process.exit(1)
    }
    createProject(args[1])
    break

  case 'add-tool':
    addTool(args[1])
    break

  case 'add-skill':
    addSkill(args[1])
    break

  case 'run':
    runAgent().catch(err => {
      console.error(`❌ ${err.message}`)
      process.exit(1)
    })
    break

  case 'skill':
    skillCommand().catch(err => {
      console.error(`❌ ${err.message}`)
      process.exit(1)
    })
    break

  case 'version':
  case '-v':
  case '--version':
    try {
      const pkg = JSON.parse(readFileSync(join(import.meta.dirname ?? '.', '../package.json'), 'utf-8'))
      console.log(`🔮 AgentNova v${pkg.version}`)
    } catch {
      console.log('🔮 AgentNova v0.1.0')
    }
    break

  default:
    console.error(`❌ Unknown command: "${command}"`)
    console.error('   Run "agentnova" for help')
    process.exit(1)
}
