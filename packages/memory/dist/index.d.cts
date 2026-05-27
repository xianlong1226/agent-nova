/**
 * Shared memory types
 */
interface MemoryItem {
    key: string;
    content: string;
    metadata?: Record<string, string>;
    timestamp: number;
    relevanceScore?: number;
}
interface MemoryStore {
    save(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
    get(key: string): Promise<MemoryItem | null>;
    search(query: string, topK?: number): Promise<MemoryItem[]>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
}

/**
 * Memory System — Three-layer memory architecture
 *
 * Layer 1: WorkingMemory   — in-memory, per-session
 * Layer 2: ProjectMemory   — file-based, like CLAUDE.md
 * Layer 3: LongTermMemory  — SQLite + embedding similarity
 */

declare class WorkingMemory implements MemoryStore {
    private store;
    save(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
    get(key: string): Promise<MemoryItem | null>;
    search(query: string, topK?: number): Promise<MemoryItem[]>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
    clear(): void;
    private keywordScore;
}
declare class ProjectMemory implements MemoryStore {
    private projectDir;
    private memories;
    constructor(projectDir: string);
    /** Load memories from AGENT.md file */
    load(): Promise<void>;
    save(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
    get(key: string): Promise<MemoryItem | null>;
    search(query: string, topK?: number): Promise<MemoryItem[]>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
    /** Persist memories back to AGENT.md */
    private persist;
    /** Parse AGENT.md sections into key-value pairs */
    private parseAgentMd;
}
interface LongTermMemoryConfig {
    dbPath: string;
    /** Embedding dimension (default 384 for small models) */
    embeddingDim?: number;
    /** Custom embedding function */
    embedFn?: (text: string) => Promise<number[]>;
}
declare class LongTermMemory implements MemoryStore {
    private db;
    private embedFn;
    private embeddingDim;
    constructor(config: LongTermMemoryConfig);
    private initSchema;
    save(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
    get(key: string): Promise<MemoryItem | null>;
    search(query: string, topK?: number): Promise<MemoryItem[]>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
    close(): void;
    private keywordSearch;
    private cosineSimilarity;
}
declare class MemoryInjector {
    private working;
    private project;
    private longTerm?;
    constructor(working: WorkingMemory, project: ProjectMemory, longTerm?: LongTermMemory | undefined);
    /** Collect relevant memories and format for context injection */
    inject(query: string, topK?: number): Promise<string>;
    /** Store a new memory item across appropriate layers */
    store(key: string, content: string, options?: {
        layer?: 'working' | 'project' | 'longterm';
        metadata?: Record<string, string>;
    }): Promise<void>;
}

export { LongTermMemory, type LongTermMemoryConfig, MemoryInjector, type MemoryItem, type MemoryStore, ProjectMemory, WorkingMemory };
