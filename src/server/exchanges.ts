import ccxt, { type Exchange } from "ccxt";

export const EXCHANGE_IDS = ["hyperliquid", "okx", "lighter"] as const;
export type ExchangeId = (typeof EXCHANGE_IDS)[number];

// `account` tells recorded rows apart when credentials change. It must never
// contain a secret: it is stored in plain text in api_calls.
export type Source = {
	exchange: ExchangeId;
	account: string;
	client: Exchange;
};

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
function buildSource(id: ExchangeId): Source | null {
	const env = process.env;
	switch (id) {
		case "hyperliquid": {
			const address = env.HYPERLIQUID_WALLET_ADDRESS;
			if (!address) return null;
			return {
				exchange: id,
				account: address.toLowerCase(),
				client: new ccxt.hyperliquid({
					...PER_MINUTE_BUDGET,
					walletAddress: address,
				}),
			};
		}
		case "okx": {
			if (!env.OKX_API_KEY || !env.OKX_API_SECRET || !env.OKX_API_PASSPHRASE)
				return null;
			return {
				exchange: id,
				// The API key alone cannot sign requests; a prefix is enough to
				// distinguish keys.
				account: `key:${env.OKX_API_KEY.slice(0, 8)}`,
				client: new ccxt.okx({
					apiKey: env.OKX_API_KEY,
					secret: env.OKX_API_SECRET,
					password: env.OKX_API_PASSPHRASE,
				}),
			};
		}
		case "lighter": {
			const address = env.LIGHTER_WALLET_ADDRESS;
			const index = env.LIGHTER_ACCOUNT_INDEX;
			if (!address && !index) return null;
			return {
				exchange: id,
				account: index ? `index:${index}` : (address ?? "").toLowerCase(),
				client: new ccxt.lighter({
					...PER_MINUTE_BUDGET,
					walletAddress: address,
					options: index ? { accountIndex: Number(index) } : {},
				}),
			};
		}
	}
}

// Clients cache loaded markets, so keep one per exchange for the process.
const sources = new Map<ExchangeId, Source | null>();

export function getSource(id: ExchangeId): Source | null {
	if (!sources.has(id)) sources.set(id, buildSource(id));
	return sources.get(id) ?? null;
}
