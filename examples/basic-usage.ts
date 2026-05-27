/**
 * AgentNova 基础使用示例
 */

import { createAgent } from '@agentnova/core'
import { fsTools, shellTools } from '@agentnova/tools'
import { createRouter, deepseekChat, openaiGPT4o } from '@agentnova/providers'
import { DEFAULT_PERMISSION_CONFIG } from '@agentnova/permission'

async function main() {
  // 1. 设置 Provider 路由
  const router = createRouter(
    [deepseekChat(), openaiGPT4o()],
    'deepseek-chat',
    ['openai-gpt4o'],  // 降级链
  )

  // 2. 创建 Agent
  const agent = createAgent({
    systemPrompt: `你是一个智能开发助手，帮助用户完成编程任务。
你可以读写文件、执行命令。
用中文回复。每次操作前先说明你要做什么。`,
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, ...shellTools],
    permissions: {
      mode: 'ask',
      rules: [
        // 读文件自动放行
        { tool: 'fs.readFile', mode: 'allow' },
        { tool: 'fs.listDir', mode: 'allow' },
        // 写文件需要审批
        { tool: 'fs.writeFile', mode: 'ask' },
        // shell 命令需要审批
        { tool: 'shell.exec', mode: 'ask' },
      ],
      // 审批回调（实际应用中接入 UI）
      onApprovalNeeded: async (request) => {
        console.log(`\n⚠️  需要审批: ${request.tool}`)
        console.log(`   参数: ${JSON.stringify(request.args, null, 2)}`)
        // 自动批准（演示用，生产环境需要人工确认）
        return 'allow-once'
      },
    },
  })

  // 3. 注册事件监听
  agent.on('tool:call', (event) => {
    console.log(`🔧 调用工具: ${event.data.tool}`)
  })

  agent.on('tool:result', (event) => {
    const result = event.data.result
    console.log(`📤 工具结果: ${result.error ? `❌ ${result.error}` : '✅ 成功'}`)
  })

  // 4. 运行 Agent
  const result = await agent.run('帮我看看当前目录下有什么文件，然后读取 package.json 的内容', {
    onStep: (step) => {
      if (step.text) process.stdout.write(step.text)
    },
  })

  console.log('\n\n📊 结果:')
  console.log(`  步骤数: ${result.steps.length}`)
  console.log(`  Token 使用: ${result.state.totalTokensUsed}`)
  console.log(`  耗时: ${result.totalDurationMs}ms`)
}

main().catch(console.error)
