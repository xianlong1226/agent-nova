"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  IMPORTANCE_BASE_SCORE: () => IMPORTANCE_BASE_SCORE,
  IMPORTANCE_HALFLIFE: () => IMPORTANCE_HALFLIFE,
  LongTermMemory: () => LongTermMemory,
  MemoryInjector: () => MemoryInjector,
  ProjectMemory: () => ProjectMemory,
  WorkingMemory: () => WorkingMemory,
  classifyImportance: () => classifyImportance,
  decayedScore: () => decayedScore
});
module.exports = __toCommonJS(index_exports);
var import_promises = require("fs/promises");
var import_fs = require("fs");
var import_path = require("path");
var IMPORTANCE_HALFLIFE = {
  critical: Infinity,
  // never decays — user preferences, core instructions
  high: 720,
  // 30 days — project decisions, error resolutions
  normal: 168,
  // 7 days — current task context
  low: 24
  // 1 day — ephemeral observations
};
var IMPORTANCE_BASE_SCORE = {
  critical: 1,
  high: 0.8,
  normal: 0.5,
  low: 0.2
};
function decayedScore(importance, timestamp, now = Date.now()) {
  const base = IMPORTANCE_BASE_SCORE[importance];
  const halflife = IMPORTANCE_HALFLIFE[importance];
  if (halflife === Infinity) return base;
  const ageHours = (now - timestamp) / (1e3 * 60 * 60);
  return base * Math.pow(0.5, ageHours / halflife);
}
function classifyImportance(content, key) {
  const lower = `${key} ${content}`.toLowerCase();
  if (/\b(always|never|must|prefer|i want|i like|i use|rule|policy)\b/.test(lower)) {
    return "critical";
  }
  if (/\b(fixed|resolved|decided|architecture|config|\.ts|\.js|\.json|src\/|packages\/)\b/.test(lower)) {
    return "high";
  }
  if (content.length < 30 || /^(note:|fyi:|btw:)/i.test(lower)) {
    return "low";
  }
  return "normal";
}
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
    const agentMdPath = (0, import_path.join)(this.projectDir, "AGENT.md");
    if (!(0, import_fs.existsSync)(agentMdPath)) return;
    const content = await (0, import_promises.readFile)(agentMdPath, "utf-8");
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
  /** Get all items (for full injection into system prompt) */
  getAll() {
    return Array.from(this.memories.values());
  }
  /** Persist memories back to AGENT.md */
  async persist() {
    const lines = ["# AGENT.md \u2014 Project Memory\n"];
    for (const [key, item] of this.memories) {
      lines.push(`## ${key}
${item.content}
`);
    }
    if (!(0, import_fs.existsSync)(this.projectDir)) await (0, import_promises.mkdir)(this.projectDir, { recursive: true });
    await (0, import_promises.writeFile)((0, import_path.join)(this.projectDir, "AGENT.md"), lines.join("\n"), "utf-8");
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
  db = null;
  // SqlJsDatabase — typed as any for ease
  dbPath;
  embedFn;
  embeddingDim;
  maxMemories;
  enableDecay;
  ready;
  constructor(config) {
    this.dbPath = config.dbPath;
    this.embedFn = config.embedFn;
    this.embeddingDim = config.embeddingDim ?? 384;
    this.maxMemories = config.maxMemories ?? 1e4;
    this.enableDecay = config.enableDecay ?? true;
    this.ready = this.init();
  }
  // ─── Async Init (sql.js WASM) ──────────────────────────────────
  async init() {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    try {
      const fs = await import("fs/promises");
      const buf = await fs.readFile(this.dbPath);
      this.db = new SQL.Database(new Uint8Array(buf));
    } catch {
      this.db = new SQL.Database();
    }
    this.initSchema();
  }
  async ensureReady() {
    await this.ready;
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }
  initSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        importance TEXT NOT NULL DEFAULT 'normal',
        embedding BLOB,
        timestamp INTEGER NOT NULL
      );
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_ts ON memories(timestamp);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);");
  }
  async persist() {
    const db = await this.ensureReady();
    const data = db.export();
    const buffer = Buffer.from(data);
    const fs = await import("fs/promises");
    const path = await import("path");
    const dir = path.dirname(this.dbPath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
    }
    await fs.writeFile(this.dbPath, buffer);
  }
  // ─── CRUD ────────────────────────────────────────────────────────
  async save(key, content, metadata) {
    const db = await this.ensureReady();
    const importance = classifyImportance(content, key);
    const embedding = this.embedFn ? await this.embedFn(content) : null;
    const embeddingBlob = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;
    db.run(
      "INSERT OR REPLACE INTO memories (key, content, metadata, importance, embedding, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      [key, content, metadata ? JSON.stringify(metadata) : null, importance, embeddingBlob, Date.now()]
    );
    await this.evictIfNeeded();
    await this.persist();
  }
  async get(key) {
    const db = await this.ensureReady();
    const stmt = db.prepare("SELECT * FROM memories WHERE key = ?");
    stmt.bind([key]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return {
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : void 0,
      timestamp: row.timestamp
    };
  }
  async search(query, topK = 5) {
    const db = await this.ensureReady();
    if (!this.embedFn) {
      return this.keywordSearch(query, topK);
    }
    const queryEmbedding = await this.embedFn(query);
    const stmt = db.prepare("SELECT * FROM memories WHERE embedding IS NOT NULL");
    const rows = [];
    const now = Date.now();
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const embedding = row.embedding ? Array.from(new Float32Array(row.embedding)) : null;
      if (!embedding) continue;
      const semanticScore = this.cosineSimilarity(queryEmbedding, embedding);
      const decayMultiplier = this.enableDecay ? decayedScore(row.importance, row.timestamp, now) : 1;
      rows.push({ ...row, score: semanticScore * decayMultiplier });
    }
    stmt.free();
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, topK).map((r) => ({
      key: r.key,
      content: r.content,
      metadata: r.metadata ? JSON.parse(r.metadata) : void 0,
      timestamp: r.timestamp,
      relevanceScore: r.score
    }));
  }
  async delete(key) {
    const db = await this.ensureReady();
    db.run("DELETE FROM memories WHERE key = ?", [key]);
    await this.persist();
  }
  async list() {
    const db = await this.ensureReady();
    const stmt = db.prepare("SELECT key FROM memories");
    const keys = [];
    while (stmt.step()) {
      keys.push(stmt.getAsObject().key);
    }
    stmt.free();
    return keys;
  }
  async close() {
    const db = await this.ensureReady();
    await this.persist();
    db.close();
  }
  /** Get memories sorted by decayed importance (for inspection/debugging) */
  async getMemoriesByImportance() {
    const db = await this.ensureReady();
    const stmt = db.prepare("SELECT * FROM memories");
    const now = Date.now();
    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        key: row.key,
        content: row.content,
        importance: row.importance,
        score: decayedScore(row.importance, row.timestamp, now)
      });
    }
    stmt.free();
    results.sort((a, b) => b.score - a.score);
    return results;
  }
  // ─── Private ─────────────────────────────────────────────────────
  async evictIfNeeded() {
    const db = await this.ensureReady();
    const countStmt = db.prepare("SELECT COUNT(*) as c FROM memories");
    countStmt.step();
    const count = countStmt.getAsObject().c;
    countStmt.free();
    if (count <= this.maxMemories) return;
    const evictCount = Math.ceil(count - this.maxMemories * 0.9);
    const now = Date.now();
    const stmt = db.prepare("SELECT key, importance, timestamp FROM memories WHERE importance != ?");
    stmt.bind(["critical"]);
    const candidates = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      candidates.push({
        key: row.key,
        score: decayedScore(row.importance, row.timestamp, now)
      });
    }
    stmt.free();
    candidates.sort((a, b) => a.score - b.score);
    const toEvict = candidates.slice(0, evictCount).map((e) => e.key);
    if (toEvict.length > 0) {
      for (const k of toEvict) {
        db.run("DELETE FROM memories WHERE key = ?", [k]);
      }
    }
  }
  keywordSearch(query, topK) {
    const q = `%${query.toLowerCase()}%`;
    const now = Date.now();
    const db = this.db;
    const stmt = db.prepare(
      "SELECT * FROM memories WHERE LOWER(content) LIKE ? OR LOWER(key) LIKE ? ORDER BY timestamp DESC"
    );
    stmt.bind([q, q]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const keywordScore = 0.5;
      const decayMultiplier = this.enableDecay ? decayedScore(row.importance, row.timestamp, now) : 1;
      rows.push({ row, score: keywordScore * decayMultiplier });
    }
    stmt.free();
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, topK).map(({ row, score }) => ({
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : void 0,
      timestamp: row.timestamp,
      relevanceScore: score
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
  /**
   * Collect relevant memories and format for context injection.
   * Now accepts budgetInfo from ContextManager for adaptive scaling.
   */
  async inject(query, topK = 5, budgetInfo) {
    const parts = [];
    const maxLen = budgetInfo?.maxItemLength ?? 2e3;
    const projectItems = await this.project.search(query, topK);
    if (projectItems.length > 0) {
      const items = this.applyBudget(projectItems, budgetInfo);
      parts.push("## Project Memory");
      for (const item of items) {
        parts.push(`### ${item.key}
${this.truncate(item.content, maxLen)}`);
      }
    }
    const workingItems = await this.working.search(query, topK);
    if (workingItems.length > 0) {
      const items = this.applyBudget(workingItems, budgetInfo);
      parts.push("## Working Context");
      for (const item of items) {
        parts.push(`- **${item.key}**: ${this.truncate(item.content, maxLen)}`);
      }
    }
    if (this.longTerm) {
      const ltItems = await this.longTerm.search(query, topK);
      if (ltItems.length > 0) {
        const items = this.applyBudget(ltItems, budgetInfo);
        parts.push("## Relevant Memories");
        for (const item of items) {
          parts.push(`- ${this.truncate(item.content, maxLen)}`);
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
  // ─── Budget Helpers ──────────────────────────────────────────────
  /** Trim items to fit remaining budget */
  applyBudget(items, budget) {
    if (!budget) return items;
    const result = [];
    let usedTokens = 0;
    for (const item of items) {
      const estimate = Math.ceil(item.content.length / 3);
      if (usedTokens + estimate > budget.remaining) break;
      result.push(item);
      usedTokens += estimate;
    }
    return result;
  }
  /** Truncate content to max length */
  truncate(content, maxLen) {
    if (content.length <= maxLen) return content;
    return content.slice(0, maxLen - 20) + "\n... [truncated]";
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  IMPORTANCE_BASE_SCORE,
  IMPORTANCE_HALFLIFE,
  LongTermMemory,
  MemoryInjector,
  ProjectMemory,
  WorkingMemory,
  classifyImportance,
  decayedScore
});
//# sourceMappingURL=index.cjs.map