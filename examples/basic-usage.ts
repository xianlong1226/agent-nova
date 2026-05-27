/**
 * Basic usage — 最简单的 Agent 示例
 * 
 * 需要 DEEPSEEK_API_KEY 环境变量
 */

import {
  createAgent,
  createRouter,
  deepseekChat,
  fsTools,
  shellTools,
} from 'agentnova'

async function main() {
  // 1. 创建 Provider 路由
  const router = createRouter([deepseekChat()], 'deepseek-chat')

  // 2. 创建 Agent
  const agent = createAgent({
    systemPrompt: `你是宙斯，一个技术架构师 AI 助手。
用中文回复，简洁直接，给结论再列要点。`,
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, ...shellTools],
    permissions: {
      mode: 'auto',
      rules: [
        { tool: 'fs.*', level: 'write' },
        { tool: 'shell.exec', level: 'write', scope: ['npm *', 'ls *', 'cat *', 'git *'] },
      ],
    },
  })

  // 3. 运行
  console.log('🔮 宙斯已就位\n')

  const result = await agent.run('帮我看看当前目录有什么文件，然后总结一下项目结构', {
    maxSteps: 10,
    onStep: (step) => {
      if (step.text) process.stdout.write(step.text)
      if (step.toolCalls?.length) {
        for (const tc of step.toolCalls) {
          console.log(`\n🔧 ${tc.tool}(${JSON.stringify(tc.args).slice(0, 100)})`)
        }
      }
    },
  })

  console.log('\n\n--- 结果 ---')
  console.log('耗时:', result.totalDurationMs, 'ms')
  console.log('步骤:', result.steps.length)
  console.log('Tokens:', result.usage.totalTokens)
  console.log('费用:', `$${result.usage.estimatedCost.toFixed(4)}`)
}

main().catch(console.error)
