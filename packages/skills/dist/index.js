// src/loader.ts
import { readFile, readdir } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
var SkillLoader = class {
  /**
   * Load all skills from the given directories.
   * Each skill directory should contain a skill.config.json or skill.config.ts file.
   */
  async loadAll(dirs) {
    const skills = [];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(dir, entry.name);
        try {
          const skill = await this.loadOne(skillDir);
          if (skill) skills.push(skill);
        } catch (err) {
          console.warn(`[SkillLoader] Failed to load skill from ${skillDir}: ${err}`);
        }
      }
    }
    return skills;
  }
  /** Load a single skill from a directory */
  async loadOne(dir) {
    const configPath = join(dir, "skill.config.json");
    if (!existsSync(configPath)) return null;
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    let prompt = config.prompt;
    if (prompt && !prompt.includes("\n")) {
      const promptPath = resolve(dir, prompt);
      if (existsSync(promptPath)) {
        prompt = await readFile(promptPath, "utf-8");
      }
    }
    let knowledge = [];
    if (config.knowledge?.length) {
      knowledge = await Promise.all(
        config.knowledge.map(async (kRef) => {
          const kPath = resolve(dir, kRef);
          if (existsSync(kPath)) {
            return await readFile(kPath, "utf-8");
          }
          return kRef;
        })
      );
    }
    let tools = config.tools ?? [];
    const toolsPath = join(dir, "tools.json");
    if (existsSync(toolsPath)) {
      try {
        const toolsData = JSON.parse(await readFile(toolsPath, "utf-8"));
        if (Array.isArray(toolsData)) {
          tools = [...tools, ...toolsData];
        }
      } catch {
      }
    }
    let fullPrompt = prompt ?? "";
    if (knowledge.length > 0) {
      fullPrompt += "\n\n## Knowledge\n\n" + knowledge.map((k, i) => `### Source ${i + 1}
${k}`).join("\n\n");
    }
    return {
      ...config,
      dir,
      tools,
      prompt: fullPrompt || void 0,
      active: false,
      resolvedConfig: config.defaultConfig ?? {}
    };
  }
};
function defineSkill(config) {
  return config;
}

// src/market.ts
import { readFile as readFile2, writeFile, mkdir } from "fs/promises";
import { existsSync as existsSync2 } from "fs";
import { join as join2 } from "path";
import { exec } from "child_process";
var SkillRegistry = class {
  manifests = /* @__PURE__ */ new Map();
  skillsDir;
  registryFile;
  constructor(config) {
    this.skillsDir = config.skillsDir;
    this.registryFile = config.registryFile ?? join2(config.skillsDir, "registry.json");
  }
  /** Load registry from disk */
  async load() {
    if (!existsSync2(this.registryFile)) return;
    const data = await readFile2(this.registryFile, "utf-8");
    const arr = JSON.parse(data);
    for (const m of arr) {
      this.manifests.set(m.name, m);
    }
  }
  /** Save registry to disk */
  async save() {
    if (!existsSync2(this.skillsDir)) await mkdir(this.skillsDir, { recursive: true });
    const arr = Array.from(this.manifests.values());
    await writeFile(this.registryFile, JSON.stringify(arr, null, 2), "utf-8");
  }
  /** Register a skill manifest */
  register(manifest) {
    this.manifests.set(manifest.name, manifest);
  }
  /** Search available skills by name, description, or tags */
  search(query) {
    const q = query.toLowerCase();
    const qChars = [...q];
    return Array.from(this.manifests.values()).filter((m) => {
      const text = `${m.name} ${m.description} ${(m.tags ?? []).join(" ")}`.toLowerCase();
      if (text.includes(q)) return true;
      return qChars.some((c) => text.includes(c));
    });
  }
  /** Get manifest by name */
  get(name) {
    return this.manifests.get(name);
  }
  /** List all available skills */
  list() {
    return Array.from(this.manifests.values());
  }
  /** Install a skill from git repo */
  async install(source, options) {
    const skillName = options?.name ?? source.split("/").pop()?.replace(".git", "") ?? "unknown";
    const targetDir = join2(this.skillsDir, skillName);
    if (existsSync2(targetDir)) {
      throw new Error(`Skill "${skillName}" already installed at ${targetDir}`);
    }
    await new Promise((resolve2, reject) => {
      const cmd = source.startsWith("http") || source.endsWith(".git") ? `git clone --depth 1 ${source} ${targetDir}` : `npm pack ${source} --pack-destination ${this.skillsDir} && cd ${this.skillsDir} && tar xf *.tgz && rm *.tgz`;
      exec(cmd, (err) => {
        if (err) reject(new Error(`Install failed: ${err.message}`));
        else resolve2();
      });
    });
    const manifest = {
      name: skillName,
      version: "1.0.0",
      description: `Installed from ${source}`,
      source
    };
    const configPath = join2(targetDir, "skill.config.json");
    if (existsSync2(configPath)) {
      try {
        const configData = JSON.parse(await readFile2(configPath, "utf-8"));
        manifest.version = configData.version ?? manifest.version;
        manifest.description = configData.description ?? manifest.description;
        manifest.author = configData.author;
        manifest.tags = configData.tags;
      } catch {
      }
    }
    this.register(manifest);
    await this.save();
    return manifest;
  }
  /** Uninstall a skill by name */
  async uninstall(name) {
    if (!this.manifests.has(name)) return false;
    this.manifests.delete(name);
    await this.save();
    const skillDir = join2(this.skillsDir, name);
    if (existsSync2(skillDir)) {
      await new Promise((resolve2, reject) => {
        exec(`rm -rf ${skillDir}`, (err) => {
          if (err) reject(err);
          else resolve2();
        });
      });
    }
    return true;
  }
};
export {
  SkillLoader,
  SkillRegistry,
  defineSkill
};
//# sourceMappingURL=index.js.map