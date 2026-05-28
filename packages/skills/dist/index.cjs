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

// src/loader.ts
var import_promises = require("fs/promises");
var import_path = require("path");
var import_fs = require("fs");
var SkillLoader = class {
  /**
   * Load all skills from the given directories.
   * Each skill directory should contain a skill.config.json or skill.config.ts file.
   */
  async loadAll(dirs) {
    const skills = [];
    for (const dir of dirs) {
      if (!(0, import_fs.existsSync)(dir)) continue;
      const entries = await (0, import_promises.readdir)(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = (0, import_path.join)(dir, entry.name);
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
    const configPath = (0, import_path.join)(dir, "skill.config.json");
    if (!(0, import_fs.existsSync)(configPath)) return null;
    const raw = await (0, import_promises.readFile)(configPath, "utf-8");
    const config = JSON.parse(raw);
    let prompt = config.prompt;
    if (prompt && !prompt.includes("\n")) {
      const promptPath = (0, import_path.resolve)(dir, prompt);
      if ((0, import_fs.existsSync)(promptPath)) {
        prompt = await (0, import_promises.readFile)(promptPath, "utf-8");
      }
    }
    let knowledge = [];
    if (config.knowledge?.length) {
      knowledge = await Promise.all(
        config.knowledge.map(async (kRef) => {
          const kPath = (0, import_path.resolve)(dir, kRef);
          if ((0, import_fs.existsSync)(kPath)) {
            return await (0, import_promises.readFile)(kPath, "utf-8");
          }
          return kRef;
        })
      );
    }
    let tools = config.tools ?? [];
    const toolsPath = (0, import_path.join)(dir, "tools.json");
    if ((0, import_fs.existsSync)(toolsPath)) {
      try {
        const toolsData = JSON.parse(await (0, import_promises.readFile)(toolsPath, "utf-8"));
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
var import_promises2 = require("fs/promises");
var import_fs2 = require("fs");
var import_path2 = require("path");
var import_child_process = require("child_process");
var SkillRegistry = class {
  manifests = /* @__PURE__ */ new Map();
  skillsDir;
  registryFile;
  constructor(config) {
    this.skillsDir = config.skillsDir;
    this.registryFile = config.registryFile ?? (0, import_path2.join)(config.skillsDir, "registry.json");
  }
  /** Load registry from disk */
  async load() {
    if (!(0, import_fs2.existsSync)(this.registryFile)) return;
    const data = await (0, import_promises2.readFile)(this.registryFile, "utf-8");
    const arr = JSON.parse(data);
    for (const m of arr) {
      this.manifests.set(m.name, m);
    }
  }
  /** Save registry to disk */
  async save() {
    if (!(0, import_fs2.existsSync)(this.skillsDir)) await (0, import_promises2.mkdir)(this.skillsDir, { recursive: true });
    const arr = Array.from(this.manifests.values());
    await (0, import_promises2.writeFile)(this.registryFile, JSON.stringify(arr, null, 2), "utf-8");
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
    const targetDir = (0, import_path2.join)(this.skillsDir, skillName);
    if ((0, import_fs2.existsSync)(targetDir)) {
      throw new Error(`Skill "${skillName}" already installed at ${targetDir}`);
    }
    await new Promise((resolve2, reject) => {
      const cmd = source.startsWith("http") || source.endsWith(".git") ? `git clone --depth 1 ${source} ${targetDir}` : `npm pack ${source} --pack-destination ${this.skillsDir} && cd ${this.skillsDir} && tar xf *.tgz && rm *.tgz`;
      (0, import_child_process.exec)(cmd, (err) => {
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
    const configPath = (0, import_path2.join)(targetDir, "skill.config.json");
    if ((0, import_fs2.existsSync)(configPath)) {
      try {
        const configData = JSON.parse(await (0, import_promises2.readFile)(configPath, "utf-8"));
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
    const skillDir = (0, import_path2.join)(this.skillsDir, name);
    if ((0, import_fs2.existsSync)(skillDir)) {
      await new Promise((resolve2, reject) => {
        (0, import_child_process.exec)(`rm -rf ${skillDir}`, (err) => {
          if (err) reject(err);
          else resolve2();
        });
      });
    }
    return true;
  }
  /**
   * Publish a skill to a Git remote or npm registry
   *
   * Git mode:
   *   1. Initialize git repo in skill dir (if not already)
   *   2. Commit all files
   *   3. Push to remote
   *
   * npm mode:
   *   1. Generate package.json wrapper
   *   2. Run npm publish
   */
  async publish(name, options) {
    const skillDir = (0, import_path2.join)(this.skillsDir, name);
    if (!(0, import_fs2.existsSync)(skillDir)) {
      return { success: false, message: `Skill directory not found: ${skillDir}` };
    }
    const configPath = (0, import_path2.join)(skillDir, "skill.config.json");
    let skillConfig = { name, version: "1.0.0" };
    if ((0, import_fs2.existsSync)(configPath)) {
      try {
        skillConfig = JSON.parse(await (0, import_promises2.readFile)(configPath, "utf-8"));
      } catch {
      }
    }
    if (options?.registry || !options?.remote && (0, import_fs2.existsSync)((0, import_path2.join)(skillDir, "package.json"))) {
      return this.publishToNpm(skillDir, skillConfig, options);
    }
    if (options?.remote) {
      return this.publishToGit(skillDir, name, { remote: options.remote, tag: options.tag, dryRun: options.dryRun });
    }
    return {
      success: false,
      message: "No publish target specified. Provide --remote (Git URL) or --registry (npm URL)"
    };
  }
  /** Push skill to a Git remote */
  async publishToGit(skillDir, name, options) {
    const branch = options.tag ?? "main";
    const execCmd = (cmd) => new Promise((resolve2, reject) => {
      (0, import_child_process.exec)(cmd, { cwd: skillDir }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${cmd}: ${stderr || err.message}`));
        else resolve2(stdout.trim());
      });
    });
    try {
      if (!(0, import_fs2.existsSync)((0, import_path2.join)(skillDir, ".git"))) {
        await execCmd("git init");
      }
      await execCmd("git add -A");
      try {
        await execCmd(`git commit -m "publish skill: ${name}"`);
      } catch {
      }
      try {
        await execCmd("git remote get-url origin");
        await execCmd(`git remote set-url origin ${options.remote}`);
      } catch {
        await execCmd(`git remote add origin ${options.remote}`);
      }
      if (options.dryRun) {
        return {
          success: true,
          message: `[DRY RUN] Would push ${name} to ${options.remote} (${branch})`,
          url: options.remote
        };
      }
      await execCmd(`git push -u origin HEAD:${branch} --force`);
      const manifest = this.manifests.get(name);
      if (manifest) {
        manifest.source = options.remote;
        await this.save();
      }
      return {
        success: true,
        message: `\u2705 Published ${name} to ${options.remote} (${branch})`,
        url: options.remote
      };
    } catch (err) {
      return { success: false, message: `Git publish failed: ${err.message}` };
    }
  }
  /** Publish skill as an npm package */
  async publishToNpm(skillDir, skillConfig, options) {
    const pkgName = `@agentnova/skill-${skillConfig.name}` || `agentnova-skill-${skillConfig.name}`;
    const pkgPath = (0, import_path2.join)(skillDir, "package.json");
    if (!(0, import_fs2.existsSync)(pkgPath)) {
      const pkgJson = {
        name: pkgName,
        version: skillConfig.version || "1.0.0",
        description: skillConfig.description || "",
        main: "skill.config.json",
        files: ["**/*.json", "**/*.md", "tools/**/*", "knowledge/**/*"],
        keywords: skillConfig.tags || ["agentnova", "skill"],
        license: "MIT"
      };
      await (0, import_promises2.writeFile)(pkgPath, JSON.stringify(pkgJson, null, 2), "utf-8");
    }
    const execCmd = (cmd) => new Promise((resolve2, reject) => {
      (0, import_child_process.exec)(cmd, { cwd: skillDir }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${cmd}: ${stderr || err.message}`));
        else resolve2(stdout.trim());
      });
    });
    try {
      const registryFlag = options?.registry ? ` --registry ${options.registry}` : "";
      const tagFlag = options?.tag ? ` --tag ${options.tag}` : "";
      const dryRunFlag = options?.dryRun ? " --dry-run" : "";
      if (options?.dryRun) {
        await execCmd(`npm pack${dryRunFlag}`);
        return {
          success: true,
          message: `[DRY RUN] Would publish ${pkgName}@${skillConfig.version} to npm`
        };
      }
      await execCmd(`npm publish --access public${registryFlag}${tagFlag}`);
      const manifest = this.manifests.get(skillConfig.name);
      if (manifest) {
        manifest.source = pkgName;
        await this.save();
      }
      return {
        success: true,
        message: `\u2705 Published ${pkgName}@${skillConfig.version} to npm`,
        url: `https://www.npmjs.com/package/${pkgName}`
      };
    } catch (err) {
      return { success: false, message: `npm publish failed: ${err.message}` };
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SkillLoader,
  SkillRegistry,
  defineSkill
});
//# sourceMappingURL=index.cjs.map