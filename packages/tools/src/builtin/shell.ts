import { z } from 'zod'
import { defineTool, type ToolPreflight, type PreflightResult } from '../types.js'
import { exec } from 'child_process'
import { resolve } from 'path'
import type { ToolContext } from '../types.js'

// ─── shell command preflight ───────────────────────────────────────

const commandPreflight: ToolPreflight = (req, { sandbox }): PreflightResult => {
  const command = req.args.command as string | undefined
  if (!command) return { ok: true }

  // Exact substring blocklist
  const blocked = sandbox.blockedCommands ?? []
  for (const b of blocked) {
    if (command.includes(b)) {
      return { ok: false, reason: `command matches blockedCommands entry "${b}"` }
    }
  }

  // Regex pattern blocklist
  const patterns = sandbox.blockedCommandPatterns ?? []
  for (const p of patterns) {
    try {
      if (new RegExp(p, 'i').test(command)) {
        return { ok: false, reason: `command matches blockedCommandPatterns "${p}"` }
      }
    } catch {
      // ignore invalid pattern
    }
  }

  return { ok: true }
}

// ─── shell.exec ────────────────────────────────────────────────────

export const shellExec = defineTool({
  name: 'shell.exec',
  description:
    'Execute a shell command and return its stdout, stderr, and exit code.',
  parameters: z.object({
    command: z.string().describe('Shell command to execute'),
    cwd: z.string().optional().describe('Working directory for the command'),
    timeout: z.number().default(30_000).describe('Timeout in milliseconds'),
  }),
  permission: {
    level: 'dangerous',
    scope: ['*'],
    description: 'Execute arbitrary shell commands',
  },
  preflight: commandPreflight,
  execute: async (input: { command: string; cwd?: string; timeout: number }, ctx: ToolContext) => {
    const resolvedCwd = input.cwd ? resolve(ctx.workingDir, input.cwd) : ctx.workingDir
    ctx.logger.info('Executing command', { command: input.command, cwd: resolvedCwd })

    return new Promise((resolve) => {
      const child = exec(
        input.command,
        {
          cwd: resolvedCwd,
          timeout: input.timeout,
          maxBuffer: 10 * 1024 * 1024,
          shell: '/bin/bash',
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout?.slice(0, 50_000) ?? '',
            stderr: stderr?.slice(0, 10_000) ?? '',
            exitCode: error ? (error as NodeJS.ErrnoException).code ?? 1 : 0,
            signal: error?.signal ?? null,
          })
        }
      )

      ctx.abortSignal.addEventListener('abort', () => {
        child.kill('SIGTERM')
      }, { once: true })
    })
  },
})

// ─── Export all built-in shell tools ───────────────────────────────

export const shellTools = [shellExec]
