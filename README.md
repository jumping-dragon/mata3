# mata3

Personal crypto dashboard: balances and open positions across Hyperliquid, OKX and Lighter in one view.

Stack: TanStack Start, TanStack Query, TanStack Table, Tailwind, [ccxt](https://github.com/ccxt/ccxt). All exchange calls run on the server; the browser never sees credentials.

## Setup

```sh
bun install
cp .env.example .env   # fill in what you use; unset exchanges show "Not configured"
bun --bun run dev      # http://localhost:3000
```

| Exchange    | Env vars                                               | Notes                                    |
| ----------- | ------------------------------------------------------ | ---------------------------------------- |
| Hyperliquid | `HYPERLIQUID_WALLET_ADDRESS`                           | Public address only. No private key.     |
| OKX         | `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`  | Create the key with Read permission only |
| Lighter     | `LIGHTER_WALLET_ADDRESS` or `LIGHTER_ACCOUNT_INDEX`    | Public address only. No private key.     |

## Layout

- `src/server/exchanges.ts`: builds one ccxt client per exchange from env.
- `src/server/portfolio.ts`: `getPortfolio` server function. Fetches balance and positions from each exchange in parallel and normalises them. An exchange that fails reports its error without breaking the others.
- `src/routes/index.tsx`: dashboard. Refetches every 15s.

## Known limits

- "Stable balance" sums USDC/USDT/USD/USDE only. Spot holdings of other coins on OKX are listed in `balances` but not valued in USD.
- Hyperliquid balance is the perp account only (ccxt default); spot is not fetched.
- Open orders, trade history and funding are not fetched yet.
