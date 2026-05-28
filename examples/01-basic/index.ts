/**
 * 基础示例 — 最简单的 AgentNova 用法
 *
 * 运行方式：
 *   pnpm install
 *   DEEPSEEK_API_KEY=xxx pnpm start "帮我看看当前目录有什么文件"
 *
 * 也支持 OpenAI：
 *   OPENAI_API_KEY=xxx OPENAI_BASE_URL=https://api.openai.com/v1 pnpm start "hello"
 */

import {
  Agent,
  createRouter,
  fsTools,
  shellTools,
} from 'agentnova'
import { createOpenAI } from '@ai-sdk/openai'

// 从环境变量中选择 Provider
function createProvider() {
  if (process.env.DEEPSEEK_API_KEY) {
    const deepseek = createOpenAI({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY,
    })
    return { id: 'deepseek', model: deepseek('deepseek-chat'), name: 'DeepSeek' }
  }

  const openai = createOpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
  })
  return { id: 'openai', model: openai('gpt-4o-mini'), name: 'OpenAI' }
}

async function main() {
  const provider = createProvider()
  console.log(`🔮 使用模型: ${provider.name}\n`)

  const router = createRouter([provider], provider.id)

  const agent = new Agent({
    systemPrompt: `你是一个智能助手，帮助用户完成各种任务。
你可以读写文件、执行命令来完成任务。
用中文回复，简洁直接。`,
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, ...shellTools],
    permissions: {
      mode: 'auto',
    },
  })

  const prompt = process.argv[2] ?? '你好，帮我看看当前目录有什么文件'
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

  // 执行轨迹回放
  const trace = agent.getTrace()
  console.log(`\n📋 执行轨迹: ${trace.entries.length} 条记录`)
}

main().catch(console.error)
