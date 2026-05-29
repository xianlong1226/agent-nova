/**
 * 多 Provider 路由示例 — 展示模型路由 + 降级链
 *
 * 配置：
 *   - 简单任务 → DeepSeek（便宜）
 *   - 复杂任务 → GPT-4o（强）
 *   - 编码任务 → Claude Sonnet（代码专精）
 *   - 降级链：primary → deepseek → qwen（兜底）
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

async function main() {
  // ─── 1. 配置多个 Provider ─────────────────────────────────

  const deepseek = createOpenAICompatibleProvider({
    id: 'deepseek',
    name: 'DeepSeek',
    model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY,
    costInputPer1M: 0.14,
    costOutputPer1M: 0.28,
  })

  const openai = createOpenAICompatibleProvider({
    id: 'openai',
    name: 'GPT-4o',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY,
    costInputPer1M: 2.5,
    costOutputPer1M: 10,
  })

  const qwen = createOpenAICompatibleProvider({
    id: 'qwen',
    name: 'Qwen Max',
    model: 'qwen-max',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.QWEN_API_KEY,
    costInputPer1M: 1.6,
    costOutputPer1M: 6.4,
  })

  // ─── 2. 创建路由：按任务复杂度分流 ────────────────────────

  const router = createRouter(
    [deepseek, openai, qwen],
    'deepseek',                    // 默认用 DeepSeek（最便宜）
    ['deepseek', 'qwen', 'openai'], // 降级链
  )

  // ─── 3. 创建 Agent ────────────────────────────────────────

  const agent = new Agent({
    systemPrompt: '你是一个多模型 Agent，按任务复杂度自动选择最佳模型。用中文回复。',
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, ...shellTools],
    permissions: {
      mode: 'ask',
      onApprovalNeeded: askApproval,
    },
  })

  // ─── 4. 运行不同复杂度的任务 ──────────────────────────────

  const tasks = [
    '你好，简单打个招呼',              // 简单 → deepseek
    '帮我分析当前项目的架构和技术栈',   // 复杂 → openai
  ]

  for (const task of tasks) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`📝 任务: ${task}\n`)

    const result = await agent.run(task, { maxSteps: 8 })

    console.log(`\n📊 Steps: ${result.steps.length} | Tokens: ${result.usage?.totalTokens} | Cost: $${result.usage?.estimatedCost.toFixed(4)}`)
  }

  // ─── 5. 展示执行轨迹 ──────────────────────────────────────

  const trace = agent.getTrace()
  console.log(`\n📋 完整轨迹: ${trace.entries.length} 条记录`)
  console.log(`💰 总费用: $${agent.getUsage().estimatedCost.toFixed(4)}`)
}

main().catch(console.error)
