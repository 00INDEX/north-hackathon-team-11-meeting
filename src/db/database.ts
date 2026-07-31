import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database as DatabaseType } from "better-sqlite3";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (
  filename?: string,
) => DatabaseType;

export type Database = DatabaseType;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

export function defaultDatabasePath(): string {
  return process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/^file:/, "")
    : path.join(projectRoot, "data", "meeting-room.sqlite3");
}

export function createDatabase(filePath = defaultDatabasePath()): Database {
  return new Database(filePath);
}
