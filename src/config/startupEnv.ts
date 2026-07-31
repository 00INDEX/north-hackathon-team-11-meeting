/**
 * Startup environment validation for the meeting room server.
 *
 * RFC-0003: T1 validates only the environment variable names required by the
 * local server and Agent startup path, and never prints secret values.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultDatabasePath } from "@/db/database";

const REQUIRED_ENV_VARS = [
  "NEX_API_BASE_URL",
  "NEX_API_KEY",
  "NEX_MODEL",
  "MEETING_ROOM_API_BASE_URL",
] as const;

export function validateStartupEnvironment(): void {
  const missing = REQUIRED_ENV_VARS.filter(
    (name) => !process.env[name] || process.env[name]?.trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  mkdirSync(path.dirname(defaultDatabasePath()), { recursive: true });
}
