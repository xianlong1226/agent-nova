"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  DEFAULT_LIMITS: () => DEFAULT_LIMITS,
  DEFAULT_PERMISSION_CONFIG: () => DEFAULT_PERMISSION_CONFIG,
  DEFAULT_SANDBOX: () => DEFAULT_SANDBOX,
  PermissionGuard: () => PermissionGuard
});
module.exports = __toCommonJS(index_exports);

// src/guard.ts
var DEFAULT_LIMITS = {
  maxSteps: 50,
  maxTokens: 2e5,
  maxToolCalls: 100,
  timeoutMs: 3e5,
  maxFileSize: 10 * 1024 * 1024
};
var DEFAULT_SANDBOX = {
  blockedCommands: ["rm -rf /", "mkfs", "dd if=", ":(){ :|:& };:"],
  blockedCommandPatterns: [
    "rm\\s+-[rR].*\\s+/",
    ">?/dev/sd",
    "chmod\\s+[0-7]*777\\s+/",
    "curl\\s+.*\\|\\s*sh",
    "wget\\s+.*\\|\\s*sh"
  ],
  maxFileSize: 10 * 1024 * 1024,
  maxOutputLength: 1e5
};
var DEFAULT_PERMISSION_CONFIG = {
  mode: "ask",
  rules: [
    { tool: "fs.readFile", mode: "allow" },
    { tool: "fs.listDir", mode: "allow" },
    { tool: "fs.stat", mode: "allow" },
    { tool: "web.fetch", mode: "allow" },
    { tool: "web.search", mode: "allow" },
    { tool: "fs.writeFile", mode: "ask" },
    { tool: "shell.exec", mode: "ask" }
  ],
  sandbox: DEFAULT_SANDBOX,
  limits: DEFAULT_LIMITS
};
var LEVEL_DEFAULT_MODE = {
  read: "allow",
  write: "ask",
  dangerous: "ask"
};
var PermissionGuard = class {
  rules;
  defaultMode;
  approvalFn;
  sandbox;
  alwaysAllowed = /* @__PURE__ */ new Map();
  constructor(config) {
    this.rules = config.rules;
    this.defaultMode = config.mode;
    this.approvalFn = config.onApprovalNeeded;
    this.sandbox = config.sandbox ?? DEFAULT_SANDBOX;
  }
  getEffectiveMode(toolName, toolLevel) {
    const alwaysScopes = this.alwaysAllowed.get(toolName);
    if (alwaysScopes && alwaysScopes.has("*")) {
      return "allow";
    }
    for (const rule of this.rules) {
      if (this.matchToolPattern(rule.tool, toolName)) {
        return rule.mode;
      }
    }
    if (this.defaultMode === "allow" || this.defaultMode === "deny") {
      return this.defaultMode;
    }
    return LEVEL_DEFAULT_MODE[toolLevel] ?? "ask";
  }
  async check(request) {
    if (request.tool.startsWith("fs.") && this.isPathBlocked(request)) {
      return "deny";
    }
    if (request.tool === "shell.exec" && this.isCommandBlocked(request)) {
      return "deny";
    }
    if (request.tool === "fs.writeFile" && this.isFileSizeExceeded(request)) {
      return "deny";
    }
    const mode = this.getEffectiveMode(request.tool, request.permission.level);
    switch (mode) {
      case "allow":
        return "allow-once";
      case "deny":
        return "deny";
      case "ask": {
        if (!this.approvalFn) return "deny";
        const result = await this.approvalFn(request);
        if (result === "allow-always") {
          this.rememberAllowAlways(request);
        }
        return result;
      }
    }
  }
  /** Validate file path against sandbox allowedDirs */
  isPathBlocked(request) {
    const path = request.args.path;
    if (!path) return false;
    const allowedDirs = this.sandbox.allowedDirs;
    if (!allowedDirs || allowedDirs.length === 0) return false;
    const resolvedPath = this.resolvePath(path);
    const isAllowed = allowedDirs.some((dir) => resolvedPath.startsWith(this.resolvePath(dir)));
    return !isAllowed;
  }
  /** Check command against blocked list and patterns */
  isCommandBlocked(request) {
    const command = request.args.command;
    if (!command) return false;
    const blockedCommands = this.sandbox.blockedCommands ?? [];
    if (blockedCommands.some((blocked) => command.includes(blocked))) {
      return true;
    }
    const patterns = this.sandbox.blockedCommandPatterns ?? [];
    if (patterns.some((pattern) => {
      try {
        return new RegExp(pattern, "i").test(command);
      } catch {
        return false;
      }
    })) {
      return true;
    }
    return false;
  }
  /** Check if file write exceeds maxFileSize */
  isFileSizeExceeded(request) {
    const content = request.args.content;
    if (!content) return false;
    const maxSize = this.sandbox.maxFileSize ?? DEFAULT_LIMITS.maxFileSize;
    return Buffer.byteLength(content, "utf-8") > maxSize;
  }
  /** Remember an allow-always decision */
  rememberAllowAlways(request) {
    const scopes = this.alwaysAllowed.get(request.tool);
    if (scopes) {
      scopes.add("*");
    } else {
      this.alwaysAllowed.set(request.tool, /* @__PURE__ */ new Set(["*"]));
    }
  }
  /** Resolve path relative to sandbox cwd */
  resolvePath(p) {
    if (this.sandbox.cwd && !p.startsWith("/")) {
      return `${this.sandbox.cwd}/${p}`.replace(/\/+/g, "/");
    }
    return p;
  }
  /** Match tool name against pattern (supports * and namespace.*) */
  matchToolPattern(pattern, toolName) {
    if (pattern === "*") return true;
    if (pattern === toolName) return true;
    if (pattern.endsWith(".*")) {
      const namespace = pattern.slice(0, -2);
      return toolName.startsWith(namespace + ".");
    }
    return false;
  }
  /** Reset always-allowed cache */
  resetAllowAlways() {
    this.alwaysAllowed.clear();
  }
  /** Get current sandbox config (read-only) */
  getSandbox() {
    return { ...this.sandbox };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_LIMITS,
  DEFAULT_PERMISSION_CONFIG,
  DEFAULT_SANDBOX,
  PermissionGuard
});
//# sourceMappingURL=index.cjs.map