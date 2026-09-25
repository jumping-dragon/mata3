import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

// One row per ccxt method call. `response` holds the full unified ccxt result,
// including each exchange's raw payload under `info`, so later analysis can
// read fields the normalised tables below do not keep.
export const apiCalls = sqliteTable(
	"api_calls",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		exchange: text("exchange").notNull(),
		// Wallet address, account index or key prefix. Never a secret.
		account: text("account").notNull(),
		method: text("method").notNull(),
		params: text("params").notNull().default("{}"),
		// Unix epoch milliseconds.
		fetchedAt: integer("fetched_at").notNull(),
		durationMs: integer("duration_ms").notNull(),
		ok: integer("ok", { mode: "boolean" }).notNull(),
		error: text("error"),
		response: text("response"),
	},
	(t) => [
		index("api_calls_lookup").on(
			t.exchange,
			t.account,
			t.method,
			t.params,
			t.fetchedAt,
		),
	],
);

export const balanceSnapshots = sqliteTable(
	"balance_snapshots",
	{
		callId: integer("call_id")
			.notNull()
			.references(() => apiCalls.id),
		exchange: text("exchange").notNull(),
		account: text("account").notNull(),
		fetchedAt: integer("fetched_at").notNull(),
		asset: text("asset").notNull(),
		total: real("total").notNull(),
		free: real("free").notNull(),
	},
	(t) => [index("balance_snapshots_ts").on(t.exchange, t.account, t.fetchedAt)],
);

export const positionSnapshots = sqliteTable(
	"position_snapshots",
	{
		callId: integer("call_id")
			.notNull()
			.references(() => apiCalls.id),
		exchange: text("exchange").notNull(),
		account: text("account").notNull(),
		fetchedAt: integer("fetched_at").notNull(),
		symbol: text("symbol").notNull(),
		side: text("side").notNull(),
		size: real("size").notNull(),
		notional: real("notional").notNull(),
		entryPrice: real("entry_price"),
		markPrice: real("mark_price"),
		unrealizedPnl: real("unrealized_pnl").notNull(),
		leverage: real("leverage"),
		liquidationPrice: real("liquidation_price"),
	},
	(t) => [
		index("position_snapshots_ts").on(t.exchange, t.account, t.fetchedAt),
	],
);
