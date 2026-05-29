/**
 * 自定义端点示例 — 演示如何使用自定义 baseUrl、apiKey、model
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
 *
 *   # 本地 Ollama
 *   LLM_BASE_URL=http://localhost:11434/v1 LLM_API_KEY=ollama LLM_MODEL=qwen2.5-coder:7b pnpm start
 */

import {
  Agent,
  createRouter,
  createOpenAICompatibleProvider,
  fsTools,
  shellTools,
  type ApprovalRequest,
} from 'agentnova'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

// ─── 交互式权限审批 ASK 回调 ───────────────────────────────────────
// 调用敏感工具（shell.exec / fs.writeFile 等）时弹出询问
async function askApproval(req: ApprovalRequest) {
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

// ─── 推荐方式：使用 createOpenAICompatibleProvider ────────────────────
// 最简洁的方式，一行搞定自定义 baseURL / apiKey / model

function createProviderFromEnv() {
  const baseURL = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL

  if (!baseURL || !apiKey || !model) {
    console.error('❌ 请设置环境变量：LLM_BASE_URL, LLM_API_KEY, LLM_MODEL')
    process.exit(1)
  }

  // 一个函数调用完成 baseURL / apiKey / model 配置
  return createOpenAICompatibleProvider({
    id: 'custom-llm',
    name: `Custom (${model})`,
    model,
    baseURL,
    apiKey,
  })
}

// ─── 下沉方式：直接使用 @ai-sdk/openai 的 createOpenAI ───────────────
// 适合需要精细控制的场景（自定义 fetch / headers / 重试等）
//
// import { createOpenAI } from '@ai-sdk/openai'
//
// const client = createOpenAI({
//   baseURL: 'https://api.deepseek.com/v1',
//   apiKey: 'sk-xxx',
// })
//
// const provider = {
//   id: 'deepseek',
//   name: 'DeepSeek Chat',
//   model: client('deepseek-chat'),
// }

// ─── 运行 ────────────────────────────────────────────────────────────

async function main() {
  const provider = createProviderFromEnv()
  console.log(`🔮 使用自定义端点: ${provider.name}\n`)

  const router = createRouter([provider], provider.id)

  const agent = new Agent({
    systemPrompt: `你是一个智能助手，帮助用户完成各种任务。
你可以读写文件、执行命令来完成任务。
用中文回复，简洁直接。`,
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, ...shellTools],
    permissions: {
      mode: 'ask',
      onApprovalNeeded: askApproval,
    },
  })

  const prompt = process.argv[2] ?? '你好，帮我看看电脑上都安装了哪些软件'
  console.log(`📝 Prompt: ${prompt}\n`)

  const result = await agent.run(prompt, {
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
