declare module "cloudflare:workers" {
  export const env: {
    CAMPUS_DB?: {
      prepare(query: string): {
        bind(...values: unknown[]): {
          all<T>(): Promise<{ results: T[] }>;
          first<T>(): Promise<T | null>;
          run(): Promise<{ success: boolean; meta?: { last_row_id?: number; changes?: number } }>;
        };
      };
      exec(query: string): Promise<unknown>;
      batch(statements: unknown[]): Promise<unknown>;
    };
    AUTH_RATE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
  };
}
