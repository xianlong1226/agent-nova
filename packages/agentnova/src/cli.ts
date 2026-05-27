#!/usr/bin/env node
/**
 * AgentNova CLI — Quick scaffolding for agent projects
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const args = process.argv.slice(2)
const command = args[0]

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
  mkdirSync(join(dir, 'src'), { recursive: true })

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
      agentnova: 'workspace:*',
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
  writeFileSync(join(dir, 'AGENT.md'), `# ${name} Agent Memory\n\n## 偏好\n- 用中文回复\n\n## 项目约定\n- 使用 pnpm\n`)

  // src/index.ts
  writeFileSync(join(dir, 'src', 'index.ts'), `import { quickAgent, deepseekChat, createRouter } from 'agentnova'

const agent = quickAgent({
  model: 'deepseek-chat',
  router: createRouter([deepseekChat()], 'deepseek-chat'),
  systemPrompt: \`你是一个智能助手，帮助用户完成任务。
你可以读写文件、执行命令。
用中文回复。\`,
  workingDir: process.cwd(),
})

// 运行
const prompt = process.argv[2]
if (!prompt) {
  console.log('Usage: npm run dev "your prompt here"')
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

  console.log(`
✅ Project created!

  cd ${name}
  pnpm install
  pnpm dev "你好，帮我看看当前目录有什么文件"
`)
}

// ─── Main ──────────────────────────────────────────────────────────

if (!command) {
  console.log(`
🔮 AgentNova CLI

Commands:
  create <name>    Create a new agent project
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
  default:
    console.error(`❌ Unknown command: "${command}"`)
    process.exit(1)
}
