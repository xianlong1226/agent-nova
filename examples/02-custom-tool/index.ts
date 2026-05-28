/**
 * 自定义工具示例 — 展示如何创建和使用自定义工具
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
 */

import { z } from 'zod'
import {
  Agent,
  createRouter,
  createOpenAICompatibleProvider,
  defineTool,
  fsTools,
} from 'agentnova'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

// ─── 交互式权限审批 ASK 回调 ───────────────────────────────────────
async function askApproval(req: { tool: string; args: Record<string, unknown>; permission: { level: string } }) {
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
  const baseURL = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL

  if (!baseURL || !apiKey || !model) {
    console.error('❌ 请设置环境变量：LLM_BASE_URL, LLM_API_KEY, LLM_MODEL')
    process.exit(1)
  }

  const provider = createOpenAICompatibleProvider({
    id: 'custom-llm',
    name: `Custom (${model})`,
    model,
    baseURL,
    apiKey,
  })

  const router = createRouter([provider], 'custom-llm')

  const agent = new Agent({
    systemPrompt: '你是天气和数学助手，用中文回复。可以查询天气和做数学计算。',
    workingDir: process.cwd(),
    router,
    tools: [...fsTools, weatherTool, mathTool],
    permissions: {
      mode: 'ask',
      onApprovalNeeded: askApproval,
    },
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
