/**
 * 自定义工具示例 — 展示如何创建和使用自定义工具
 */

import { z } from 'zod'
import {
  Agent,
  createRouter,
  defineTool,
  fsTools,
} from 'agentnova'
import { createOpenAI } from '@ai-sdk/openai'

// ─── 自定义工具：天气查询 ──────────────────────────────────────

const weatherTool = defineTool({
  name: 'weather.query',
  description: '查询指定城市的天气信息',
  parameters: z.object({
    city: z.string().describe('城市名称'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('温度单位'),
  }),
  permission: {
    level: 'read',
    description: '查询天气信息（只读）',
  },
  execute: async ({ city, unit }) => {
    // 模拟天气数据（实际应用中调用真实 API）
    const mockData: Record<string, { temp: number; condition: string }> = {
      '北京': { temp: 26, condition: '晴' },
      '上海': { temp: 28, condition: '多云' },
      '深圳': { temp: 32, condition: '阵雨' },
      '杭州': { temp: 25, condition: '阴' },
    }

    const data = mockData[city]
    if (!data) {
      return { error: `未找到城市 "${city}" 的天气数据` }
    }

    const temp = unit === 'fahrenheit' ? data.temp * 9/5 + 32 : data.temp
    const unitSymbol = unit === 'fahrenheit' ? '°F' : '°C'

    return {
      city,
      temperature: `${temp}${unitSymbol}`,
      condition: data.condition,
      humidity: '65%',
      wind: '东北风 3级',
    }
  },
})

// ─── 自定义工具：数学计算 ──────────────────────────────────────

const mathTool = defineTool({
  name: 'math.calculate',
  description: '计算数学表达式',
  parameters: z.object({
    expression: z.string().describe('数学表达式，如 "2 + 3 * 4"'),
  }),
  permission: { level: 'read' },
  execute: async ({ expression }) => {
    try {
      // 简单安全检查：只允许数字和运算符
      if (!/^[\d\s+\-*/().%]+$/.test(expression)) {
        return { error: '表达式包含不允许的字符' }
      }
      const result = Function(`"use strict"; return (${expression})`)()
      return { expression, result: Number(result) }
    } catch (err: any) {
      return { error: `计算失败: ${err.message}` }
    }
  },
})

// ─── 运行 ────────────────────────────────────────────────────────

async function main() {
  const provider = createOpenAI({
    baseURL: process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  })

  const router = createRouter(
    [{ id: 'default', model: provider('deepseek-chat'), name: 'DeepSeek' }],
    'default',
  )

  const agent = new Agent({
    systemPrompt: '你是天气和数学助手，用中文回复。可以查询天气和做数学计算。',
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, weatherTool, mathTool],
    permissions: { mode: 'auto' },
  })

  const prompt = process.argv[2] ?? '北京今天天气怎么样？顺便帮我算一下 (26 + 14) * 3'
  console.log(`📝 ${prompt}\n`)

  const result = await agent.run(prompt, {
    onStep: (step) => {
      if (step.text) process.stdout.write(step.text)
      if (step.toolResults?.length) {
        for (const tr of step.toolResults) {
          console.log(`\n✅ ${tr.tool}: ${typeof tr.output === 'object' ? JSON.stringify(tr.output) : tr.output}`)
        }
      }
    },
  })

  console.log('\n\n📊 Steps:', result.steps.length, '| Duration:', result.totalDurationMs + 'ms')
}

main().catch(console.error)
