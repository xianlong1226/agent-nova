import { z } from 'zod'
import { defineTool, type ToolContext, type ToolPreflight, type PreflightResult } from '../types.js'
import { readFile as fsReadFile, readdir, stat, writeFile as fsWriteFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, relative } from 'path'

// ─── Sandbox preflights ────────────────────────────────────────────

/** Resolve path relative to sandbox cwd (mirrors PermissionGuard.resolvePath). */
function resolveSandboxPath(p: string, cwd?: string): string {
  if (cwd && !p.startsWith('/')) {
    return `${cwd}/${p}`.replace(/\/+/g, '/')
  }
  return p
}

/** Validate `args.path` against `sandbox.allowedDirs`. */
const pathPreflight: ToolPreflight = (req, { sandbox }): PreflightResult => {
  const path = req.args.path as string | undefined
  if (!path) return { ok: true }
  const allowedDirs = sandbox.allowedDirs
  if (!allowedDirs || allowedDirs.length === 0) return { ok: true }

  const resolved = resolveSandboxPath(path, sandbox.cwd)
  const allowed = allowedDirs.some(dir => resolved.startsWith(resolveSandboxPath(dir, sandbox.cwd)))
  return allowed
    ? { ok: true }
    : { ok: false, reason: `path "${path}" is outside allowedDirs` }
}

/** Validate `args.content` size against `sandbox.maxFileSize`. */
const sizePreflight: ToolPreflight = (req, { sandbox }): PreflightResult => {
  const content = req.args.content as string | undefined
  if (!content) return { ok: true }
  const maxSize = sandbox.maxFileSize ?? 10 * 1024 * 1024
  if (Buffer.byteLength(content, 'utf-8') > maxSize) {
    return { ok: false, reason: `content exceeds maxFileSize (${maxSize} bytes)` }
  }
  return { ok: true }
}

/** Compose two preflights — short-circuit on first failure. */
function composePreflights(...flights: ToolPreflight[]): ToolPreflight {
  return (req, ctx) => {
    for (const f of flights) {
      const r = f(req, ctx)
      if (!r.ok) return r
    }
    return { ok: true }
  }
}

// ─── fs.readFile ───────────────────────────────────────────────────

export const readFile = defineTool({
  name: 'fs.readFile',
  description:
    'Read the contents of a file at the given path. Returns the file content as a string.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file path to read'),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8').describe('File encoding'),
  }),
  permission: { level: 'read', description: 'Read file contents' },
  preflight: pathPreflight,
  execute: async (input: { path: string; encoding: string }, ctx: ToolContext) => {
    const resolvedPath = resolve(ctx.workingDir, input.path)
    ctx.logger.info('Reading file', { path: resolvedPath })

    try {
      const content = await fsReadFile(resolvedPath, input.encoding as BufferEncoding)
      return { content: String(content), path: resolvedPath }
    } catch (err) {
      throw new Error(`Failed to read file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

// ─── fs.writeFile ──────────────────────────────────────────────────

export const writeFile = defineTool({
  name: 'fs.writeFile',
  description:
    'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file path to write'),
    content: z.string().describe('Content to write to the file'),
  }),
  permission: { level: 'write', scope: ['**'], description: 'Write file contents' },
  preflight: composePreflights(pathPreflight, sizePreflight),
  execute: async (input: { path: string; content: string }, ctx: ToolContext) => {
    const resolvedPath = resolve(ctx.workingDir, input.path)
    ctx.logger.info('Writing file', { path: resolvedPath })

    const dir = join(resolvedPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    await fsWriteFile(resolvedPath, input.content, 'utf-8')
    return { success: true, path: resolvedPath, bytesWritten: Buffer.byteLength(input.content) }
  },
})

// ─── fs.listDir ────────────────────────────────────────────────────

export const listDir = defineTool({
  name: 'fs.listDir',
  description: 'List files and directories at the given path.',
  parameters: z.object({
    path: z.string().default('.').describe('Directory path to list'),
    recursive: z.boolean().default(false).describe('Whether to list recursively'),
  }),
  permission: { level: 'read', description: 'List directory contents' },
  preflight: pathPreflight,
  execute: async (input: { path: string; recursive: boolean }, ctx: ToolContext) => {
    const resolvedPath = resolve(ctx.workingDir, input.path)
    ctx.logger.info('Listing directory', { path: resolvedPath, recursive: input.recursive })

    const entries: Array<{ name: string; type: 'file' | 'dir'; path: string }> = []

    async function walk(dir: string, depth: number = 0): Promise<void> {
      if (input.recursive && depth > 10) return
      const items = await readdir(dir, { withFileTypes: true })
      for (const item of items) {
        const fullPath = join(dir, item.name)
        const relPath = relative(ctx.workingDir, fullPath)
        if (item.isDirectory()) {
          entries.push({ name: item.name, type: 'dir', path: relPath })
          if (input.recursive) await walk(fullPath, depth + 1)
        } else if (item.isFile()) {
          entries.push({ name: item.name, type: 'file', path: relPath })
        }
      }
    }

    await walk(resolvedPath)
    return entries
  },
})

// ─── fs.stat ───────────────────────────────────────────────────────

export const fsStat = defineTool({
  name: 'fs.stat',
  description: 'Get file/directory metadata (size, modified time, type).',
  parameters: z.object({
    path: z.string().describe('Path to stat'),
  }),
  permission: { level: 'read', description: 'Read file metadata' },
  preflight: pathPreflight,
  execute: async (input: { path: string }, ctx: ToolContext) => {
    const resolvedPath = resolve(ctx.workingDir, input.path)
    const stats = await stat(resolvedPath)
    return {
      path: resolvedPath,
      type: stats.isDirectory() ? 'dir' : 'file',
      size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString(),
    }
  },
})

// ─── Export all built-in FS tools ──────────────────────────────────

export const fsTools = [readFile, writeFile, listDir, fsStat]
