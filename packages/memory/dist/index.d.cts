/**
 * Memory System — Three-layer memory architecture
 *
 * Layer 1: Working Memory (in-memory, per-session)
 * Layer 2: Project Memory (file-based, like CLAUDE.md)
 * Layer 3: Long-term Memory (SQLite + embeddings, cross-session)
 */
interface MemoryItem {
    key: string;
    content: string;
    metadata?: Record<string, string>;
    timestamp: number;
    relevanceScore?: number;
}
interface MemoryStore {
    /** Store a memory item */
    save(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
    /** Get a memory item by key */
    get(key: string): Promise<MemoryItem | null>;
    /** Search memories by semantic similarity */
    search(query: string, topK?: number): Promise<MemoryItem[]>;
    /** Delete a memory item */
    delete(key: string): Promise<void>;
    /** List all keys */
    list(): Promise<string[]>;
}
declare class WorkingMemory implements MemoryStore {
    private store;
    save(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
    get(key: string): Promise<MemoryItem | null>;
    search(query: string, topK?: number): Promise<MemoryItem[]>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
    /** Clear all working memory */
    clear(): void;
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
declare class MemoryInjector {
    private working;
    private project;
    private longTerm?;
    constructor(working: WorkingMemory, project: ProjectMemory, longTerm?: MemoryStore | undefined);
    /** Collect relevant memories and format for context injection */
    inject(query: string, topK?: number): Promise<string>;
}

export { MemoryInjector, type MemoryItem, type MemoryStore, ProjectMemory, WorkingMemory };
