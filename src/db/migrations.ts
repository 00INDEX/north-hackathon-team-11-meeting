import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./database";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "migrations");

export interface MigrationRecord {
  id: number;
  name: string;
  appliedAt: string;
}

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const existing = db
    .prepare("SELECT id FROM schema_migrations")
    .all() as Array<{ id: number }>;
  const appliedIds = new Set(existing.map((row) => row.id));
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const id = Number(file.split("_")[0]);
    if (Number.isNaN(id) || appliedIds.has(id)) {
      continue;
    }

    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
      ).run(id, file, new Date().toISOString());
    })();
  }

  mkdirSync(path.dirname(migrationsDir), { recursive: true });
}

export function getMigrations(db: Database): MigrationRecord[] {
  return db
    .prepare(
      "SELECT id, name, applied_at AS appliedAt FROM schema_migrations ORDER BY id",
    )
    .all() as MigrationRecord[];
}
