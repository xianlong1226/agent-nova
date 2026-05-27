/**
 * Streaming + Memory — 流式输出 + 记忆系统
 */

import {
  createAgent,
  createRouter,
  deepseekChat,
  fsTools,
  shellTools,
} from 'agentnova'

async function main() {
  const router = createRouter([deepseekChat()], 'deepseek-chat')

  const agent = createAgent({
    systemPrompt: '你是雅典娜，一个擅长总结归纳的 AI 助手。用中文回复。',
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, ...shellTools],
    // 启用长期记忆
    longTermMemory: {
      dbPath: './data/memory.db',
    },
  })

  // 存储一些记忆
  await agent.remember('project_style', '项目使用 Vue 3 + TypeScript + Pinia', 'project')
  await agent.remember('team_rule', '代码审查必须通过才能合并', 'project')

  console.log('🧠 雅典娜已就位（带记忆）\n')

  // 流式运行
  const result = await agent.runStream('帮我看看项目结构，然后给我一个合理的目录划分建议', {
    onText: (chunk) => process.stdout.write(chunk),
    onStep: (step) => {
      if (step.toolCalls?.length) {
        console.log(`\n🔧 步骤 ${step.step}: ${step.toolCalls.map(t => t.tool).join(', ')}`)
      }
    },
  })

  console.log('\n\n📊 用量:', result.usage.totalTokens, 'tokens, $' + result.usage.estimatedCost.toFixed(4))

  // 查看轨迹
  const trace = agent.getTrace()
  console.log(`📝 执行轨迹: ${trace.entries.length} 条记录`)
}

main().catch(console.error)
