declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface Statement {
    bind(values?: unknown[] | Record<string, unknown>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }

  export interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer) => Database;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
