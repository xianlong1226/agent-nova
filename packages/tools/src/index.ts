// ─── Types ─────────────────────────────────────────────────────────
// types.ts already forwards every shared contract type via `export type *`,
// so a single wildcard here keeps both contract-forwarded and tools-local
// types in sync automatically — no manual list to maintain.
export type * from './types.js'
export { defineTool } from './types.js'

// ─── Registry & Engine ─────────────────────────────────────────────
export { ToolRegistry, ToolEngine } from './registry.js'

// ─── Built-in Tools ────────────────────────────────────────────────
export { fsTools, readFile, writeFile, listDir, fsStat } from './builtin/fs.js'
export { shellTools, shellExec } from './builtin/shell.js'
