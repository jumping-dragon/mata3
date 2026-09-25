import { createServerFn } from "@tanstack/react-start";
import type { Balances, Position as CcxtPosition } from "ccxt";
import { EXCHANGE_IDS, type ExchangeId, getClient } from "./exchanges";

const STABLES = ["USDC", "USDT", "USD", "USDE"];

export type Position = {
	exchange: ExchangeId;
	symbol: string;
	side: "long" | "short";
	size: number;
	notional: number;
	entryPrice: number | null;
	markPrice: number | null;
	unrealizedPnl: number;
	leverage: number | null;
	liquidationPrice: number | null;
};

export type Balance = { asset: string; total: number; free: number };

export type ExchangeSnapshot =
	| {
			id: ExchangeId;
			status: "ok";
			stableBalance: number;
			balances: Balance[];
			positions: Position[];
	  }
	| { id: ExchangeId; status: "not_configured" }
	| { id: ExchangeId; status: "error"; error: string };

export type Portfolio = {
	fetchedAt: number;
	exchanges: ExchangeSnapshot[];
};

function toBalances(raw: Balances): Balance[] {
	const totals = (raw.total ?? {}) as unknown as Record<string, number>;
	const frees = (raw.free ?? {}) as unknown as Record<string, number>;
	return Object.entries(totals)
		.filter(([, total]) => total)
		.map(([asset, total]) => ({ asset, total, free: frees[asset] ?? 0 }));
}

function toPosition(exchange: ExchangeId, p: CcxtPosition): Position {
	return {
		exchange,
		symbol: p.symbol ?? "",
		side: p.side === "short" ? "short" : "long",
		size: p.contracts ?? 0,
		notional: Math.abs(p.notional ?? 0),
		entryPrice: p.entryPrice ?? null,
		// Hyperliquid omits markPrice; notional / contracts gives the same value.
		markPrice:
			p.markPrice ??
			(p.notional && p.contracts ? Math.abs(p.notional / p.contracts) : null),
		unrealizedPnl: p.unrealizedPnl ?? 0,
		leverage: p.leverage ?? null,
		liquidationPrice: p.liquidationPrice ?? null,
	};
}

function toPositions(id: ExchangeId, raw: CcxtPosition[]): Position[] {
	return raw
		.filter((p) => (p.contracts ?? 0) !== 0)
		.map((p) => toPosition(id, p));
}

async function snapshot(id: ExchangeId): Promise<ExchangeSnapshot> {
	const client = getClient(id);
	if (!client) return { id, status: "not_configured" };
	try {
		await client.loadMarkets();
		const [rawBalance, rawPositions] = await Promise.all([
			client.fetchBalance(),
			client.fetchPositions(),
		]);
		const balances = toBalances(rawBalance);
		return {
			id,
			status: "ok",
			balances,
			stableBalance: balances
				.filter((b) => STABLES.includes(b.asset))
				.reduce((sum, b) => sum + b.total, 0),
			positions: toPositions(id, rawPositions),
		};
	} catch (err) {
		return {
			id,
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export const getPortfolio = createServerFn({ method: "GET" }).handler(
	async (): Promise<Portfolio> => ({
		fetchedAt: Date.now(),
		exchanges: await Promise.all(EXCHANGE_IDS.map(snapshot)),
	}),
);
