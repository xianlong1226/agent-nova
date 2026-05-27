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
export {
  DEFAULT_LIMITS,
  DEFAULT_PERMISSION_CONFIG,
  PermissionGuard
};
//# sourceMappingURL=index.js.map