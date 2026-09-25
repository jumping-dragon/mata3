import { and, desc, eq, gte } from "drizzle-orm";
import { db, dbReady } from "#/db";
import { apiCalls } from "#/db/schema";
import type { Source } from "./exchanges";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Recorded<T> = { data: T; fetchedAt: number; cached: boolean };

// Identifies the recorded call; snapshot rows copy these fields.
export type CallRef = { callId: number; account: string; fetchedAt: number };

type Options<T> = {
	ttlMs: number;
	params?: Record<string, unknown>;
	// Writes normalised rows for this call inside the same transaction as the
	// api_calls row.
	onRecord?: (tx: Tx, ref: CallRef, data: T) => Promise<void>;
};

const inflight = new Map<string, Promise<Recorded<unknown>>>();

// Runs a ccxt call through the api_calls table. A successful row younger than
// ttlMs is served instead of calling the exchange; otherwise the call runs and
// its result (or error) is appended. Concurrent callers for the same key share
// one request.
export function recordedCall<T>(
	source: Source,
	method: string,
	run: () => Promise<T>,
	opts: Options<T>,
): Promise<Recorded<T>> {
	const params = JSON.stringify(opts.params ?? {});
	const key = [source.exchange, source.account, method, params].join("\0");
	const pending = inflight.get(key);
	if (pending) return pending as Promise<Recorded<T>>;

	const promise = execute(source, method, params, run, opts).finally(() =>
		inflight.delete(key),
	);
	inflight.set(key, promise);
	return promise;
}

async function execute<T>(
	{ exchange, account }: Source,
	method: string,
	params: string,
	run: () => Promise<T>,
	opts: Options<T>,
): Promise<Recorded<T>> {
	await dbReady();

	const [hit] = await db
		.select({ response: apiCalls.response, fetchedAt: apiCalls.fetchedAt })
		.from(apiCalls)
		.where(
			and(
				eq(apiCalls.exchange, exchange),
				eq(apiCalls.account, account),
				eq(apiCalls.method, method),
				eq(apiCalls.params, params),
				eq(apiCalls.ok, true),
				gte(apiCalls.fetchedAt, Date.now() - opts.ttlMs),
			),
		)
		.orderBy(desc(apiCalls.fetchedAt))
		.limit(1);
	if (hit?.response) {
		return {
			data: JSON.parse(hit.response),
			fetchedAt: hit.fetchedAt,
			cached: true,
		};
	}

	const startedAt = Date.now();
	let data: T;
	try {
		data = await run();
	} catch (err) {
		const fetchedAt = Date.now();
		await db.insert(apiCalls).values({
			exchange,
			account,
			method,
			params,
			fetchedAt,
			durationMs: fetchedAt - startedAt,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}

	// Stamp with the response time: that is when the data was current, and it
	// keeps a slow call from landing in the table already older than the TTL.
	const fetchedAt = Date.now();
	await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(apiCalls)
			.values({
				exchange,
				account,
				method,
				params,
				fetchedAt,
				durationMs: fetchedAt - startedAt,
				ok: true,
				response: JSON.stringify(data),
			})
			.returning({ id: apiCalls.id });
		await opts.onRecord?.(tx, { callId: row.id, account, fetchedAt }, data);
	});
	return { data, fetchedAt, cached: false };
}
