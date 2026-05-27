// src/types.ts
function defineTool(def) {
  return def;
}

// src/registry.ts
var ToolRegistry = class {
  tools = /* @__PURE__ */ new Map();
  /** Register a tool definition */
  register(tool) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }
  /** Register multiple tools at once */
  registerAll(tools) {
    for (const tool of tools) {
      this.register(tool);
    }
  }
  /** Get a tool by name */
  get(name) {
    return this.tools.get(name);
  }
  /** Check if a tool exists */
  has(name) {
    return this.tools.has(name);
  }
  /** List all registered tool names */
  list() {
    return Array.from(this.tools.keys());
  }
  /** Get all registered tools */
  getAll() {
    return Array.from(this.tools.values());
  }
  /** Get tool definitions formatted for LLM consumption */
  getToolSchemas() {
    const schemas = {};
    for (const tool of this.tools.values()) {
      schemas[tool.name] = {
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters)
      };
    }
    return schemas;
  }
  /** Unregister a tool */
  unregister(name) {
    return this.tools.delete(name);
  }
  /** Clear all tools */
  clear() {
    this.tools.clear();
  }
};
var ToolEngine = class {
  constructor(registry) {
    this.registry = registry;
  }
  registry;
  /** Execute a tool call with context */
  async execute(call, ctx) {
    const tool = this.registry.get(call.tool);
    if (!tool) {
      return {
        tool: call.tool,
        output: null,
        error: `Unknown tool: "${call.tool}". Available tools: ${this.registry.list().join(", ")}`,
        durationMs: 0,
        approved: false
      };
    }
    const start = Date.now();
    try {
      const parsed = tool.parameters.safeParse(call.args);
      if (!parsed.success) {
        return {
          tool: call.tool,
          output: null,
          error: `Invalid input for "${call.tool}": ${parsed.error.message}`,
          durationMs: Date.now() - start,
          approved: false
        };
      }
      const result = await tool.execute(parsed.data, ctx);
      return {
        tool: call.tool,
        output: result,
        durationMs: Date.now() - start,
        approved: true
      };
    } catch (err) {
      return {
        tool: call.tool,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        approved: true
      };
    }
  }
  /** Get the underlying registry */
  getRegistry() {
    return this.registry;
  }
};
function zodToJsonSchema(schema) {
  if (schema && typeof schema === "object" && "_def" in schema) {
    return schema;
  }
  return schema;
}

// src/builtin/fs.ts
import { z } from "zod";
import { readFile as fsReadFile, readdir, stat, writeFile as fsWriteFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, relative } from "path";
var readFile = defineTool({
  name: "fs.readFile",
  description: "Read the contents of a file at the given path. Returns the file content as a string.",
  parameters: z.object({
    path: z.string().describe("Relative or absolute file path to read"),
    encoding: z.enum(["utf-8", "base64"]).default("utf-8").describe("File encoding")
  }),
  permission: { level: "read", description: "Read file contents" },
  execute: async (input, ctx) => {
    const resolvedPath = resolve(ctx.workingDir, input.path);
    ctx.logger.info("Reading file", { path: resolvedPath });
    try {
      const content = await fsReadFile(resolvedPath, input.encoding);
      return { content: String(content), path: resolvedPath };
    } catch (err) {
      throw new Error(`Failed to read file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
});
var writeFile = defineTool({
  name: "fs.writeFile",
  description: "Write content to a file. Creates the file if it does not exist, overwrites if it does.",
  parameters: z.object({
    path: z.string().describe("Relative or absolute file path to write"),
    content: z.string().describe("Content to write to the file")
  }),
  permission: { level: "write", scope: ["**"], description: "Write file contents" },
  execute: async (input, ctx) => {
    const resolvedPath = resolve(ctx.workingDir, input.path);
    ctx.logger.info("Writing file", { path: resolvedPath });
    const dir = join(resolvedPath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await fsWriteFile(resolvedPath, input.content, "utf-8");
    return { success: true, path: resolvedPath, bytesWritten: Buffer.byteLength(input.content) };
  }
});
var listDir = defineTool({
  name: "fs.listDir",
  description: "List files and directories at the given path.",
  parameters: z.object({
    path: z.string().default(".").describe("Directory path to list"),
    recursive: z.boolean().default(false).describe("Whether to list recursively")
  }),
  permission: { level: "read", description: "List directory contents" },
  execute: async (input, ctx) => {
    const resolvedPath = resolve(ctx.workingDir, input.path);
    ctx.logger.info("Listing directory", { path: resolvedPath, recursive: input.recursive });
    const entries = [];
    async function walk(dir, depth = 0) {
      if (input.recursive && depth > 10) return;
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = join(dir, item.name);
        const relPath = relative(ctx.workingDir, fullPath);
        if (item.isDirectory()) {
          entries.push({ name: item.name, type: "dir", path: relPath });
          if (input.recursive) await walk(fullPath, depth + 1);
        } else if (item.isFile()) {
          entries.push({ name: item.name, type: "file", path: relPath });
        }
      }
    }
    await walk(resolvedPath);
    return entries;
  }
});
var fsStat = defineTool({
  name: "fs.stat",
  description: "Get file/directory metadata (size, modified time, type).",
  parameters: z.object({
    path: z.string().describe("Path to stat")
  }),
  permission: { level: "read", description: "Read file metadata" },
  execute: async (input, ctx) => {
    const resolvedPath = resolve(ctx.workingDir, input.path);
    const stats = await stat(resolvedPath);
    return {
      path: resolvedPath,
      type: stats.isDirectory() ? "dir" : "file",
      size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString()
    };
  }
});
var fsTools = [readFile, writeFile, listDir, fsStat];

// src/builtin/shell.ts
import { z as z2 } from "zod";
import { exec } from "child_process";
import { resolve as resolve2 } from "path";
var shellExec = defineTool({
  name: "shell.exec",
  description: "Execute a shell command and return its stdout, stderr, and exit code.",
  parameters: z2.object({
    command: z2.string().describe("Shell command to execute"),
    cwd: z2.string().optional().describe("Working directory for the command"),
    timeout: z2.number().default(3e4).describe("Timeout in milliseconds")
  }),
  permission: {
    level: "dangerous",
    scope: ["*"],
    description: "Execute arbitrary shell commands"
  },
  execute: async (input, ctx) => {
    const resolvedCwd = input.cwd ? resolve2(ctx.workingDir, input.cwd) : ctx.workingDir;
    ctx.logger.info("Executing command", { command: input.command, cwd: resolvedCwd });
    return new Promise((resolve3) => {
      const child = exec(
        input.command,
        {
          cwd: resolvedCwd,
          timeout: input.timeout,
          maxBuffer: 10 * 1024 * 1024,
          shell: "/bin/bash"
        },
        (error, stdout, stderr) => {
          resolve3({
            stdout: stdout?.slice(0, 5e4) ?? "",
            stderr: stderr?.slice(0, 1e4) ?? "",
            exitCode: error ? error.code ?? 1 : 0,
            signal: error?.signal ?? null
          });
        }
      );
      ctx.abortSignal.addEventListener("abort", () => {
        child.kill("SIGTERM");
      }, { once: true });
    });
  }
});
var shellTools = [shellExec];
export {
  ToolEngine,
  ToolRegistry,
  defineTool,
  fsStat,
  fsTools,
  listDir,
  readFile,
  shellExec,
  shellTools,
  writeFile
};
//# sourceMappingURL=index.js.map