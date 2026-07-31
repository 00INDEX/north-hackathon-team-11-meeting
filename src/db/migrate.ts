import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultDatabasePath } from "./database";
import { closeDatabase, openDatabase } from "./index";
import { runMigrations } from "./migrations";

const databasePath = process.argv[2] ?? defaultDatabasePath();
mkdirSync(path.dirname(databasePath), { recursive: true });

const db = openDatabase({ filePath: databasePath });
try {
  runMigrations(db);
  console.log(`Migrations complete: ${databasePath}`);
} finally {
  closeDatabase(db);
}
