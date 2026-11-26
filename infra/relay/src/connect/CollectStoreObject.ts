import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import type * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { CollectRow } from "./CollectPayloads.ts";
import * as CollectStore from "./CollectStore.ts";

type Call<A> = Effect.Effect<A, never, Alchemy.RuntimeContext>;

/** Every collector writes to one object; its name is fixed. */
export const COLLECT_STORE_NAME = "collect";
const DAY_MS = 24 * 60 * 60 * 1000;

export class CollectStoreObject extends Cloudflare.DurableObject<
  CollectStoreObject,
  {
    readonly insert: (
      rows: ReadonlyArray<CollectRow>,
      maxRowsPerDay: number,
    ) => Call<CollectStore.StoreResult>;
    readonly summary: () => Call<ReadonlyArray<CollectStore.SummaryRow>>;
  }
>()("CollectStoreObject") {}

export const layer = CollectStoreObject.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      const layerSql = SqliteClient.layer({ storage: state.raw.storage });
      const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provide(layerSql), Effect.orDie);
      yield* run(CollectStore.migrate);

      // Retention holds without traffic: an alarm prunes daily while rows remain.
      const scheduleDailyPrune = Effect.gen(function* () {
        if ((yield* state.storage.getAlarm()) !== null) return;
        const now = yield* Clock.currentTimeMillis;
        yield* state.storage.setAlarm(now - (now % DAY_MS) + DAY_MS + 5 * 60 * 1000);
      });

      return {
        insert: Effect.fnUntraced(function* (
          rows: ReadonlyArray<CollectRow>,
          maxRowsPerDay: number,
        ) {
          const now = yield* Clock.currentTimeMillis;
          const result = yield* run(CollectStore.insert(rows, now, maxRowsPerDay));
          if (result.stored > 0) yield* scheduleDailyPrune;
          return result;
        }),
        summary: Effect.fnUntraced(function* () {
          return yield* run(CollectStore.summary(yield* Clock.currentTimeMillis));
        }),
        alarm: Effect.fnUntraced(
          function* () {
            const left = yield* run(CollectStore.prune(yield* Clock.currentTimeMillis));
            if (left > 0) yield* scheduleDailyPrune;
          },
          Effect.catchCause((cause) =>
            Effect.logWarning("Collector retention run failed", { cause }),
          ),
        ),
      };
    });
  }),
);
