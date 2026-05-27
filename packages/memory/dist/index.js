// src/index.ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
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
    return Array.from(this.store.values()).map((item) => ({
      ...item,
      relevanceScore: this.keywordScore(item, q)
    })).filter((item) => item.relevanceScore > 0).sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)).slice(0, topK);
  }
  async delete(key) {
    this.store.delete(key);
  }
  async list() {
    return Array.from(this.store.keys());
  }
  clear() {
    this.store.clear();
  }
  keywordScore(item, query) {
    const text = `${item.key} ${item.content}`.toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    return words.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
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
    const isCJK = /[\u4e00-\u9fff]/.test(q);
    const qTokens = isCJK ? [...q] : q.split(/\s+/).filter(Boolean);
    return Array.from(this.memories.values()).map((item) => {
      const text = `${item.key} ${item.content}`.toLowerCase();
      const score = qTokens.reduce((s, token) => s + (text.includes(token) ? 1 : 0), 0);
      return { ...item, relevanceScore: score };
    }).filter((item) => item.relevanceScore > 0).sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)).slice(0, topK);
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
    if (!existsSync(this.projectDir)) await mkdir(this.projectDir, { recursive: true });
    await writeFile(join(this.projectDir, "AGENT.md"), lines.join("\n"), "utf-8");
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
var LongTermMemory = class {
  db;
  embedFn;
  embeddingDim;
  constructor(config) {
    this.db = new Database(config.dbPath);
    this.embedFn = config.embedFn;
    this.embeddingDim = config.embeddingDim ?? 384;
    this.initSchema();
  }
  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding BLOB,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_ts ON memories(timestamp);
    `);
  }
  async save(key, content, metadata) {
    const embedding = this.embedFn ? await this.embedFn(content) : null;
    const embeddingBlob = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;
    this.db.prepare(`
      INSERT OR REPLACE INTO memories (key, content, metadata, embedding, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(key, content, metadata ? JSON.stringify(metadata) : null, embeddingBlob, Date.now());
  }
  async get(key) {
    const row = this.db.prepare("SELECT * FROM memories WHERE key = ?").get(key);
    if (!row) return null;
    return {
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : void 0,
      timestamp: row.timestamp
    };
  }
  async search(query, topK = 5) {
    if (!this.embedFn) {
      return this.keywordSearch(query, topK);
    }
    const queryEmbedding = await this.embedFn(query);
    const rows = this.db.prepare("SELECT * FROM memories WHERE embedding IS NOT NULL").all();
    const scored = rows.map((row) => {
      const embedding = Array.from(new Float32Array(row.embedding.buffer));
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return { row, similarity };
    });
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK).map(({ row, similarity }) => ({
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : void 0,
      timestamp: row.timestamp,
      relevanceScore: similarity
    }));
  }
  async delete(key) {
    this.db.prepare("DELETE FROM memories WHERE key = ?").run(key);
  }
  async list() {
    const rows = this.db.prepare("SELECT key FROM memories").all();
    return rows.map((r) => r.key);
  }
  close() {
    this.db.close();
  }
  keywordSearch(query, topK) {
    const q = `%${query.toLowerCase()}%`;
    const rows = this.db.prepare(
      "SELECT * FROM memories WHERE LOWER(content) LIKE ? OR LOWER(key) LIKE ? ORDER BY timestamp DESC LIMIT ?"
    ).all(q, q, topK);
    return rows.map((row) => ({
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : void 0,
      timestamp: row.timestamp
    }));
  }
  cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
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
  /** Store a new memory item across appropriate layers */
  async store(key, content, options) {
    const layer = options?.layer ?? "working";
    switch (layer) {
      case "working":
        await this.working.save(key, content, options?.metadata);
        break;
      case "project":
        await this.project.save(key, content, options?.metadata);
        break;
      case "longterm":
        if (this.longTerm) {
          await this.longTerm.save(key, content, options?.metadata);
        }
        break;
    }
  }
};
export {
  LongTermMemory,
  MemoryInjector,
  ProjectMemory,
  WorkingMemory
};
//# sourceMappingURL=index.js.map