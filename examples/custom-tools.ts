/**
 * AgentNova 自定义工具示例
 */

import { defineTool } from '@agentnova/tools'
import { z } from 'zod'

// 定义一个数据库查询工具
const dbQuery = defineTool({
  name: 'db.query',
  description: '执行 SQL 查询并返回结果。仅支持 SELECT 语句。',
  parameters: z.object({
    sql: z.string().describe('SQL 查询语句（仅 SELECT）'),
    limit: z.number().default(100).describe('返回行数上限'),
  }),
  permission: {
    level: 'read',
    scope: ['SELECT'],
    description: '查询数据库（只读）',
  },
  execute: async ({ sql, limit }, ctx) => {
    ctx.logger.info('Executing SQL', { sql, limit })
    // 这里接入实际的数据库驱动
    // const result = await db.execute(sql, { limit })
    return {
      rows: [],
      total: 0,
      sql,
    }
  },
})

// 定义一个发送通知工具
const sendNotification = defineTool({
  name: 'notify.send',
  description: '向团队成员发送通知消息',
  parameters: z.object({
    recipient: z.string().describe('接收人'),
    message: z.string().describe('消息内容'),
    channel: z.enum(['feishu', 'email', 'wechat']).default('feishu').describe('通知渠道'),
  }),
  permission: {
    level: 'write',
    description: '发送外部通知（需要审批）',
  },
  execute: async ({ recipient, message, channel }, ctx) => {
    ctx.logger.info('Sending notification', { recipient, channel })
    // 这里接入实际的通知服务
    return { success: true, recipient, channel }
  },
})

export { dbQuery, sendNotification }
