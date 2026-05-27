import { describe, it, expect } from 'vitest'
import { PermissionGuard, DEFAULT_PERMISSION_CONFIG } from '../src/guard.js'
import type { ApprovalRequest } from '../src/guard.js'

describe('PermissionGuard', () => {
  const readPerm = { level: 'read' as const }
  const writePerm = { level: 'write' as const }
  const dangerousPerm = { level: 'dangerous' as const }

  it('should respect explicit rules over level defaults', () => {
    const guard = new PermissionGuard({
      ...DEFAULT_PERMISSION_CONFIG,
      rules: [
        { tool: 'fs.readFile', mode: 'allow' },
        { tool: 'shell.exec', mode: 'deny' },
      ],
    })

    expect(guard.getEffectiveMode('fs.readFile', 'read')).toBe('allow')
  })

  it('should fall back to level-based defaults', () => {
    const guard = new PermissionGuard({
      ...DEFAULT_PERMISSION_CONFIG,
      rules: [],
    })

    expect(guard.getEffectiveMode('some.read.tool', 'read')).toBe('allow')
    expect(guard.getEffectiveMode('some.write.tool', 'write')).toBe('ask')
    expect(guard.getEffectiveMode('some.dangerous.tool', 'dangerous')).toBe('ask')
  })

  it('should auto-allow in "allow" mode when no explicit rule', async () => {
    const guard = new PermissionGuard({
      mode: 'allow',
      rules: [],
      limits: DEFAULT_PERMISSION_CONFIG.limits,
    })

    const request: ApprovalRequest = {
      tool: 'shell.exec',
      args: { command: 'rm -rf /' },
      permission: dangerousPerm,
    }

    const result = await guard.check(request)
    expect(result).toBe('allow-once')
  })

  it('should auto-deny in "deny" mode when no explicit rule', async () => {
    const guard = new PermissionGuard({
      mode: 'deny',
      rules: [{ tool: 'fs.readFile', mode: 'allow' }],  // explicit allow overrides
      limits: DEFAULT_PERMISSION_CONFIG.limits,
    })

    // explicit allow → allow-once
    const allowReq: ApprovalRequest = {
      tool: 'fs.readFile',
      args: { path: '/etc/passwd' },
      permission: readPerm,
    }
    expect(await guard.check(allowReq)).toBe('allow-once')

    // no rule + global deny → deny
    const denyReq: ApprovalRequest = {
      tool: 'shell.exec',
      args: { command: 'ls' },
      permission: dangerousPerm,
    }
    expect(await guard.check(denyReq)).toBe('deny')
  })

  it('should call approval callback in "ask" mode', async () => {
    const guard = new PermissionGuard({
      mode: 'ask',
      rules: [{ tool: 'fs.readFile', mode: 'ask' }],
      limits: DEFAULT_PERMISSION_CONFIG.limits,
      onApprovalNeeded: async () => 'allow-always' as const,
    })

    const request: ApprovalRequest = {
      tool: 'fs.readFile',
      args: { path: 'test.txt' },
      permission: readPerm,
    }

    const result = await guard.check(request)
    expect(result).toBe('allow-always')
  })

  it('should deny if no approval callback in ask mode', async () => {
    const guard = new PermissionGuard({
      mode: 'ask',
      rules: [],
      limits: DEFAULT_PERMISSION_CONFIG.limits,
    })

    const request: ApprovalRequest = {
      tool: 'shell.exec',
      args: { command: 'ls' },
      permission: dangerousPerm,
    }

    const result = await guard.check(request)
    expect(result).toBe('deny')
  })

  it('should match wildcard patterns', () => {
    const guard = new PermissionGuard({
      ...DEFAULT_PERMISSION_CONFIG,
      rules: [{ tool: 'fs.*', mode: 'allow' }],
    })

    expect(guard.getEffectiveMode('fs.readFile', 'read')).toBe('allow')
    expect(guard.getEffectiveMode('fs.writeFile', 'write')).toBe('allow')
    expect(guard.getEffectiveMode('shell.exec', 'dangerous')).toBe('ask')
  })
})
