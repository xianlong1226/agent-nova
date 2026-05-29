/**
 * Context 配置示例 — 演示 Agent 的上下文管理能力
 *
 * Agent 内置 ContextManager 负责：
 *   - 工具输出截断   （maxToolOutputLength + toolOutputTruncate）
 *   - 上下文压缩触发 （compressionTriggerRatio + contextWindowOverrides）
 *   - 压缩策略选择   （compressionStrategy: summary | sliding-window | hybrid）
 *   - 保留近 N 轮对话不参与压缩 （preserveRecentTurns）
 *   - 摘要 token 预算（maxSummaryTokens）
 *   - 预压缩阈值     （preemptiveThreshold）
 *
 * 本示例：
 *   1) 显式传入 `context` 配置，缩小 tool 输出与上下文窗口以触发管理逻辑
 *   2) 让 Agent 读取/列出较大的目录，模拟产生长 tool 输出
 *   3) 监听 `context:compressed` 事件观察压缩触发
 *
 * 运行方式：
 *   pnpm install
 *   LLM_BASE_URL=https://api.deepseek.com/v1 LLM_API_KEY=xxx LLM_MODEL=deepseek-chat \
 *     pnpm start "列出 packages 目录所有 .ts 文件并给出一个高层概览"
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
  console.log(`🔮 使用模型：${provider.name}\n`)

  const agent = new Agent({
    systemPrompt: '你是研发助手。基于工具返回结果做总结，回复简洁。',
    workingDir: process.cwd(),
    router: createRouter([provider], provider.id),
    tools: [...fsTools, ...shellTools],
    permissions: {
      mode: 'ask',
      onApprovalNeeded: askApproval,
    },
    // ── 关键：显式定制 ContextManager 行为 ──────────────────────────
    context: {
      // 工具输出超过该长度会被截断（默认 8000）
      maxToolOutputLength: 1200,
      // 截断方向：保留尾部（默认 'tail'），保留头部用 'head'
      toolOutputTruncate: 'tail',
      // 故意把 provider 的上下文窗口压到 8K，便于触发压缩演示
      contextWindowOverrides: {
        'custom-llm': 8_000,
      },
      // 已用 token 占窗口的比例超过该值即触发压缩
      compressionTriggerRatio: 0.5,
      // 压缩策略：summary（LLM 摘要）/ sliding-window（仅保留最近）/ hybrid（混合）
      compressionStrategy: 'hybrid',
      // 保留最近 N 轮不参与压缩
      preserveRecentTurns: 4,
      // 摘要最多生成多少 token
      maxSummaryTokens: 500,
      // 预压缩阈值：预测下次调用会超出该比例时提前压缩
      preemptiveThreshold: 0.8,
    },
  })

  // 监听 context:compressed 事件
  agent.on('context:compressed', (e) => {
    const { originalTokens, compressedTokens, strategy, step } = e.data as {
      step: number
      originalTokens: number
      compressedTokens: number
      strategy: string
    }
    const saved = originalTokens - compressedTokens
    const ratio = ((saved / originalTokens) * 100).toFixed(1)
    console.log(
      `\n🗜️  [step ${step}] context 压缩触发：${originalTokens} → ${compressedTokens} tokens ` +
        `(策略=${strategy}, 节省 ${saved} tokens / ${ratio}%)\n`,
    )
  })

  agent.on('tool:result', (e) => {
    const { tool, output: toolOutput } = e.data as { tool: string; output?: string }
    if (toolOutput) {
      console.log(`\n📦 ${tool} 输出长度：${toolOutput.length} 字符（受 maxToolOutputLength 约束）`)
    }
  })

  const prompt = process.argv[2] ?? '列出 packages 目录下所有 .ts 文件并给出一个高层概览'
  console.log(`📝 Prompt: ${prompt}\n`)

  const result = await agent.run(prompt, {
    maxSteps: 8,
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
