import { z } from 'zod'
import { defineTool } from './types.js'
import { readFile as fsReadFile, readdir, stat, writeFile as fsWriteFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, relative } from 'path'
import type { ToolContext } from './types.js'

// ─── fs.readFile ───────────────────────────────────────────────────

export const readFile = defineTool({
  name: 'fs.readFile',
  description:
    'Read the contents of a file at the given path. Returns the file content as a string. Use relative paths from the working directory.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file path to read'),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8').describe('File encoding'),
  }),
  permission: { level: 'read', description: 'Read file contents' },
  execute: async ({ path, encoding }, ctx) => {
    const resolvedPath = resolve(ctx.workingDir, path)
    ctx.logger.info('Reading file', { path: resolvedPath })

    try {
      const content = await fsReadFile(resolvedPath, encoding as BufferEncoding)
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
    'Write content to a file. Creates the file if it does not exist, overwrites if it does. Will create parent directories if needed.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file path to write'),
    content: z.string().describe('Content to write to the file'),
  }),
  permission: { level: 'write', scope: ['**'], description: 'Write file contents' },
  execute: async ({ path, content }, ctx) => {
    const resolvedPath = resolve(ctx.workingDir, path)
    ctx.logger.info('Writing file', { path: resolvedPath })

    // Create parent directories if needed
    const dir = join(resolvedPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    await fsWriteFile(resolvedPath, content, 'utf-8')
    return { success: true, path: resolvedPath, bytesWritten: Buffer.byteLength(content) }
  },
})

// ─── fs.listDir ────────────────────────────────────────────────────

export const listDir = defineTool({
  name: 'fs.listDir',
  description:
    'List files and directories at the given path. Returns names with type indicators (file/dir).',
  parameters: z.object({
    path: z.string().default('.').describe('Directory path to list'),
    recursive: z.boolean().default(false).describe('Whether to list recursively'),
  }),
  permission: { level: 'read', description: 'List directory contents' },
  execute: async ({ path, recursive }, ctx) => {
    const resolvedPath = resolve(ctx.workingDir, path)
    ctx.logger.info('Listing directory', { path: resolvedPath, recursive })

    const entries: Array<{ name: string; type: 'file' | 'dir'; path: string }> = []

    async function walk(dir: string, depth: number = 0): Promise<void> {
      if (recursive && depth > 10) return // Safety limit
      
      const items = await readdir(dir, { withFileTypes: true })
      for (const item of items) {
        const fullPath = join(dir, item.name)
        const relPath = relative(ctx.workingDir, fullPath)
        
        if (item.isDirectory()) {
          entries.push({ name: item.name, type: 'dir', path: relPath })
          if (recursive) await walk(fullPath, depth + 1)
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
  execute: async ({ path }, ctx) => {
    const resolvedPath = resolve(ctx.workingDir, path)
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
