import { createServerFn } from "@tanstack/react-start";
import { dbReady, localDbPath } from "#/db";

const MAX_ROWS = 1000;

export type Cell = string | number | boolean | null;

export type SqlResult = {
	columns: string[];
	rows: Cell[][];
	truncated: boolean;
	durationMs: number;
};

export type TableInfo = {
	name: string;
	columns: { name: string; type: string }[];
};

// One query's output, shared by bun:sqlite and node:sqlite.
type QueryOutput = { columnNames: string[]; rows: unknown[][] };
type ReadOnlyDb = { query(sql: string): Promise<QueryOutput> };

let readOnly: Promise<ReadOnlyDb> | undefined;

// A separate connection opened with SQLITE_OPEN_READONLY, so SQLite itself
// rejects writes, schema changes, PRAGMA writes and ATTACH of new files; no
// keyword filtering is involved. libsql ignores its `readonly` option as of
// libsql 0.5.29, so this uses the runtime's built-in SQLite: `bun --bun run
// dev` runs under bun, plain `bun run dev` runs vite under node.
function readOnlyDb(): Promise<ReadOnlyDb> {
	readOnly ??= open();
	readOnly.catch(() => {
		readOnly = undefined;
	});
	return readOnly;
}

async function open(): Promise<ReadOnlyDb> {
	const path = localDbPath;
	if (!path) {
		throw new Error(
			"The SQL page reads the local database file only; TURSO_DATABASE_URL points at a remote database.",
		);
	}
	// A read-only connection cannot create the WAL index (-shm) file, so let the
	// app's own connection create it first.
	await dbReady();
	if (process.versions.bun) {
		const { Database } = await import("bun:sqlite");
		const db = new Database(path, { readonly: true });
		return {
			async query(sql) {
				const stmt = db.query(sql);
				// values() is null for statements that return no rows.
				return { columnNames: stmt.columnNames, rows: stmt.values() ?? [] };
			},
		};
	}
	const { DatabaseSync } = await import("node:sqlite");
	const db = new DatabaseSync(path, { readOnly: true });
	return {
		async query(sql) {
			const stmt = db.prepare(sql);
			stmt.setReturnArrays(true);
			return {
				columnNames: stmt.columns().map((c) => c.name),
				rows: stmt.all() as unknown as unknown[][],
			};
		},
	};
}

function toCell(v: unknown): Cell {
	if (v instanceof Uint8Array) return `<blob ${v.byteLength} bytes>`;
	if (typeof v === "bigint") return v.toString();
	return v as Cell;
}

// True when `sql` holds more than one statement. SQLite prepares only the
// first statement and ignores the rest, which would silently drop part of the
// input. Skips semicolons inside quotes and comments.
function hasMultipleStatements(sql: string): boolean {
	let quote: string | null = null;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (quote) {
			if (ch === quote) quote = null;
		} else if (ch === "'" || ch === '"' || ch === "`") {
			quote = ch;
		} else if (ch === "[") {
			quote = "]";
		} else if (ch === "-" && sql[i + 1] === "-") {
			const end = sql.indexOf("\n", i);
			i = end === -1 ? sql.length : end;
		} else if (ch === "/" && sql[i + 1] === "*") {
			const end = sql.indexOf("*/", i + 2);
			i = end === -1 ? sql.length : end + 1;
		} else if (ch === ";" && sql.slice(i + 1).trim()) {
			return true;
		}
	}
	return false;
}

function toResult({
	columnNames,
	rows,
}: QueryOutput): Omit<SqlResult, "durationMs"> {
	const width = rows[0]?.length ?? columnNames.length;
	return {
		columns:
			columnNames.length === width
				? columnNames
				: Array.from({ length: width }, (_, i) => `column ${i + 1}`),
		rows: rows.slice(0, MAX_ROWS).map((r) => r.map(toCell)),
		truncated: rows.length > MAX_ROWS,
	};
}

// Wrapping a query as a subquery caps the rows SQLite produces, and SQLite
// renames duplicate column names (`id`, `id:1`), which bun:sqlite would
// otherwise collapse. Statements that cannot be wrapped, such as PRAGMA, run
// as written and are truncated after fetching.
async function run(
	db: ReadOnlyDb,
	sql: string,
): Promise<Omit<SqlResult, "durationMs">> {
	const body = sql.trim().replace(/;\s*$/, "");
	if (hasMultipleStatements(body)) {
		throw new Error("Run one statement at a time.");
	}
	let wrapped: QueryOutput;
	try {
		wrapped = await db.query(
			`SELECT * FROM (\n${body}\n) LIMIT ${MAX_ROWS + 1}`,
		);
	} catch {
		return toResult(await db.query(body));
	}
	return toResult(wrapped);
}

export const runSql = createServerFn({ method: "POST" })
	.validator((input: { sql: string }) => {
		if (typeof input?.sql !== "string" || !input.sql.trim()) {
			throw new Error("Query is empty.");
		}
		return input;
	})
	.handler(async ({ data }): Promise<SqlResult> => {
		const db = await readOnlyDb();
		const start = performance.now();
		const result = await run(db, data.sql);
		return { ...result, durationMs: Math.round(performance.now() - start) };
	});

export const getSchema = createServerFn({ method: "GET" }).handler(
	async (): Promise<TableInfo[]> => {
		const db = await readOnlyDb();
		const { rows } = await db.query(
			`SELECT m.name, p.name, p.type
			FROM sqlite_schema m JOIN pragma_table_info(m.name) p
			WHERE m.type IN ('table', 'view')
				AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '__drizzle%'
			ORDER BY m.name, p.cid`,
		);
		const tables = new Map<string, TableInfo>();
		for (const [table, name, type] of rows as [string, string, string][]) {
			const info = tables.get(table) ?? { name: table, columns: [] };
			info.columns.push({ name, type });
			tables.set(table, info);
		}
		return [...tables.values()];
	},
);
