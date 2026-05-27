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
  constructor(config) {
    this.rules = config.rules;
    this.defaultMode = config.mode;
    this.approvalFn = config.onApprovalNeeded;
  }
  getEffectiveMode(toolName, toolLevel) {
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
    const mode = this.getEffectiveMode(request.tool, request.permission.level);
    switch (mode) {
      case "allow":
        return "allow-once";
      case "deny":
        return "deny";
      case "ask": {
        if (!this.approvalFn) return "deny";
        return this.approvalFn(request);
      }
    }
  }
  matchToolPattern(pattern, toolName) {
    if (pattern === "*") return true;
    if (pattern === toolName) return true;
    if (pattern.endsWith(".*")) {
      const namespace = pattern.slice(0, -2);
      return toolName.startsWith(namespace + ".");
    }
    return false;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_LIMITS,
  DEFAULT_PERMISSION_CONFIG,
  PermissionGuard
});
//# sourceMappingURL=index.cjs.map