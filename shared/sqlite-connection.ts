import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
export type { SQLInputValue, SQLOutputValue } from 'node:sqlite';

/** SQL operations shared by native Node SQLite and managed synchronous SQLite. */
export interface StatementSync {
  get(...values: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
  all(...values: SQLInputValue[]): Record<string, SQLOutputValue>[];
  iterate(...values: SQLInputValue[]): IterableIterator<Record<string, SQLOutputValue>>;
  run(...values: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  setReadBigInts(enabled: boolean): void;
}
export interface DatabaseSync {
  readonly isTransaction: boolean;
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
  close(): void;
}
