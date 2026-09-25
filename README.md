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

- `src/server/exchanges.ts`: builds one ccxt client per exchange from env, plus the account label that recorded rows carry.
- `src/server/recorder.ts`: `recordedCall` wraps every ccxt call. It serves the newest successful row younger than `CACHE_TTL_SEC`, otherwise calls the exchange and appends the result (or error) to the database. Concurrent callers share one request.
- `src/server/portfolio.ts`: `getPortfolio` server function. Fetches balance and positions from each exchange in parallel and normalises them. An exchange that fails reports its error without breaking the others.
- `src/db/`: Drizzle schema and libSQL client. Migrations in `drizzle/` run on first use.
- `src/routes/index.tsx`: dashboard. Refetches every 15s.

## Recorded data

Every ccxt call lands in the database, which doubles as a cache and a time series. Local default is `data/mata3.db` (WAL mode). Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to use hosted Turso.

| Table                | One row per                  | Holds                                                     |
| -------------------- | ---------------------------- | --------------------------------------------------------- |
| `api_calls`          | ccxt call                    | exchange, account, method, timing, error, full JSON result |
| `balance_snapshots`  | asset per `fetchBalance`     | total, free                                               |
| `position_snapshots` | position per `fetchPositions`| size, notional, entry, mark, liq., uPnL, leverage         |

`fetched_at` is Unix epoch milliseconds at response time. `api_calls.response` keeps the unified ccxt result including each exchange's raw payload under `info`, so fields the snapshot tables drop are still there.

Query from DuckDB while the app runs:

```sql
INSTALL sqlite; LOAD sqlite;
ATTACH 'data/mata3.db' AS m (TYPE sqlite, READ_ONLY);

SELECT exchange, to_timestamp(fetched_at / 1000) AS ts, sum(unrealized_pnl) AS upnl
FROM m.position_snapshots
GROUP BY ALL
ORDER BY ts;
```

### SQL page

`/sql` runs ad-hoc queries against the local database file, with a table/column list and example queries. The query sits in the URL (`?q=`), so back/forward and links work.

The editor (`src/components/sql-editor.tsx`) is CodeMirror with SQLite highlighting and autocomplete for table and column names. ⌘/Ctrl+Enter runs, ⌘/Ctrl+Shift+F (or the Format button) formats with `sql-formatter`, and one undo reverts a format.

- Read-only is enforced by SQLite: the page opens its own connection with `SQLITE_OPEN_READONLY` (`bun:sqlite` under bun, `node:sqlite` under node). Writes, schema changes and `ATTACH` of new files fail with SQLite's own error; there is no keyword filter to get around.
- One statement per run. Results stop at 1000 rows.
- Queries run synchronously on the server, so a very heavy query blocks the app until it finishes.
- Local file only. With `TURSO_DATABASE_URL` set, the page reports that it cannot read a remote database.

After changing `src/db/schema.ts`, run `bun run db:generate` to add a migration.

## Known limits

- "Stable balance" sums USDC/USDT/USD/USDE only. Spot holdings of other coins on OKX are listed in `balances` but not valued in USD.
- Hyperliquid balance is the perp account only (ccxt default); spot is not fetched.
- Open orders, trade history and funding are not fetched yet.
- Rows are only written when someone loads the dashboard, so the time series has gaps while it is closed.
- Raw responses are stored in full. A few KB per call for a normal account, but it adds up at a 15s refresh; prune `api_calls.response` if the file grows too large.
