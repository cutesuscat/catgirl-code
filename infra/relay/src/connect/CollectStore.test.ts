import { describe, expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import type { CollectRow } from "./CollectPayloads.ts";
import * as CollectStore from "./CollectStore.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-26T12:00:00Z");

const row = (overrides: Partial<CollectRow> = {}): CollectRow => ({
  day: "2026-11-26",
  kind: "analytics",
  event: "server.boot.heartbeat",
  appVersion: "1.12.3",
  installId: "install-a",
  payload: "{}",
  ...overrides,
});

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  CollectStore.migrate.pipe(
    Effect.andThen(effect),
    Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
  );

describe("CollectStore", () => {
  it.effect("counts records and distinct installs per day, kind, event and app version", () =>
    withStore(
      Effect.gen(function* () {
        yield* CollectStore.insert(
          [
            row(),
            row({ installId: "install-b" }),
            row({ installId: "install-b" }),
            row({ appVersion: "1.12.2" }),
            row({ kind: "logs", event: "jsError", installId: "" }),
            row({ day: "2026-11-25" }),
          ],
          NOW,
        );
        expect(yield* CollectStore.summary(NOW)).toEqual([
          {
            day: "2026-11-26",
            kind: "analytics",
            event: "server.boot.heartbeat",
            appVersion: "1.12.3",
            events: 3,
            installs: 2,
          },
          {
            day: "2026-11-26",
            kind: "analytics",
            event: "server.boot.heartbeat",
            appVersion: "1.12.2",
            events: 1,
            installs: 1,
          },
          {
            day: "2026-11-26",
            kind: "logs",
            event: "jsError",
            appVersion: "1.12.3",
            events: 1,
            installs: 0,
          },
          {
            day: "2026-11-25",
            kind: "analytics",
            event: "server.boot.heartbeat",
            appVersion: "1.12.3",
            events: 1,
            installs: 1,
          },
        ]);
      }),
    ),
  );

  it.effect("stops storing at the day's cap and starts again the next day", () =>
    withStore(
      Effect.gen(function* () {
        const many = Array.from({ length: 40 }, () => row());
        expect(yield* CollectStore.insert(many, NOW, 25)).toEqual({ stored: 25, dropped: 15 });
        expect(yield* CollectStore.insert([row()], NOW, 25)).toEqual({ stored: 0, dropped: 1 });
        expect(yield* CollectStore.insert([row({ day: "2026-11-27" })], NOW + DAY, 25)).toEqual({
          stored: 1,
          dropped: 0,
        });
      }),
    ),
  );

  it.effect("keeps 30 days and deletes everything older", () =>
    withStore(
      Effect.gen(function* () {
        yield* CollectStore.insert([row({ day: "2026-10-28" }), row({ day: "2026-10-27" })], NOW);
        // Rows received a while ago go when their arrival day leaves the window.
        yield* CollectStore.insert([row({ day: "2026-11-01" })], NOW - 26 * DAY);
        const sql = yield* SqlClient.SqlClient;
        const before = yield* sql<{
          readonly day: string;
        }>`SELECT day FROM collect_rows ORDER BY day`;
        expect(before.map((entry) => entry.day)).toEqual(["2026-10-28", "2026-11-01"]);
        expect(CollectStore.oldestKeptDay(NOW)).toBe("2026-10-28");
        expect(yield* CollectStore.prune(NOW + 5 * DAY)).toBe(0);
        const after = yield* sql<{ readonly day: string }>`SELECT day FROM collect_rows`;
        expect(after).toEqual([]);
      }),
    ),
  );
});
