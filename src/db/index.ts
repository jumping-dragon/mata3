import { mkdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

export const dbUrl = process.env.TURSO_DATABASE_URL ?? "file:data/mata3.db";
if (dbUrl === "file:data/mata3.db") mkdirSync("data", { recursive: true });

// Path of the database file when it is local, null for a remote Turso URL.
export const localDbPath = dbUrl.startsWith("file:") ? dbUrl.slice(5) : null;

const client = createClient({
	url: dbUrl,
	authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

let ready: Promise<void> | undefined;

// For a local file: switches to WAL, which lets DuckDB (or any SQLite reader)
// query the file while the app keeps writing, and applies pending migrations
// once per process. A remote database is migrated at deploy time instead
// (`bun run db:migrate` in vercel.json); serverless bundles do not include the
// drizzle/ folder.
export function dbReady(): Promise<void> {
	ready ??= (async () => {
		if (!localDbPath) return;
		await client.execute("PRAGMA journal_mode=WAL");
		await migrate(db, { migrationsFolder: "drizzle" });
	})();
	return ready;
}
