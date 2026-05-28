declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: unknown[]): void
    exec(sql: string): any[]
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
    getAsObject(): any
  }

  interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    getAsObject(): any
    free(): boolean
    getColumnNames(): string[]
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database
  }

  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>
  export type { Database, Statement, SqlJsStatic }
}
