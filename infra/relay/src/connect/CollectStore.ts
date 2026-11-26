import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { type CollectKind, type CollectRow, utcDay } from "./CollectPayloads.ts";

/** Rows older than this many UTC days are deleted. */
export const RETENTION_DAYS = 30;
export const DEFAULT_MAX_ROWS_PER_DAY = 20_000;
/** Durable Object SQL binds at most 100 values per statement; a row binds six. */
const ROWS_PER_STATEMENT = 16;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoreResult {
  readonly stored: number;
  readonly dropped: number;
}

export interface SummaryRow {
  readonly day: string;
  readonly kind: CollectKind;
  readonly event: string;
  readonly appVersion: string;
  readonly events: number;
  readonly installs: number;
}

/** Where the collectors keep rows; a SQLite Durable Object in the Worker, SQLite in tests. */
export class CollectStore extends Context.Service<
  CollectStore,
  {
    readonly insert: (
      rows: ReadonlyArray<CollectRow>,
    ) => Effect.Effect<StoreResult, CollectStoreUnavailable>;
    readonly summary: Effect.Effect<ReadonlyArray<SummaryRow>, CollectStoreUnavailable>;
  }
>()("t3code-relay/connect/CollectStore") {}

export class CollectStoreUnavailable extends Schema.TaggedError<CollectStoreUnavailable>()(
  "CollectStoreUnavailable",
  { cause: Schema.Defect() },
) {}

/** The first day still kept; `day` strings sort as dates. */
export function oldestKeptDay(nowMillis: number): string {
  return utcDay(nowMillis - (RETENTION_DAYS - 1) * DAY_MS);
}

export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS collect_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      event TEXT NOT NULL,
      app_version TEXT NOT NULL,
      install_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_day TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS collect_rows_day ON collect_rows (day, kind, event, app_version)`;
  yield* sql`CREATE INDEX IF NOT EXISTS collect_rows_received ON collect_rows (received_day)`;
});

export const prune = Effect.fn("CollectStore.prune")(function* (nowMillis: number) {
  const sql = yield* SqlClient.SqlClient;
  const cutoff = oldestKeptDay(nowMillis);
  yield* sql`DELETE FROM collect_rows WHERE day < ${cutoff} OR received_day < ${cutoff}`;
  const left = yield* sql<{ readonly rows: number }>`SELECT COUNT(*) AS rows FROM collect_rows`;
  return left[0]?.rows ?? 0;
});

/** Stores rows until the day's cap is reached; the rest are counted, not kept. */
export const insert = Effect.fn("CollectStore.insert")(function* (
  rows: ReadonlyArray<CollectRow>,
  nowMillis: number,
  maxRowsPerDay: number = DEFAULT_MAX_ROWS_PER_DAY,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* prune(nowMillis);
  const today = utcDay(nowMillis);
  const counted = yield* sql<{ readonly rows: number }>`
    SELECT COUNT(*) AS rows FROM collect_rows WHERE received_day = ${today}
  `;
  const room = Math.max(0, maxRowsPerDay - (counted[0]?.rows ?? 0));
  const cutoff = oldestKeptDay(nowMillis);
  const kept = rows.filter((row) => row.day >= cutoff).slice(0, room);
  for (let start = 0; start < kept.length; start += ROWS_PER_STATEMENT) {
    const chunk = kept.slice(start, start + ROWS_PER_STATEMENT).map((row) => ({
      day: row.day,
      kind: row.kind,
      event: row.event,
      app_version: row.appVersion,
      install_id: row.installId,
      payload: row.payload,
      received_day: today,
    }));
    const [first, ...rest] = chunk;
    if (first !== undefined) yield* sql`INSERT INTO collect_rows ${sql.insert([first, ...rest])}`;
  }
  return { stored: kept.length, dropped: rows.length - kept.length } satisfies StoreResult;
});

/** Counts per day, kind, event and app version over the kept days. */
export const summary = Effect.fn("CollectStore.summary")(function* (nowMillis: number) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly day: string;
    readonly kind: CollectKind;
    readonly event: string;
    readonly app_version: string;
    readonly events: number;
    readonly installs: number;
  }>`
    SELECT day, kind, event, app_version, COUNT(*) AS events,
      COUNT(DISTINCT CASE WHEN install_id = '' THEN NULL ELSE install_id END) AS installs
    FROM collect_rows
    WHERE day >= ${oldestKeptDay(nowMillis)}
    GROUP BY day, kind, event, app_version
    ORDER BY day DESC, events DESC, kind, event, app_version
    LIMIT 2000
  `;
  return rows.map((row): SummaryRow => ({
    day: row.day,
    kind: row.kind,
    event: row.event,
    appVersion: row.app_version,
    events: Number(row.events),
    installs: Number(row.installs),
  }));
});
