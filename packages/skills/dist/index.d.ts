import { ToolDefinition } from '@agentnova/tools';
import { z } from 'zod';

/**
 * Skill System — Load, isolate, and activate skills on demand
 *
 * Skill = Tools + Prompt + Knowledge + Config
 */

interface SkillConfig {
    name: string;
    version: string;
    description: string;
    tools: ToolDefinition[];
    prompt: string;
    knowledge: string[];
    activateOn?: (input: string) => boolean;
    configSchema?: z.ZodType;
    defaultConfig?: Record<string, unknown>;
}
interface Skill extends SkillConfig {
    dir: string;
    active: boolean;
    resolvedConfig: Record<string, unknown>;
}
declare class SkillLoader {
    private skills;
    /** Load a skill from a directory */
    loadFromDir(dir: string): Promise<Skill>;
    /** Load multiple skills from directories */
    loadAll(dirs: string[]): Promise<Skill[]>;
    /** Activate skills relevant to the current input */
    activateForInput(input: string): Promise<Skill[]>;
    /** Explicitly activate a skill by name */
    activate(name: string): Skill | undefined;
    /** Deactivate a skill by name */
    deactivate(name: string): Skill | undefined;
    /** Get all active skills */
    getActive(): Skill[];
    /** Get tools from all active skills */
    getActiveTools(): ToolDefinition[];
    /** Get prompt fragments from all active skills */
    getActivePrompts(): string[];
    /** Get knowledge from all active skills */
    getActiveKnowledge(): string[];
    /** Get a skill by name */
    get(name: string): Skill | undefined;
    /** List all skill names */
    list(): string[];
}
interface SkillManifest {
    name: string;
    version: string;
    description: string;
    author?: string;
    source: string;
    dependencies?: Record<string, string>;
}
declare class SkillRegistry {
    private manifests;
    /** Register a skill manifest */
    register(manifest: SkillManifest): void;
    /** Search available skills */
    search(query: string): SkillManifest[];
    /** Get manifest by name */
    get(name: string): SkillManifest | undefined;
    /** List all available skills */
    list(): SkillManifest[];
}
declare function defineSkill(config: SkillConfig): SkillConfig;

export { type Skill, type SkillConfig, SkillLoader, type SkillManifest, SkillRegistry, defineSkill };
