/**
 * Skill 加载示例 — 演示 Agent 内置的 skillDirs 自动加载机制
 *
 * 关键点：只需给 Agent 传入 `skillDirs`，AgentNova 会自动：
 *   - 通过 SkillLoader 扫描目录，加载每个子目录下的 skill.config.json
 *   - 解析 SKILL.md 与 knowledge 文件，组合成 Skill prompt
 *   - 在用户输入时基于 Skill 的 activateOn 谓词自动激活
 *   - 激活后将 Skill prompt 注入 systemPrompt，并把 Skill 的工具注册到 registry
 *   - 通过 `skill:activated` 事件对外通知
 *
 * 运行方式：
 *   pnpm install
 *   LLM_BASE_URL=https://api.deepseek.com/v1 LLM_API_KEY=xxx LLM_MODEL=deepseek-chat \
 *     pnpm start "帮我 review 一下 README.md"
 */

import {
  Agent,
  createRouter,
  createOpenAICompatibleProvider,
  fsTools,
  shellTools,
} from 'agentnova'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 仓库根目录的 skills/ —— 内含 code-review、git-ops 两个 Skill
const SKILLS_ROOT = resolve(__dirname, '../../skills')

// ─── 交互式权限审批 ASK 回调 ───────────────────────────────────────
async function askApproval(req: {
  tool: string
  args: Record<string, unknown>
  permission: { level: string }
}) {
  const rl = readline.createInterface({ input, output })
  try {
    console.log('\n⚠️  需要授权：工具 「' + req.tool + '」 (级别: ' + req.permission.level + ')')
    console.log('   参数: ' + JSON.stringify(req.args).slice(0, 200))
    const ans = (await rl.question('   [y] 允许一次  [a] 始终允许  [n] 拒绝  > '))
      .trim()
      .toLowerCase()
    if (ans === 'a' || ans === 'always') return 'allow-always' as const
    if (ans === 'y' || ans === 'yes') return 'allow-once' as const
    return 'deny' as const
  } finally {
    rl.close()
  }
}

// ─── 从环境变量创建 Provider ────────────────────────────────────────
function createProviderFromEnv() {
  const baseURL = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL

  if (!baseURL || !apiKey || !model) {
    console.error('❌ 请设置环境变量：LLM_BASE_URL, LLM_API_KEY, LLM_MODEL')
    process.exit(1)
  }

  return createOpenAICompatibleProvider({
    id: 'custom-llm',
    name: `Custom (${model})`,
    model,
    baseURL,
    apiKey,
  })
}

// ─── 主流程 ────────────────────────────────────────────────────────
async function main() {
  const provider = createProviderFromEnv()
  console.log(`🔮 使用模型：${provider.name}`)
  console.log(`📂 Skill 目录：${SKILLS_ROOT}\n`)

  const agent = new Agent({
    systemPrompt: '你是一个研发助手，会根据当前激活的 Skill 调整工作流程。用中文回复，简洁直接。',
    workingDir: process.cwd(),
    router: createRouter([provider], provider.id),
    tools: [...fsTools, ...shellTools],
    permissions: {
      mode: 'ask',
      onApprovalNeeded: askApproval,
    },
    // ── 关键：把 Skill 目录交给 Agent，由 SDK 内部自动加载与激活 ──
    skillDirs: [SKILLS_ROOT],
  })

  // 监听 Skill 激活事件，便于观察 SDK 的内部行为
  agent.on('skill:activated', (e) => {
    console.log(`\n✨ 已激活 Skill：${(e.data.skills as string[]).join(', ')}\n`)
  })

  const prompt = process.argv[2] ?? '帮我 review 一下当前项目的 README.md，给出代码审查报告'
  console.log(`📝 Prompt: ${prompt}\n`)

  const result = await agent.runStream(prompt, {
    maxSteps: 10,
    onStep: (step) => {
      if (step.text) process.stdout.write(step.text)
      if (step.toolCalls?.length) {
        for (const tc of step.toolCalls) {
          console.log(`\n🔧 ${tc.tool}(${JSON.stringify(tc.args).slice(0, 120)})`)
        }
      }
    },
  })

  console.log('\n\n--- 运行统计 ---')
  console.log(`⏱  耗时: ${result.totalDurationMs}ms`)
  console.log(`📊 步骤: ${result.steps.length}`)
  if (result.usage) {
    console.log(`🔤 Tokens: ${result.usage.totalTokens}`)
    console.log(`💰 预估费用: $${result.usage.estimatedCost.toFixed(4)}`)
  }
}

main().catch(console.error)
