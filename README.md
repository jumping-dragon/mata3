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
- `src/db/`: Drizzle schema and libSQL client. Migrations in `drizzle/` run on first use against the local file; a remote database is migrated at deploy time.
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
- Against a remote Turso database the page needs `TURSO_READONLY_AUTH_TOKEN`, a token created with `--read-only`. It refuses to start without one, or when that token matches the read-write `TURSO_AUTH_TOKEN`, and never falls back to the read-write token.

After changing `src/db/schema.ts`, run `bun run db:generate` to add a migration.

## Deploying to Vercel (preview only)

The app deploys as preview deployments only, behind Vercel's Standard Protection, so only members of your Vercel account can open it. There is no login in the app itself, so no production deployment should ever exist: Standard Protection does not cover the production domain.

What the repo already does:

- `vercel.json` skips any build where `VERCEL_ENV` is `production` (`ignoreCommand`), and builds with `bun run build:vercel`.
- `build:vercel` fails unless `TURSO_DATABASE_URL` is set, runs `drizzle-kit migrate` against it, then builds. Serverless bundles do not include `drizzle/`, so a remote database is only migrated here, never at runtime.
- `vite.config.ts` pins the function to `hnd1` (Tokyo, AWS `ap-northeast-1`), next to the Turso database. Vercel's default is US East, and OKX refuses requests from US IPs.

One-time setup:

1. Create the database in `aws-ap-northeast-1` (Tokyo), next to the function, and two tokens:
   ```sh
   turso db create mata3 --location <location>   # `turso db locations` lists them
   turso db show mata3 --url                     # TURSO_DATABASE_URL
   turso db tokens create mata3                  # TURSO_AUTH_TOKEN (read-write, used by the app)
   turso db tokens create mata3 --read-only      # TURSO_READONLY_AUTH_TOKEN (used by /sql)
   ```
2. In the Vercel project, add the exchange variables and the three `TURSO_*` variables for the **Preview** environment.
3. Check that Deployment Protection is set to Standard Protection with Vercel Authentication, and do not create shareable links or protection bypass tokens.
4. Deploy a non-production branch (or `vercel deploy` without `--prod`) and bookmark the branch URL, `<project>-git-<branch>-<scope>.vercel.app`; it stays the same across pushes.

Every preview shares one database, so a migration on one branch applies to all of them.

## Known limits

- "Stable balance" sums USDC/USDT/USD/USDE only. Spot holdings of other coins on OKX are listed in `balances` but not valued in USD.
- Hyperliquid balance is the perp account only (ccxt default); spot is not fetched.
- Open orders, trade history and funding are not fetched yet.
- Rows are only written when someone loads the dashboard, so the time series has gaps while it is closed. Vercel Cron only runs on production deployments, so it cannot fill them for a preview-only setup.
- Raw responses are stored in full. A few KB per call for a normal account, but it adds up at a 15s refresh; prune `api_calls.response` if the file grows too large.
