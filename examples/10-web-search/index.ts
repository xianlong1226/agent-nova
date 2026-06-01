/**
 * Web 搜索示例 — 演示 web.search 工具 + 域名白名单
 *
 * 本示例展示：
 *   1. 使用内置 webSearchTools（默认 Tavily 后端）
 *   2. 通过 sandbox.allowedSearchDomains 配置域名白名单
 *   3. 使用 createWebSearchTool 自定义搜索后端
 *
 * 运行方式：
 *   pnpm install
 *   TAVILY_API_KEY=tvly-xxx \
 *   LLM_BASE_URL=https://api.deepseek.com/v1 \
 *   LLM_API_KEY=xxx \
 *   LLM_MODEL=deepseek-chat \
 *   pnpm start
 *
 * 也可以跳过真实搜索，使用 mock 模式演示白名单机制：
 *   LLM_BASE_URL=https://api.deepseek.com/v1 \
 *   LLM_API_KEY=xxx \
 *   LLM_MODEL=deepseek-chat \
 *   USE_MOCK=true pnpm start
 */

import {
  Agent,
  createRouter,
  createOpenAICompatibleProvider,
  webSearchTools,
  createWebSearchTool,
  type ApprovalRequest,
  type SearchProvider,
} from 'agentnova'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

// ─── 交互式权限审批回调 ──────────────────────────────────────────
async function askApproval(req: ApprovalRequest) {
  const rl = readline.createInterface({ input, output })
  try {
    console.log(`\n⚠️  需要授权：工具 「${req.tool}」 (级别: ${req.permission.level})`)
    console.log('   参数: ' + JSON.stringify(req.args).slice(0, 200))
    const ans = (await rl.question('   [y] 允许一次  [a] 始终允许  [n] 拒绝  > ')).trim().toLowerCase()
    if (ans === 'a' || ans === 'always') return 'allow-always' as const
    if (ans === 'y' || ans === 'yes') return 'allow-once' as const
    return 'deny' as const
  } finally {
    rl.close()
  }
}

// ─── Mock 搜索后端（无需 API Key，演示白名单过滤效果） ────────────
const mockSearch: SearchProvider = async (query, maxResults) => {
  console.log(`  [mock] 模拟搜索: "${query}" (max=${maxResults})`)

  // 返回多个域名的混合结果，用于演示白名单过滤
  const allResults = [
    { title: 'GitHub - AgentNova', url: 'https://github.com/agentnova/sdk', snippet: 'AgentNova SDK repo on GitHub' },
    { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/docs/Web', snippet: 'MDN web development documentation' },
    { title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/12345', snippet: 'How to use web search API' },
    { title: 'Random Blog', url: 'https://random-blog.example.com/post', snippet: 'Some unrelated content' },
    { title: 'GitHub Actions Guide', url: 'https://docs.github.com/actions', snippet: 'Automate workflows with GitHub Actions' },
    { title: 'NPM Package', url: 'https://www.npmjs.com/package/agentnova', snippet: 'AgentNova on npm' },
  ]

  // 简单模拟：按 query 内的关键词过滤（模拟搜索引擎语义匹配）
  const filtered = query.includes('site:')
    ? allResults.filter(r => {
        const siteMatch = query.match(/site:(\S+)/)
        return siteMatch ? r.url.includes(siteMatch[1]) : true
      })
    : allResults

  return filtered.slice(0, maxResults)
}

// ─── 主流程 ──────────────────────────────────────────────────────

async function main() {
  const baseURL = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL
  const useMock = process.env.USE_MOCK === 'true'

  if (!baseURL || !apiKey || !model) {
    console.error('❌ 请设置环境变量：LLM_BASE_URL, LLM_API_KEY, LLM_MODEL')
    process.exit(1)
  }

  if (!useMock && !process.env.TAVILY_API_KEY) {
    console.error('❌ 请设置 TAVILY_API_KEY 或使用 USE_MOCK=true 模式')
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

  // ── 选择搜索工具：mock 或真实 Tavily ──
  const searchTools = useMock
    ? [createWebSearchTool({ provider: mockSearch })]
    : webSearchTools

  console.log(`🔍 搜索后端: ${useMock ? 'Mock (演示白名单)' : 'Tavily API'}`)
  console.log(`🌐 域名白名单: github.com, stackoverflow.com, developer.mozilla.org\n`)

  const agent = new Agent({
    systemPrompt: [
      '你是一个具备网络搜索能力的助手。',
      '当用户提问时，你应该使用 web.search 工具进行搜索并基于结果回答。',
      '请用中文回复，并标注信息来源的 URL。',
    ].join('\n'),
    workingDir: process.cwd(),
    router,
    tools: searchTools,
    permissions: {
      mode: 'ask',
      onApprovalNeeded: askApproval,
      // ── 域名白名单：仅允许搜索结果来自以下域名 ──
      sandbox: {
        allowedSearchDomains: [
          'github.com',
          'stackoverflow.com',
          'developer.mozilla.org',
        ],
      },
      // web.search 为 read 级别，直接放行（由 sandbox + preflight 兜底安全）
      rules: [
        { tool: 'web.search', mode: 'allow' },
      ],
    },
  })

  const prompt = process.argv[2] ?? '搜索 AgentNova SDK 的 GitHub 仓库信息'
  console.log(`📝 ${prompt}\n`)

  const result = await agent.run(prompt, {
    maxSteps: 5,
    onStep: (step) => {
      if (step.text) process.stdout.write(step.text)
      if (step.toolCalls?.length) {
        for (const tc of step.toolCalls) {
          console.log(`\n🔧 ${tc.tool}(${JSON.stringify(tc.args).slice(0, 200)})`)
        }
      }
      if (step.toolResults?.length) {
        for (const tr of step.toolResults) {
          const tag = tr.error ? '🛑' : '✅'
          const detail = tr.error
            ? `error=${tr.error}`
            : Array.isArray(tr.output)
              ? `${(tr.output as any[]).length} results`
              : JSON.stringify(tr.output).slice(0, 150)
          console.log(`${tag} ${tr.tool}: ${detail}`)
        }
      }
    },
  })

  console.log('\n\n--- 运行统计 ---')
  console.log(`⏱  耗时: ${result.totalDurationMs}ms`)
  console.log(`📊 步骤: ${result.steps.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
