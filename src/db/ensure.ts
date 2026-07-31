import { closeDatabase, openDatabase } from './index';
import { runMigrations } from './migrations';
import { seedDatabase } from './seedData';

export function ensureDatabaseReady(): void {
  const db = openDatabase();
  try {
    runMigrations(db);
    seedDatabase(db);
  } finally {
    closeDatabase(db);
  }
}
