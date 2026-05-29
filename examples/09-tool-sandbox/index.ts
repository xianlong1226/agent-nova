/**
 * 工具沙箱示例 — 演示 AgentNova 的两层沙箱机制
 *
 *   A. 内置 Sandbox 配置（permissions.sandbox）
 *      • allowedDirs            限制 fs.* 工具仅能访问指定目录
 *      • blockedCommands        shell.exec 命中即拒绝（精确包含）
 *      • blockedCommandPatterns shell.exec 命中即拒绝（正则）
 *      • maxFileSize            fs.writeFile 写入大小上限
 *
 *   B. 自定义工具自带 ToolPreflight 钩子
 *      • http.fetch  —— URL 白名单 + 元数据 IP 拦截
 *      • db.query    —— 危险 SQL 语句拦截（DROP / 无 WHERE 的 DELETE）
 *
 *   两层 preflight 都在 PermissionGuard.check() 调用 approvalFn 之前执行，
 *   命中即直接 deny，不会触发 ASK 询问。
 *
 * 运行方式：
 *   pnpm install
 *   LLM_BASE_URL=https://api.deepseek.com/v1 LLM_API_KEY=xxx LLM_MODEL=deepseek-chat pnpm start
 */

import { z } from 'zod'
import {
  Agent,
  createRouter,
  createOpenAICompatibleProvider,
  defineTool,
  fsTools,
  shellTools,
  type ApprovalRequest,
  type ToolPreflight,
} from 'agentnova'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SANDBOX_DIR = resolve(__dirname, './tmp-sandbox')

// ─── 交互式权限审批回调（沙箱拦截优先于此回调，被拒绝时不会询问） ────
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

// ─── 自定义工具 1：http.fetch（演示 URL 白名单 preflight） ─────────

const HTTP_ALLOWED_PREFIXES = [
  'https://api.github.com/',
  'https://api.weatherapi.com/',
  'https://httpbin.org/',
]

const httpFetchPreflight: ToolPreflight = (req) => {
  const url = String(req.args.url ?? '')

  // 拒绝云元数据 IP（典型 SSRF 攻击目标）
  if (/(^https?:\/\/)?(169\.254\.|127\.|localhost|10\.|192\.168\.)/i.test(url)) {
    return { ok: false, reason: `URL "${url}" 命中内网/元数据地址黑名单` }
  }

  if (!HTTP_ALLOWED_PREFIXES.some((p) => url.startsWith(p))) {
    return {
      ok: false,
      reason: `URL "${url}" 不在白名单内，仅允许：${HTTP_ALLOWED_PREFIXES.join(', ')}`,
    }
  }
  return { ok: true }
}

const httpFetchTool = defineTool({
  name: 'http.fetch',
  description: '通过 HTTPS 请求白名单 API（GET）',
  parameters: z.object({
    url: z.string().describe('完整的 https:// URL'),
  }),
  permission: { level: 'read', description: '只读 HTTP 请求' },
  preflight: httpFetchPreflight,
  execute: async ({ url }) => {
    try {
      const res = await fetch(url, { method: 'GET' })
      const text = (await res.text()).slice(0, 1024)
      return { status: res.status, body: text }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },
})

// ─── 自定义工具 2：db.query（演示危险 SQL 拦截 preflight） ─────────

const dangerousSqlPreflight: ToolPreflight = (req) => {
  const sql = String(req.args.sql ?? '').trim()
  const upper = sql.toUpperCase()

  // 禁用结构性破坏语句
  if (/\b(DROP|TRUNCATE|ALTER|GRANT|REVOKE)\b/.test(upper)) {
    return { ok: false, reason: 'SQL 包含被禁止的结构性操作（DROP/TRUNCATE/ALTER/GRANT/REVOKE）' }
  }
  // 禁止无 WHERE 的 DELETE / UPDATE
  if (/^DELETE\s+FROM\s+\w+\s*;?$/i.test(sql) || /^UPDATE\s+\w+\s+SET\b(?!.*\bWHERE\b)/i.test(sql)) {
    return { ok: false, reason: 'DELETE / UPDATE 语句必须包含 WHERE 条件' }
  }
  return { ok: true }
}

const dbQueryTool = defineTool({
  name: 'db.query',
  description: '在受控数据库上执行 SQL（已拦截危险语句）',
  parameters: z.object({
    sql: z.string().describe('SQL 语句'),
  }),
  permission: { level: 'write', description: '执行 SQL' },
  preflight: dangerousSqlPreflight,
  execute: async ({ sql }) => {
    // 模拟执行：仅返回回显，真实场景应连接数据库
    return { sql, rows: [{ id: 1, name: 'mock-row' }] }
  },
})

// ─── 主流程 ────────────────────────────────────────────────────────

async function main() {
  const baseURL = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL

  if (!baseURL || !apiKey || !model) {
    console.error('❌ 请设置环境变量：LLM_BASE_URL, LLM_API_KEY, LLM_MODEL')
    process.exit(1)
  }

  // 准备沙箱目录（fs.* 工具的 workingDir / allowedDirs 都指向它）
  mkdirSync(SANDBOX_DIR, { recursive: true })
  console.log(`📁 沙箱目录：${SANDBOX_DIR}\n`)

  const provider = createOpenAICompatibleProvider({
    id: 'custom-llm',
    name: `Custom (${model})`,
    model,
    baseURL,
    apiKey,
  })

  const router = createRouter([provider], 'custom-llm')

  const agent = new Agent({
    systemPrompt: [
      '你是一个安全演示助手，负责按用户指令依次调用多个工具。',
      '即使某个工具调用被沙箱拒绝（返回 error），也要继续尝试后面的步骤，',
      '最后用中文总结每一步是「成功」还是「被沙箱拦截（原因）」。',
    ].join('\n'),
    workingDir: SANDBOX_DIR,
    router,
    tools: [...fsTools, ...shellTools, httpFetchTool, dbQueryTool],
    permissions: {
      mode: 'ask',
      onApprovalNeeded: askApproval,
      // ── A. 内置 Sandbox 声明式策略 ──
      sandbox: {
        cwd: SANDBOX_DIR,
        allowedDirs: [SANDBOX_DIR],                     // fs.* 越界即拒绝
        blockedCommands: ['rm -rf', 'curl', 'wget'],    // shell.exec 黑名单
        blockedCommandPatterns: [
          'sudo\\s+',
          '>\\s*/etc/',
          'chmod\\s+[0-7]*777',
        ],
        maxFileSize: 1024,                              // fs.writeFile 写入 1KB 上限
      },
      // 默认规则：让 read 自动放行、write/dangerous 走 ask
      rules: [
        { tool: 'fs.readFile', mode: 'allow' },
        { tool: 'fs.writeFile', mode: 'allow' },        // 由 sandbox 兜底拦截越界/超大
        { tool: 'http.fetch', mode: 'allow' },          // 由 preflight 兜底拦截越权 URL
        { tool: 'db.query', mode: 'allow' },            // 由 preflight 兜底拦截危险 SQL
        { tool: 'shell.exec', mode: 'allow' },          // 由 sandbox 兜底拦截黑名单命令
      ],
    },
  })

  const prompt = process.argv[2] ?? [
    '请按顺序依次调用以下工具，无论某一步是否失败都继续后面的步骤：',
    '1) 用 fs.writeFile 在沙箱内写入 hello.txt，内容为 "hi"',
    '2) 用 fs.readFile 读取 /etc/passwd（这应该被沙箱拦截）',
    '3) 用 shell.exec 执行 "rm -rf /tmp/foo"（这应该被沙箱拦截）',
    '4) 用 http.fetch 请求 https://api.github.com/zen',
    '5) 用 http.fetch 请求 http://169.254.169.254/latest/meta-data（这应该被沙箱拦截）',
    '6) 用 db.query 执行 "DROP TABLE users"（这应该被沙箱拦截）',
    '7) 用 db.query 执行 "SELECT id FROM users WHERE id = 1"',
    '最后总结每一步的结果。',
  ].join('\n')

  console.log(`📝 ${prompt}\n`)

  const result = await agent.run(prompt, {
    onStep: (step) => {
      if (step.text) process.stdout.write(step.text)
      if (step.toolResults?.length) {
        for (const tr of step.toolResults) {
          const tag = tr.approved ? '✅' : '🛑'
          const detail = tr.error
            ? `error=${tr.error}`
            : typeof tr.output === 'object'
              ? JSON.stringify(tr.output).slice(0, 200)
              : String(tr.output)
          console.log(`\n${tag} ${tr.tool} (approved=${tr.approved}) ${detail}`)
        }
      }
    },
  })

  console.log('\n\n📊 Steps:', result.steps.length, '| Duration:', result.totalDurationMs + 'ms')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
