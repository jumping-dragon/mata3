import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
	formatSql,
	SqlEditor,
	type SqlEditorHandle,
} from "#/components/sql-editor";
import { type Cell, getSchema, runSql } from "#/server/sql";

type Search = { q?: string };

const EXAMPLES: { label: string; sql: string }[] = [
	{
		label: "Latest calls",
		sql: "SELECT id, exchange, account, method, datetime(fetched_at / 1000, 'unixepoch') AS at, duration_ms, ok, error\nFROM api_calls\nORDER BY id DESC\nLIMIT 50",
	},
	{
		label: "uPnL over time",
		sql: "SELECT exchange, datetime(fetched_at / 1000, 'unixepoch') AS at, round(sum(unrealized_pnl), 2) AS upnl, count(*) AS positions\nFROM position_snapshots\nGROUP BY exchange, fetched_at\nORDER BY fetched_at DESC",
	},
	{
		label: "Call latency",
		sql: "SELECT exchange, method, count(*) AS calls, round(avg(duration_ms)) AS avg_ms, max(duration_ms) AS max_ms, sum(NOT ok) AS errors\nFROM api_calls\nGROUP BY exchange, method",
	},
	{
		label: "Raw JSON field",
		sql: "SELECT exchange, datetime(fetched_at / 1000, 'unixepoch') AS at, json_extract(response, '$.total.USDC') AS usdc_total\nFROM api_calls\nWHERE method = 'fetchBalance' AND ok\nORDER BY id DESC\nLIMIT 50",
	},
];

const schemaQuery = queryOptions({
	queryKey: ["sql", "schema"],
	queryFn: () => getSchema(),
});

export const Route = createFileRoute("/sql")({
	validateSearch: (search: Record<string, unknown>): Search =>
		typeof search.q === "string" && search.q.trim() ? { q: search.q } : {},
	component: SqlPage,
});

function SqlPage() {
	const { q } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [draft, setDraft] = useState(q ?? formatSql(EXAMPLES[0].sql));
	const [formatError, setFormatError] = useState<string | null>(null);
	const editor = useRef<SqlEditorHandle>(null);
	// Back/forward through ?q= history loads that query into the editor.
	useEffect(() => {
		if (q !== undefined) editor.current?.setDoc(q);
	}, [q]);

	const schema = useQuery(schemaQuery);
	const result = useQuery({
		queryKey: ["sql", "run", q],
		queryFn: () => runSql({ data: { sql: q ?? "" } }),
		enabled: q !== undefined,
		retry: false,
		refetchOnWindowFocus: false,
	});

	const submit = (sql: string) => {
		if (sql === q) void result.refetch();
		else navigate({ search: { q: sql } });
	};

	const edit = (sql: string) => {
		setDraft(sql);
		setFormatError(null);
	};

	return (
		<main className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-8 lg:grid-cols-[14rem_1fr]">
			<aside className="space-y-3 text-sm">
				<h2 className="text-xs font-medium text-muted-foreground">Tables</h2>
				{schema.data?.map((t) => (
					<details key={t.name} className="rounded-md border bg-card">
						<summary className="cursor-pointer px-3 py-1.5 font-mono">
							{t.name}
						</summary>
						<ul className="space-y-0.5 px-3 pb-2 font-mono text-xs text-muted-foreground">
							{t.columns.map((c) => (
								<li key={c.name}>
									{c.name} <span className="opacity-60">{c.type}</span>
								</li>
							))}
						</ul>
					</details>
				))}
				{schema.error && <p className="text-loss">{schema.error.message}</p>}
			</aside>

			<section className="min-w-0 space-y-3">
				<div className="flex flex-wrap gap-2">
					{EXAMPLES.map((ex) => (
						<button
							key={ex.label}
							type="button"
							onClick={() => editor.current?.setDoc(formatSql(ex.sql))}
							className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
						>
							{ex.label}
						</button>
					))}
				</div>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						submit(draft);
					}}
					className="space-y-2"
				>
					<SqlEditor
						value={draft}
						onChange={edit}
						onRun={submit}
						onFormatResult={setFormatError}
						ref={editor}
						schema={schema.data}
					/>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							Read-only connection · ⌘/Ctrl+Enter to run · ⌘/Ctrl+Shift+F to
							format
						</span>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => editor.current?.format()}
								className="rounded-md border px-3 py-1.5 font-medium hover:text-foreground"
							>
								Format
							</button>
							<button
								type="submit"
								className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background"
							>
								{result.isFetching ? "Running…" : "Run"}
							</button>
						</div>
					</div>
					{formatError && <p className="text-xs text-loss">{formatError}</p>}
				</form>

				{result.error && (
					<pre className="whitespace-pre-wrap rounded-lg border bg-card p-3 text-sm text-loss">
						{result.error.message}
					</pre>
				)}
				{result.data && !result.error && (
					<div className="space-y-1">
						<div className="text-xs text-muted-foreground">
							{result.data.rows.length} rows
							{result.data.truncated && " (truncated at 1000)"} ·{" "}
							{result.data.durationMs} ms
						</div>
						<ResultTable
							columns={result.data.columns}
							rows={result.data.rows}
						/>
					</div>
				)}
			</section>
		</main>
	);
}

function ResultTable({ columns, rows }: { columns: string[]; rows: Cell[][] }) {
	if (columns.length === 0) {
		return (
			<div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
				No rows.
			</div>
		);
	}
	return (
		<div className="max-h-[60vh] overflow-auto rounded-lg border bg-card">
			<table className="w-full font-mono text-xs">
				<thead className="sticky top-0 bg-card text-left text-muted-foreground">
					<tr className="border-b">
						{columns.map((c) => (
							<th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
								{c}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, r) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: result rows have no id; the whole table re-renders per query
						<tr key={r} className="border-b last:border-0">
							{row.map((cell, c) => (
								<td
									key={columns[c]}
									className="max-w-md truncate px-3 py-1.5"
									title={cellTitle(cell)}
								>
									{cell === null ? (
										<span className="text-muted-foreground">NULL</span>
									) : (
										String(cell)
									)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

// Full value on hover, capped so large JSON responses do not bloat the DOM.
function cellTitle(cell: Cell) {
	if (cell === null) return undefined;
	const s = String(cell);
	return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}
