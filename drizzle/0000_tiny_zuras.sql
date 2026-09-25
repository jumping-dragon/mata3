CREATE TABLE `api_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text NOT NULL,
	`account` text NOT NULL,
	`method` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`fetched_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`response` text
);
--> statement-breakpoint
CREATE INDEX `api_calls_lookup` ON `api_calls` (`exchange`,`account`,`method`,`params`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`call_id` integer NOT NULL,
	`exchange` text NOT NULL,
	`account` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`asset` text NOT NULL,
	`total` real NOT NULL,
	`free` real NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `api_calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_ts` ON `balance_snapshots` (`exchange`,`account`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `position_snapshots` (
	`call_id` integer NOT NULL,
	`exchange` text NOT NULL,
	`account` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`size` real NOT NULL,
	`notional` real NOT NULL,
	`entry_price` real,
	`mark_price` real,
	`unrealized_pnl` real NOT NULL,
	`leverage` real,
	`liquidation_price` real,
	FOREIGN KEY (`call_id`) REFERENCES `api_calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `position_snapshots_ts` ON `position_snapshots` (`exchange`,`account`,`fetched_at`);