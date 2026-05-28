import { z } from 'zod';
import { ToolDefinition } from '@agentnova/tools';

interface SkillConfig {
    name: string;
    version: string;
    description: string;
    tools?: ToolDefinition[];
    prompt?: string;
    knowledge?: string[];
    activateOn?: (input: string) => boolean;
    configSchema?: z.ZodType;
    defaultConfig?: Record<string, unknown>;
}
interface Skill extends SkillConfig {
    dir: string;
    active: boolean;
    resolvedConfig: Record<string, unknown>;
}
interface SkillManifest$1 {
    name: string;
    version: string;
    description: string;
    author?: string;
    source: string;
    dependencies?: Record<string, string>;
    tags?: string[];
}

declare class SkillLoader {
    /**
     * Load all skills from the given directories.
     * Each skill directory should contain a skill.config.json or skill.config.ts file.
     */
    loadAll(dirs: string[]): Promise<Skill[]>;
    /** Load a single skill from a directory */
    loadOne(dir: string): Promise<Skill | null>;
}
declare function defineSkill(config: SkillConfig): SkillConfig;

/**
 * Skill Market — Team sharing via Git repos or npm packages
 */
interface SkillManifest {
    name: string;
    version: string;
    description: string;
    author?: string;
    source: string;
    dependencies?: Record<string, string>;
    tags?: string[];
}
interface SkillRegistryConfig {
    /** Directory for installed skills */
    skillsDir: string;
    /** Registry file path (stores manifest index) */
    registryFile?: string;
}
declare class SkillRegistry {
    private manifests;
    private skillsDir;
    private registryFile;
    constructor(config: SkillRegistryConfig);
    /** Load registry from disk */
    load(): Promise<void>;
    /** Save registry to disk */
    save(): Promise<void>;
    /** Register a skill manifest */
    register(manifest: SkillManifest): void;
    /** Search available skills by name, description, or tags */
    search(query: string): SkillManifest[];
    /** Get manifest by name */
    get(name: string): SkillManifest | undefined;
    /** List all available skills */
    list(): SkillManifest[];
    /** Install a skill from git repo */
    install(source: string, options?: {
        name?: string;
    }): Promise<SkillManifest>;
    /** Uninstall a skill by name */
    uninstall(name: string): Promise<boolean>;
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
    publish(name: string, options?: {
        remote?: string;
        registry?: string;
        tag?: string;
        dryRun?: boolean;
    }): Promise<{
        success: boolean;
        message: string;
        url?: string;
    }>;
    /** Push skill to a Git remote */
    private publishToGit;
    /** Publish skill as an npm package */
    private publishToNpm;
}

export { type Skill, type SkillConfig, SkillLoader, type SkillManifest$1 as SkillManifest, SkillRegistry, defineSkill };
