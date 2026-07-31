import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { defaultDatabasePath } from './database';
import { closeDatabase, openDatabase } from './index';
import { runMigrations } from './migrations';
import { seedDatabase } from './seedData';

const databasePath = process.argv[2] ?? defaultDatabasePath();
mkdirSync(path.dirname(databasePath), { recursive: true });

rmSync(databasePath, { force: true });
rmSync(`${databasePath}-wal`, { force: true });
rmSync(`${databasePath}-shm`, { force: true });

const db = openDatabase({ filePath: databasePath });
try {
  runMigrations(db);
  seedDatabase(db);
  console.log(`Database reset and seeded: ${databasePath}`);
} finally {
  closeDatabase(db);
}
