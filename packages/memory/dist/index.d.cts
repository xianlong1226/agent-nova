/**
 * Shared memory types
 */
interface MemoryItem {
    key: string;
    content: string;
    metadata?: Record<string, string>;
    timestamp: number;
    relevanceScore?: number;
    importance?: 'critical' | 'high' | 'normal' | 'low';
}
interface MemoryStore {
    save(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
    get(key: string): Promise<MemoryItem | null>;
    search(query: string, topK?: number): Promise<MemoryItem[]>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
}

/**
 * Memory System — Production-grade three-layer memory with importance decay
 *
 * Layer 1: WorkingMemory   — in-memory, per-session, ephemeral
 * Layer 2: ProjectMemory   — file-based (AGENT.md), persists across sessions
 * Layer 3: LongTermMemory  — SQLite + semantic search, with importance scoring & decay
 */

/**
 * Memory importance signals — determines how quickly a memory decays
 * and whether it should be proactively evicted.
 */
type ImportanceLevel = 'critical' | 'high' | 'normal' | 'low';
/** Half-life in hours for each importance level */
declare const IMPORTANCE_HALFLIFE: Record<ImportanceLevel, number>;
/** Base score for each importance level */
declare const IMPORTANCE_BASE_SCORE: Record<ImportanceLevel, number>;
/**
 * Calculate time-decayed relevance score.
 * Uses exponential decay: score = base * 0.5 ^ (age_hours / halflife)
 */
declare function decayedScore(importance: ImportanceLevel, timestamp: number, now?: number): number;
/** Auto-classify importance from content heuristics */
declare function classifyImportance(content: string, key: string): ImportanceLevel;
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
    /** Get all items (for full injection into system prompt) */
    getAll(): MemoryItem[];
    /** Persist memories back to AGENT.md */
    private persist;
    /** Parse AGENT.md sections into key-value pairs */
    private parseAgentMd;
}
interface LongTermMemoryConfig {
    dbPath: string;
    /** Embedding dimension (default 384) */
    embeddingDim?: number;
    /** Custom embedding function */
    embedFn?: (text: string) => Promise<number[]>;
    /** Maximum memories to retain (evicts lowest-score when exceeded) */
    maxMemories?: number;
    /** Enable importance decay scoring */
    enableDecay?: boolean;
}
declare class LongTermMemory implements MemoryStore {
    private db;
    private dbPath;
    private embedFn;
    private embeddingDim;
    private maxMemories;
    private enableDecay;
    private ready;
    constructor(config: LongTermMemoryConfig);
    private init;
    private ensureReady;
    private initSchema;
    private persist;
    save(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
    get(key: string): Promise<MemoryItem | null>;
    search(query: string, topK?: number): Promise<MemoryItem[]>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
    close(): Promise<void>;
    /** Get memories sorted by decayed importance (for inspection/debugging) */
    getMemoriesByImportance(): Promise<Array<{
        key: string;
        content: string;
        importance: ImportanceLevel;
        score: number;
    }>>;
    private evictIfNeeded;
    private keywordSearch;
    private cosineSimilarity;
}
declare class MemoryInjector {
    private working;
    private project;
    private longTerm?;
    constructor(working: WorkingMemory, project: ProjectMemory, longTerm?: LongTermMemory | undefined);
    /**
     * Collect relevant memories and format for context injection.
     * Now accepts budgetInfo from ContextManager for adaptive scaling.
     */
    inject(query: string, topK?: number, budgetInfo?: {
        maxItemLength: number;
        remaining: number;
    }): Promise<string>;
    /** Store a new memory item across appropriate layers */
    store(key: string, content: string, options?: {
        layer?: 'working' | 'project' | 'longterm';
        importance?: ImportanceLevel;
        metadata?: Record<string, string>;
    }): Promise<void>;
    /** Trim items to fit remaining budget */
    private applyBudget;
    /** Truncate content to max length */
    private truncate;
}

export { IMPORTANCE_BASE_SCORE, IMPORTANCE_HALFLIFE, type ImportanceLevel, LongTermMemory, type LongTermMemoryConfig, MemoryInjector, type MemoryItem, type MemoryStore, ProjectMemory, WorkingMemory, classifyImportance, decayedScore };
