import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { cn } from "#/lib/utils";
import {
	type ExchangeSnapshot,
	getPortfolio,
	type Position,
} from "#/server/portfolio";

const portfolioQuery = queryOptions({
	queryKey: ["portfolio"],
	queryFn: () => getPortfolio(),
	refetchInterval: 15_000,
});

export const Route = createFileRoute("/")({
	loader: ({ context }) =>
		context.queryClient.query({ ...portfolioQuery, staleTime: "static" }),
	component: Dashboard,
});

const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

function Dashboard() {
	const { data, isFetching } = useSuspenseQuery(portfolioQuery);
	const ok = data.exchanges.filter((e) => e.status === "ok");
	const positions = ok.flatMap((e) => e.positions);
	const totalBalance = ok.reduce((s, e) => s + e.stableBalance, 0);
	const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
	const totalNotional = positions.reduce((s, p) => s + p.notional, 0);

	return (
		<main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
			<header className="flex items-baseline justify-between">
				<h1 className="text-xl font-semibold">Portfolio</h1>
				<span className="text-xs text-muted-foreground">
					{isFetching
						? "Refreshing…"
						: `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}`}
				</span>
			</header>

			<section className="grid gap-3 sm:grid-cols-3">
				<Stat label="Stable balance" value={usd.format(totalBalance)} />
				<Stat
					label="Unrealized PnL"
					value={usd.format(totalPnl)}
					tone={totalPnl >= 0 ? "profit" : "loss"}
				/>
				<Stat label="Open notional" value={usd.format(totalNotional)} />
			</section>

			<section className="grid gap-3 sm:grid-cols-3">
				{data.exchanges.map((e) => (
					<ExchangeCard key={e.id} snapshot={e} />
				))}
			</section>

			<section className="space-y-2">
				<h2 className="text-sm font-medium text-muted-foreground">
					Positions ({positions.length})
				</h2>
				<PositionsTable positions={positions} />
			</section>
		</main>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "profit" | "loss";
}) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div
				className={cn(
					"mt-1 text-2xl font-semibold",
					tone === "profit" && "text-profit",
					tone === "loss" && "text-loss",
				)}
			>
				{value}
			</div>
		</div>
	);
}

function ExchangeCard({ snapshot }: { snapshot: ExchangeSnapshot }) {
	return (
		<div className="rounded-lg border bg-card p-4 text-sm">
			<div className="font-medium capitalize">{snapshot.id}</div>
			{snapshot.status === "ok" && (
				<div className="mt-1 text-muted-foreground">
					{usd.format(snapshot.stableBalance)} · {snapshot.positions.length}{" "}
					positions
					<div className="text-xs">
						{snapshot.cached ? "Cached" : "Live"} ·{" "}
						{new Date(snapshot.fetchedAt).toLocaleTimeString()}
					</div>
				</div>
			)}
			{snapshot.status === "not_configured" && (
				<div className="mt-1 text-muted-foreground">
					Not configured. Add credentials to <code>.env</code>.
				</div>
			)}
			{snapshot.status === "error" && (
				<div className="mt-1 break-words text-loss">{snapshot.error}</div>
			)}
		</div>
	);
}

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
});
const col = createColumnHelper<typeof features, Position>();

function signed(v: number) {
	return (
		<span className={v >= 0 ? "text-profit" : "text-loss"}>
			{usd.format(v)}
		</span>
	);
}

const columns = col.columns([
	col.accessor("exchange", { header: "Exchange" }),
	col.accessor("symbol", { header: "Symbol" }),
	col.accessor("side", {
		header: "Side",
		cell: ({ getValue }) => (
			<span className={getValue() === "long" ? "text-profit" : "text-loss"}>
				{getValue()}
			</span>
		),
	}),
	col.accessor("size", {
		header: "Size",
		cell: ({ getValue }) => num.format(getValue()),
	}),
	col.accessor("notional", {
		header: "Notional",
		cell: ({ getValue }) => usd.format(getValue()),
	}),
	col.accessor("entryPrice", {
		header: "Entry",
		cell: ({ getValue }) => fmtPrice(getValue()),
	}),
	col.accessor("markPrice", {
		header: "Mark",
		cell: ({ getValue }) => fmtPrice(getValue()),
	}),
	col.accessor("liquidationPrice", {
		header: "Liq.",
		cell: ({ getValue }) => fmtPrice(getValue()),
	}),
	col.accessor("unrealizedPnl", {
		header: "uPnL",
		cell: ({ getValue }) => signed(getValue()),
	}),
]);

function fmtPrice(v: number | null) {
	return v == null ? "—" : num.format(v);
}

function PositionsTable({ positions }: { positions: Position[] }) {
	const table = useTable({
		features,
		columns,
		data: positions,
		initialState: { sorting: [{ id: "notional", desc: true }] },
	});

	if (positions.length === 0) {
		return (
			<div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
				No open positions.
			</div>
		);
	}

	return (
		<div className="overflow-x-auto rounded-lg border bg-card">
			<table className="w-full text-sm">
				<thead className="text-left text-xs text-muted-foreground">
					{table.getHeaderGroups().map((hg) => (
						<tr key={hg.id} className="border-b">
							{hg.headers.map((h) => (
								<th
									key={h.id}
									className="cursor-pointer select-none px-3 py-2 font-medium whitespace-nowrap"
									onClick={h.column.getToggleSortingHandler()}
								>
									<table.FlexRender header={h} />
									{{ asc: " ↑", desc: " ↓" }[
										h.column.getIsSorted() as string
									] ?? ""}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody>
					{table.getRowModel().rows.map((row) => (
						<tr key={row.id} className="border-b last:border-0">
							{row.getAllCells().map((cell) => (
								<td key={cell.id} className="px-3 py-2 whitespace-nowrap">
									<table.FlexRender cell={cell} />
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
