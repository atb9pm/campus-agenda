import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { SqlBatchStatement, SqlDatabase, SqlStatement } from "./types.ts";

function asSqlValues(values: unknown[]): SQLInputValue[] {
  return values as SQLInputValue[];
}

function wrapStatement(statement: ReturnType<DatabaseSync["prepare"]>, values: unknown[]): SqlStatement {
  const params = asSqlValues(values);
  return {
    async all<T>() {
      return { results: statement.all(...params) as T[] };
    },
    async first<T>() {
      return (statement.get(...params) as T | undefined) ?? null;
    },
    async run() {
      const result = statement.run(...params);
      return {
        success: true as const,
        meta: {
          last_row_id: Number(result.lastInsertRowid),
          changes: Number(result.changes),
        },
      };
    },
  };
}

export class NodeSqliteDatabase implements SqlDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  prepare(query: string) {
    const statement = this.db.prepare(query);
    return {
      bind: (...values: unknown[]) => wrapStatement(statement, values),
    };
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async batch(statements: SqlBatchStatement[]): Promise<void> {
    this.db.exec("BEGIN");
    try {
      for (const statement of statements) {
        this.db.prepare(statement.sql).run(...asSqlValues(statement.values));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // la transaction est déjà close
      }
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

export function createNodeSqliteDatabase(path = ":memory:"): NodeSqliteDatabase {
  return new NodeSqliteDatabase(path);
}

export function wrapD1Database(d1: D1DatabaseLike): SqlDatabase {
  return {
    prepare(query: string) {
      return {
        bind(...values: unknown[]): SqlStatement {
          const statement = d1.prepare(query).bind(...values);
          return {
            all: () => statement.all(),
            first: () => statement.first(),
            run: () => statement.run(),
          };
        },
      };
    },
    async exec(query: string) {
      await d1.exec(query);
    },
    async batch(statements: SqlBatchStatement[]) {
      await d1.batch(statements.map((statement) => d1.prepare(statement.sql).bind(...statement.values)));
    },
  };
}

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<{ success: boolean; meta?: { last_row_id?: number; changes?: number } }>;
    };
  };
  exec(query: string): Promise<unknown>;
  batch(statements: unknown[]): Promise<unknown>;
}
