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
  SkillLoader: () => SkillLoader,
  SkillRegistry: () => SkillRegistry,
  defineSkill: () => defineSkill
});
module.exports = __toCommonJS(index_exports);
var import_promises = require("fs/promises");
var import_path = require("path");
var import_fs = require("fs");
var SkillLoader = class {
  skills = /* @__PURE__ */ new Map();
  /** Load a skill from a directory */
  async loadFromDir(dir) {
    const resolvedDir = (0, import_path.resolve)(dir);
    const skillMdPath = (0, import_path.join)(resolvedDir, "SKILL.md");
    let prompt = "";
    if ((0, import_fs.existsSync)(skillMdPath)) {
      prompt = await (0, import_promises.readFile)(skillMdPath, "utf-8");
    }
    let config = {};
    const configPath = (0, import_path.join)(resolvedDir, "skill.config.ts");
    if ((0, import_fs.existsSync)(configPath)) {
      try {
        const mod = await import(configPath);
        if (mod.default) config = mod.default;
      } catch {
      }
    }
    const knowledge = [];
    const knowledgeDir = (0, import_path.join)(resolvedDir, "knowledge");
    if ((0, import_fs.existsSync)(knowledgeDir)) {
      const files = await (0, import_promises.readdir)(knowledgeDir);
      for (const file of files) {
        if (file.endsWith(".md") || file.endsWith(".txt")) {
          const content = await (0, import_promises.readFile)((0, import_path.join)(knowledgeDir, file), "utf-8");
          knowledge.push(content);
        }
      }
    }
    const skill = {
      name: config.name ?? dir.split("/").pop() ?? "unknown",
      version: config.version ?? "0.0.1",
      description: config.description ?? "",
      tools: config.tools ?? [],
      prompt,
      knowledge,
      activateOn: config.activateOn,
      configSchema: config.configSchema,
      defaultConfig: config.defaultConfig ?? {},
      dir: resolvedDir,
      active: false,
      resolvedConfig: {}
    };
    this.skills.set(skill.name, skill);
    return skill;
  }
  /** Load multiple skills from directories */
  async loadAll(dirs) {
    const skills = [];
    for (const dir of dirs) {
      try {
        const skill = await this.loadFromDir(dir);
        skills.push(skill);
      } catch (err) {
        console.warn(`Failed to load skill from ${dir}:`, err);
      }
    }
    return skills;
  }
  /** Activate skills relevant to the current input */
  async activateForInput(input) {
    const activated = [];
    for (const skill of this.skills.values()) {
      if (skill.activateOn) {
        if (skill.activateOn(input)) {
          skill.active = true;
          activated.push(skill);
        }
      } else {
      }
    }
    return activated;
  }
  /** Explicitly activate a skill by name */
  activate(name) {
    const skill = this.skills.get(name);
    if (skill) skill.active = true;
    return skill;
  }
  /** Deactivate a skill by name */
  deactivate(name) {
    const skill = this.skills.get(name);
    if (skill) skill.active = false;
    return skill;
  }
  /** Get all active skills */
  getActive() {
    return Array.from(this.skills.values()).filter((s) => s.active);
  }
  /** Get tools from all active skills */
  getActiveTools() {
    return this.getActive().flatMap((s) => s.tools);
  }
  /** Get prompt fragments from all active skills */
  getActivePrompts() {
    return this.getActive().filter((s) => s.prompt).map((s) => s.prompt);
  }
  /** Get knowledge from all active skills */
  getActiveKnowledge() {
    return this.getActive().flatMap((s) => s.knowledge);
  }
  /** Get a skill by name */
  get(name) {
    return this.skills.get(name);
  }
  /** List all skill names */
  list() {
    return Array.from(this.skills.keys());
  }
};
var SkillRegistry = class {
  manifests = /* @__PURE__ */ new Map();
  /** Register a skill manifest */
  register(manifest) {
    this.manifests.set(manifest.name, manifest);
  }
  /** Search available skills */
  search(query) {
    const q = query.toLowerCase();
    return Array.from(this.manifests.values()).filter(
      (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
    );
  }
  /** Get manifest by name */
  get(name) {
    return this.manifests.get(name);
  }
  /** List all available skills */
  list() {
    return Array.from(this.manifests.values());
  }
};
function defineSkill(config) {
  return config;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SkillLoader,
  SkillRegistry,
  defineSkill
});
//# sourceMappingURL=index.cjs.map