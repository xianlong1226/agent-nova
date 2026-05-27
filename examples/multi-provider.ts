/**
 * Multi-provider fallback — 多 Provider 降级链示例
 */

import {
  createAgent,
  createRouter,
  deepseekChat,
  openaiGPT4o,
  claudeHaiku35,
  type AgentEvent,
} from 'agentnova'
import { fsTools, shellTools } from 'agentnova'

async function main() {
  // 配置降级链：deepseek → gpt4o → claude-haiku
  const router = createRouter(
    [deepseekChat(), openaiGPT4o(), claudeHaiku35()],
    'deepseek-chat'
  )

  const agent = createAgent({
    systemPrompt: '你是一个可靠的编程助手，用中文回复。',
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, ...shellTools],
  })

  // 监听降级事件
  agent.on('provider:fallback', (event: AgentEvent) => {
    console.log(`\n🔄 Provider 降级: ${event.data.from} → 下一个 (原因: ${event.data.error})`)
  })

  const result = await agent.run('写一个简单的 HTTP 服务器，用 Node.js', {
    maxSteps: 15,
    onStep: (step) => {
      if (step.text) process.stdout.write(step.text)
    },
  })

  console.log('\n\n📊 执行轨迹:')
  const replay = agent.replayTrace()
  console.log(replay.summary())
}

main().catch(console.error)
