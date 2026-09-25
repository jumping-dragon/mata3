import ccxt, { type Exchange } from "ccxt";

export const EXCHANGE_IDS = ["hyperliquid", "okx", "lighter"] as const;
export type ExchangeId = (typeof EXCHANGE_IDS)[number];

// ccxt's default leaky-bucket limiter spreads each exchange's per-minute budget
// evenly, so it sleeps between calls even when far under the limit: 1s before
// every Hyperliquid /info call (13s for a cold loadMarkets) and 2s per Lighter
// refresh. Both exchanges enforce per-minute budgets, so a rolling window over
// the same budget stays within their limits while letting a burst through.
const PER_MINUTE_BUDGET = {
	rateLimiterAlgorithm: "rollingWindow",
	rollingWindowSize: 60_000,
};

// Read-only credentials only. Hyperliquid and Lighter expose balances and
// positions by wallet address, so no private key is needed for a dashboard.
// OKX needs an API key; create it with "Read" permission only.
function buildClient(id: ExchangeId): Exchange | null {
	const env = process.env;
	switch (id) {
		case "hyperliquid": {
			const address = env.HYPERLIQUID_WALLET_ADDRESS;
			if (!address) return null;
			return new ccxt.hyperliquid({
				...PER_MINUTE_BUDGET,
				walletAddress: address,
			});
		}
		case "okx": {
			if (!env.OKX_API_KEY || !env.OKX_API_SECRET || !env.OKX_API_PASSPHRASE)
				return null;
			return new ccxt.okx({
				apiKey: env.OKX_API_KEY,
				secret: env.OKX_API_SECRET,
				password: env.OKX_API_PASSPHRASE,
			});
		}
		case "lighter": {
			const address = env.LIGHTER_WALLET_ADDRESS;
			const index = env.LIGHTER_ACCOUNT_INDEX;
			if (!address && !index) return null;
			return new ccxt.lighter({
				...PER_MINUTE_BUDGET,
				walletAddress: address,
				options: index ? { accountIndex: Number(index) } : {},
			});
		}
	}
}

// Clients cache loaded markets, so keep one per exchange for the process.
const clients = new Map<ExchangeId, Exchange | null>();

export function getClient(id: ExchangeId): Exchange | null {
	if (!clients.has(id)) clients.set(id, buildClient(id));
	return clients.get(id) ?? null;
}
