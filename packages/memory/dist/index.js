// src/index.ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
var WorkingMemory = class {
  store = /* @__PURE__ */ new Map();
  async save(key, content, metadata) {
    this.store.set(key, { key, content, metadata, timestamp: Date.now() });
  }
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async search(query, topK = 5) {
    const q = query.toLowerCase();
    const scored = Array.from(this.store.values()).map((item) => ({
      ...item,
      relevanceScore: item.content.toLowerCase().includes(q) ? 1 : 0
    })).filter((item) => item.relevanceScore > 0).sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)).slice(0, topK);
    return scored;
  }
  async delete(key) {
    this.store.delete(key);
  }
  async list() {
    return Array.from(this.store.keys());
  }
  /** Clear all working memory */
  clear() {
    this.store.clear();
  }
};
var ProjectMemory = class {
  constructor(projectDir) {
    this.projectDir = projectDir;
  }
  projectDir;
  memories = /* @__PURE__ */ new Map();
  /** Load memories from AGENT.md file */
  async load() {
    const agentMdPath = join(this.projectDir, "AGENT.md");
    if (!existsSync(agentMdPath)) return;
    const content = await readFile(agentMdPath, "utf-8");
    const sections = this.parseAgentMd(content);
    for (const [key, value] of sections) {
      this.memories.set(key, {
        key,
        content: value,
        metadata: { source: "AGENT.md" },
        timestamp: Date.now()
      });
    }
  }
  async save(key, content, metadata) {
    this.memories.set(key, { key, content, metadata, timestamp: Date.now() });
    await this.persist();
  }
  async get(key) {
    return this.memories.get(key) ?? null;
  }
  async search(query, topK = 5) {
    const q = query.toLowerCase();
    return Array.from(this.memories.values()).filter((item) => item.content.toLowerCase().includes(q) || item.key.toLowerCase().includes(q)).slice(0, topK);
  }
  async delete(key) {
    this.memories.delete(key);
    await this.persist();
  }
  async list() {
    return Array.from(this.memories.keys());
  }
  /** Persist memories back to AGENT.md */
  async persist() {
    const lines = ["# AGENT.md \u2014 Project Memory\n"];
    for (const [key, item] of this.memories) {
      lines.push(`## ${key}
${item.content}
`);
    }
    const dir = this.projectDir;
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "AGENT.md"), lines.join("\n"), "utf-8");
  }
  /** Parse AGENT.md sections into key-value pairs */
  parseAgentMd(content) {
    const map = /* @__PURE__ */ new Map();
    const lines = content.split("\n");
    let currentKey = "";
    let currentValue = [];
    for (const line of lines) {
      const heading = line.match(/^##?\s+(.+)/);
      if (heading) {
        if (currentKey) map.set(currentKey, currentValue.join("\n").trim());
        currentKey = heading[1].trim();
        currentValue = [];
      } else if (currentKey) {
        currentValue.push(line);
      }
    }
    if (currentKey) map.set(currentKey, currentValue.join("\n").trim());
    return map;
  }
};
var MemoryInjector = class {
  constructor(working, project, longTerm) {
    this.working = working;
    this.project = project;
    this.longTerm = longTerm;
  }
  working;
  project;
  longTerm;
  /** Collect relevant memories and format for context injection */
  async inject(query, topK = 5) {
    const parts = [];
    const projectItems = await this.project.search(query, topK);
    if (projectItems.length > 0) {
      parts.push("## Project Memory");
      for (const item of projectItems) {
        parts.push(`### ${item.key}
${item.content}`);
      }
    }
    const workingItems = await this.working.search(query, topK);
    if (workingItems.length > 0) {
      parts.push("## Working Context");
      for (const item of workingItems) {
        parts.push(`- **${item.key}**: ${item.content}`);
      }
    }
    if (this.longTerm) {
      const ltItems = await this.longTerm.search(query, topK);
      if (ltItems.length > 0) {
        parts.push("## Relevant Memories");
        for (const item of ltItems) {
          parts.push(`- ${item.content}`);
        }
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : "";
  }
};
export {
  MemoryInjector,
  ProjectMemory,
  WorkingMemory
};
//# sourceMappingURL=index.js.map