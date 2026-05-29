/**
 * Session 管理示例 — 演示 SessionManager 的多用户隔离 + 串行锁 + 持久化
 *
 * SessionManager 提供：
 *   - 多用户会话隔离（同一个 Agent 实例服务多人，互不干扰）
 *   - 同用户串行锁  （同 user 的并发 run 自动排队，避免状态错乱）
 *   - 会话持久化    （storageDir 下每个 sessionId 一个 JSON 文件）
 *   - 启动恢复      （loadAllSessions 一次性加载磁盘上所有会话）
 *   - 优雅退出      （shutdown 停止 autoSave 定时器并保存全部会话）
 *
 * 注意：Agent 本身不保留跨次 run 的对话历史（每次 run 都会 resetState）。
 *       多轮记忆需要应用层把 session.messages 拼到 prompt 里再注入给 Agent，
 *       本示例展示了这一最小协调模式。
 *
 * 运行方式：
 *   pnpm install
 *   LLM_BASE_URL=https://api.deepseek.com/v1 LLM_API_KEY=xxx LLM_MODEL=deepseek-chat pnpm start
 *
 * 第二次运行同一进程时，会自动加载上次的 sessions/，演示持久化恢复。
 */

import {
  Agent,
  SessionManager,
  createRouter,
  createOpenAICompatibleProvider,
  fsTools,
} from 'agentnova'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SESSIONS_DIR = resolve(__dirname, './sessions')

// CoreMessage-like 结构的最小子集（避免直接依赖 'ai' 包类型）
type HistoryMessage = { role: string; content: unknown }

// ─── 辅助：把 session 的历史 messages 拼成可读的 prompt 前缀 ────
function buildHistoryPrefix(messages: HistoryMessage[]): string {
  if (messages.length === 0) return ''
  const lines = messages.map((m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 200)
    return `[${m.role}] ${text}`
  })
  return `历史对话（请基于此上下文回答当前问题）：\n${lines.join('\n')}\n\n`
}

// ─── 从环境变量创建 Provider ────────────────────────────────────────
function createProviderFromEnv() {
  const baseURL = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL
  if (!baseURL || !apiKey || !model) {
    console.error('❌ 请设置环境变量：LLM_BASE_URL, LLM_API_KEY, LLM_MODEL')
    process.exit(1)
  }
  return createOpenAICompatibleProvider({
    id: 'custom-llm',
    name: `Custom (${model})`,
    model,
    baseURL,
    apiKey,
  })
}

// ─── 一次"带 session 的运行"——把历史注入 prompt，再回写到 session ──
// 注意：Agent 实例的运行时状态（messages/state/usage 等）不是并发安全的，
// 跨用户并发调用同一个实例会相互覆盖。这里通过 getAgent(userId) 为每个用户
// 维护独立 Agent 实例，避免演示 1 出现回答串台。
async function runWithSession(
  getAgent: (userId: string) => Agent,
  sm: SessionManager,
  userId: string,
  userPrompt: string,
): Promise<string> {
  return sm.withSession(userId, async (session) => {
    const fullPrompt = buildHistoryPrefix(session.messages) + `当前问题：${userPrompt}`

    console.log(`\n🧑 [${userId}] 提问：${userPrompt}`)
    const agent = getAgent(userId)
    const result = await agent.run(fullPrompt, { maxSteps: 5 })

    // 把本轮对话写回 session，供下次复用
    session.messages.push(
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: result.text },
    )
    session.metadata.lastTokens = result.usage?.totalTokens ?? 0
    session.metadata.runCount = ((session.metadata.runCount as number) ?? 0) + 1

    console.log(`🤖 [${userId}] 回答：${result.text}`)
    return result.text
  })
}

// ─── 主流程 ────────────────────────────────────────────────────────
async function main() {
  // 1) 创建 SessionManager，启用持久化与自动保存
  const sm = new SessionManager({
    storageDir: SESSIONS_DIR,
    persist: true,
    autoSaveIntervalMs: 10_000, // 每 10s 自动落盘
    maxConcurrentPerUser: 1,    // 同 user 串行
  })

  // 2) 启动时尝试从磁盘恢复历史会话
  const loaded = await sm.loadAllSessions()
  console.log(`📂 已从 ${SESSIONS_DIR} 恢复 ${loaded} 个会话`)

  // 3) 为每个用户维护独立的 Agent 实例（Provider/Router 仍可共享）
  //    这样同一时刻不同用户的 run 不会污染彼此的 messages/state。
  const provider = createProviderFromEnv()
  console.log(`🔮 使用模型：${provider.name}\n`)
  const router = createRouter([provider], provider.id)
  const agentPool = new Map<string, Agent>()
  const getAgent = (userId: string): Agent => {
    let agent = agentPool.get(userId)
    if (!agent) {
      agent = new Agent({
        systemPrompt: '你是一个简洁的助手。回答控制在一句话以内，必要时引用历史信息。',
        workingDir: process.cwd(),
        router,
        tools: [...fsTools],
        permissions: { mode: 'allow' }, // 演示用，直接放行所有工具
      })
      agentPool.set(userId, agent)
    }
    return agent
  }

  // 4) 演示 1：多用户隔离 — alice / bob 并行发起，互相不影响
  console.log('─── 演示 1：多用户隔离（alice 和 bob 并发）───')
  await Promise.all([
    runWithSession(getAgent, sm, 'alice', '你好，我叫 Alice，喜欢猫。'),
    runWithSession(getAgent, sm, 'bob', '你好，我叫 Bob，喜欢狗。'),
  ])

  // 5) 演示 2：同用户串行 — alice 连续两次提问
  //    第二次提问会带上第一次的历史，可验证多轮记忆
  console.log('\n─── 演示 2：同用户串行（alice 连发两条，第二条依赖历史）───')
  await Promise.all([
    runWithSession(getAgent, sm, 'alice', '我的名字是什么？'),
    runWithSession(getAgent, sm, 'alice', '我喜欢什么动物？'),
  ])

  // 6) 列出所有用户的会话状态
  console.log('\n─── 当前会话快照 ───')
  for (const userId of ['alice', 'bob']) {
    const sessions = sm.getUserSessions(userId)
    for (const s of sessions) {
      console.log(
        `  • ${userId} · ${s.sessionId} · ${s.messages.length} 条消息 · ` +
          `runCount=${s.metadata.runCount} · lastTokens=${s.metadata.lastTokens}`,
      )
    }
  }

  // 7) 优雅退出：保存全部会话 + 停掉 autoSave 定时器
  await sm.shutdown()
  console.log(`\n💾 会话已全部落盘：${SESSIONS_DIR}`)
  console.log('   再次运行本示例时会自动通过 loadAllSessions 恢复。')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
