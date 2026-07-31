import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDatabase, type Database } from './database';

export type { Database } from './database';
export { getMigrations, runMigrations } from './migrations';

export interface DatabaseOptions {
  filePath?: string;
  migrate?: boolean;
}

export function openDatabase(options: DatabaseOptions = {}): Database {
  const filePath = options.filePath;
  if (filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const db = createDatabase(filePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function closeDatabase(db: Database): void {
  db.close();
}

