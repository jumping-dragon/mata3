import { mkdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL ?? "file:data/mata3.db";
if (url === "file:data/mata3.db") mkdirSync("data", { recursive: true });

const client = createClient({
	url,
	authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

let ready: Promise<void> | undefined;

// Applies pending migrations once per process. For a local file, WAL mode lets
// DuckDB (or any SQLite reader) query the file while the app keeps writing.
export function dbReady(): Promise<void> {
	ready ??= (async () => {
		if (url.startsWith("file:"))
			await client.execute("PRAGMA journal_mode=WAL");
		await migrate(db, { migrationsFolder: "drizzle" });
	})();
	return ready;
}
