import { z } from 'zod'
import { defineTool } from './types.js'
import { exec } from 'child_process'
import { resolve } from 'path'

// ─── shell.exec ────────────────────────────────────────────────────

export const shellExec = defineTool({
  name: 'shell.exec',
  description:
    'Execute a shell command and return its stdout, stderr, and exit code. Use with caution — this is a dangerous operation.',
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
  execute: async ({ command, cwd, timeout }, ctx) => {
    const resolvedCwd = cwd ? resolve(ctx.workingDir, cwd) : ctx.workingDir
    ctx.logger.info('Executing command', { command, cwd: resolvedCwd })

    return new Promise((resolve, reject) => {
      const child = exec(
        command,
        {
          cwd: resolvedCwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          shell: '/bin/bash',
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout?.slice(0, 50_000) ?? '',   // Truncate large output
            stderr: stderr?.slice(0, 10_000) ?? '',
            exitCode: error ? (error as NodeJS.ErrnoException).code ?? 1 : 0,
            signal: error?.signal ?? null,
          })
        }
      )

      // Forward abort signal
      ctx.abortSignal.addEventListener('abort', () => {
        child.kill('SIGTERM')
      }, { once: true })
    })
  },
})

// ─── Export all built-in shell tools ───────────────────────────────

export const shellTools = [shellExec]
