// src/index.ts
import { readFile, readdir } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
var SkillLoader = class {
  skills = /* @__PURE__ */ new Map();
  /** Load a skill from a directory */
  async loadFromDir(dir) {
    const resolvedDir = resolve(dir);
    const skillMdPath = join(resolvedDir, "SKILL.md");
    let prompt = "";
    if (existsSync(skillMdPath)) {
      prompt = await readFile(skillMdPath, "utf-8");
    }
    let config = {};
    const configPath = join(resolvedDir, "skill.config.ts");
    if (existsSync(configPath)) {
      try {
        const mod = await import(configPath);
        if (mod.default) config = mod.default;
      } catch {
      }
    }
    const knowledge = [];
    const knowledgeDir = join(resolvedDir, "knowledge");
    if (existsSync(knowledgeDir)) {
      const files = await readdir(knowledgeDir);
      for (const file of files) {
        if (file.endsWith(".md") || file.endsWith(".txt")) {
          const content = await readFile(join(knowledgeDir, file), "utf-8");
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
export {
  SkillLoader,
  SkillRegistry,
  defineSkill
};
//# sourceMappingURL=index.js.map