/**
 * 流式输出 + 长期记忆示例 — 演示 runStream + remember + LongTermMemory
 *
 * 运行方式：
 *   pnpm install
 *   LLM_BASE_URL=https://api.deepseek.com/v1 LLM_API_KEY=xxx LLM_MODEL=deepseek-chat pnpm start
 *
 * 其他示例：
 *   # 通义千问
 *   LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 LLM_API_KEY=xxx LLM_MODEL=qwen-max pnpm start
 *
 *   # OpenAI
 *   LLM_BASE_URL=https://api.openai.com/v1 LLM_API_KEY=xxx LLM_MODEL=gpt-4o pnpm start
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

// ─── 交互式权限审批 ASK 回调 ───────────────────────────────────────
async function askApproval(req: { tool: string; args: Record<string, unknown>; permission: { level: string } }) {
  const rl = readline.createInterface({ input, output })
  try {
    console.log('\n⚠️  需要授权：工具 「' + req.tool + '」 (级别: ' + req.permission.level + ')')
    console.log('   参数: ' + JSON.stringify(req.args).slice(0, 200))
    const ans = (await rl.question('   [y] 允许一次  [a] 始终允许  [n] 拒绝  > ')).trim().toLowerCase()
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

// ─── 运行 ────────────────────────────────────────────────────────────

async function main() {
  const provider = createProviderFromEnv()
  console.log(`🔮 使用模型: ${provider.name}\n`)

  const router = createRouter([provider], provider.id)

  const agent = new Agent({
    systemPrompt: '你是雅典娜，一个擅长总结归纳的 AI 助手。用中文回复，简洁直接。',
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, ...shellTools],
    permissions: {
      mode: 'ask',
      onApprovalNeeded: askApproval,
    },
    // 启用长期记忆（SQLite 持久化）
    longTermMemory: {
      dbPath: './data/memory.db',
    },
  })

  // 预先存储一些项目记忆
  await agent.remember('project_style', '项目使用 TypeScript + pnpm workspace + Turbo monorepo', 'project')
  await agent.remember('team_rule', '代码审查必须通过才能合并', 'project')

  console.log('🧠 雅典娜已就位（带长期记忆）\n')

  const prompt = process.argv[2] ?? '帮我看看项目结构，然后给我一个合理的目录划分建议'
  console.log(`📝 Prompt: ${prompt}\n`)

  // 流式运行：通过 onStep 实时输出文本
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

  // 查看执行轨迹
  const trace = agent.getTrace()
  console.log(`\n📋 执行轨迹: ${trace.entries.length} 条记录`)
}

main().catch(console.error)
