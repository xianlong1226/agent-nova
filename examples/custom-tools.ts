/**
 * Custom Tools — 自定义工具示例
 */

import { defineTool } from 'agentnova'
import { z } from 'zod'

// 自定义天气工具
export const weatherTool = defineTool({
  name: 'weather.get',
  description: '获取指定城市的天气信息',
  parameters: z.object({
    city: z.string().describe('城市名称'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius'),
  }),
  permission: { level: 'read' },
  execute: async (args) => {
    // 模拟天气 API
    const temp = Math.floor(Math.random() * 35 + 5)
    const conditions = ['晴', '多云', '小雨', '大风', '阴']
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    
    return {
      city: args.city,
      temperature: args.unit === 'fahrenheit' ? temp * 9/5 + 32 : temp,
      unit: args.unit ?? 'celsius',
      condition,
      humidity: Math.floor(Math.random() * 60 + 30),
    }
  },
})

// 自定义代码搜索工具
export const codeSearchTool = defineTool({
  name: 'code.search',
  description: '在项目中搜索代码片段',
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
    language: z.string().optional().describe('编程语言'),
    maxResults: z.number().optional().default(20),
  }),
  permission: { level: 'read' },
  execute: async (args, ctx) => {
    // 使用 shell 工具搜索
    const pattern = args.language 
      ? `--include="*.${args.language}" "${args.query}"`
      : `"${args.query}"`
    const cmd = `grep -r -n ${pattern} ${ctx.workingDir} --include="*.ts" --include="*.js" --include="*.vue" | head -${args.maxResults}`
    // 实际使用时通过 shell 工具执行
    return { command: cmd, note: '实际搜索通过 shell.exec 工具完成' }
  },
})

// 使用自定义工具
import { createAgent, createRouter, deepseekChat } from 'agentnova'

async function main() {
  const agent = createAgent({
    systemPrompt: '你是一个全能助手，可以查询天气和搜索代码。用中文回复。',
    workingDir: process.cwd(),
    router: createRouter([deepseekChat()], 'deepseek-chat'),
    tools: [weatherTool, codeSearchTool],
  })

  const result = await agent.run('北京今天天气怎么样？')
  console.log(result.text)
}

main().catch(console.error)
