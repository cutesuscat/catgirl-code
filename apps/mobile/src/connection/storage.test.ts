import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import { CONNECTION_CATALOG_KEY, LEGACY_CONNECTIONS_KEY, make } from "./catalog-store";
import * as MobileSecureStorage from "../persistence/mobile-secure-storage";

function makeStorage(initial: Readonly<Record<string, string>>) {
  const values = new Map(Object.entries(initial));
  const deleted: Array<string> = [];
  const storage = MobileSecureStorage.MobileSecureStorage.of({
    getItem: (key) => Effect.sync(() => values.get(key) ?? null),
    setItem: (key, value) =>
      Effect.sync(() => {
        values.set(key, value);
      }),
    removeItem: (key) =>
      Effect.sync(() => {
        deleted.push(key);
        values.delete(key);
      }),
  });
  return { deleted, storage, values };
}

describe("mobile connection catalog storage", () => {
  it.effect("recovers from a corrupt current catalog", () =>
    Effect.gen(function* () {
      const memory = makeStorage({
        [CONNECTION_CATALOG_KEY]: "{not-json",
      });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, memory.storage),
      );

      expect((yield* catalog.read).targets).toEqual([]);
      expect(memory.deleted).toEqual([CONNECTION_CATALOG_KEY]);
    }),
  );

  it.effect("replaces and removes a corrupt legacy catalog", () =>
    Effect.gen(function* () {
      const memory = makeStorage({
        [LEGACY_CONNECTIONS_KEY]: JSON.stringify({ connections: [{ invalid: true }] }),
      });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, memory.storage),
      );

      expect((yield* catalog.read).targets).toEqual([]);
      expect(memory.deleted).toEqual([LEGACY_CONNECTIONS_KEY]);
      expect(memory.values.has(CONNECTION_CATALOG_KEY)).toBe(true);
    }),
  );

  it.effect("falls back to valid legacy data when the current catalog is corrupt", () =>
    Effect.gen(function* () {
      const memory = makeStorage({
        [CONNECTION_CATALOG_KEY]: "{not-json",
        [LEGACY_CONNECTIONS_KEY]: JSON.stringify({
          connections: [
            {
              environmentId: "legacy-environment",
              environmentLabel: "Legacy",
              pairingUrl: "https://legacy.example.test/pair",
              displayUrl: "https://legacy.example.test",
              httpBaseUrl: "https://legacy.example.test",
              wsBaseUrl: "wss://legacy.example.test",
              bearerToken: "legacy-token",
              authenticationMethod: "bearer",
            },
          ],
        }),
      });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, memory.storage),
      );

      expect((yield* catalog.read).targets).toHaveLength(1);
      expect(memory.deleted).toEqual([CONNECTION_CATALOG_KEY, LEGACY_CONNECTIONS_KEY]);

      yield* catalog.update((document) => document);
      expect(memory.values.has(CONNECTION_CATALOG_KEY)).toBe(true);
      expect(memory.values.has(LEGACY_CONNECTIONS_KEY)).toBe(false);
    }),
  );

  it.effect("reads while another save is still writing to secure storage", () =>
    Effect.gen(function* () {
      const memory = makeStorage({});
      const writing = yield* Deferred.make<void>();
      const finishWrite = yield* Deferred.make<void>();
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, {
          ...memory.storage,
          setItem: (key, value) =>
            Deferred.succeed(writing, undefined).pipe(
              Effect.andThen(Deferred.await(finishWrite)),
              Effect.andThen(memory.storage.setItem(key, value)),
            ),
        }),
      );
      expect((yield* catalog.read).profiles).toEqual([]);

      const save = yield* catalog
        .update((document) => ({ ...document, githubRoutingPermissions: [] }))
        .pipe(Effect.forkChild);
      yield* Deferred.await(writing);
      // The save holds the lock; a read answers from the loaded document all the same.
      expect((yield* catalog.read.pipe(Effect.timeout("1 second"))).profiles).toEqual([]);
      yield* Deferred.succeed(finishWrite, undefined);
      yield* Fiber.join(save);
    }),
  );

  it.effect("skips the secure-storage write when a save changes nothing", () =>
    Effect.gen(function* () {
      const memory = makeStorage({});
      let writes = 0;
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, {
          ...memory.storage,
          setItem: (key, value) =>
            Effect.sync(() => {
              writes += 1;
            }).pipe(Effect.andThen(memory.storage.setItem(key, value))),
        }),
      );
      yield* catalog.update((document) => ({ ...document }));
      expect(writes).toBe(1);
      yield* catalog.update((document) => ({ ...document, profiles: [...document.profiles] }));
      expect(writes).toBe(1);

      // A catalog read back from storage is known too, so its first unchanged save is skipped.
      const reopened = yield* make().pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, {
          ...memory.storage,
          setItem: (key, value) =>
            Effect.sync(() => {
              writes += 1;
            }).pipe(Effect.andThen(memory.storage.setItem(key, value))),
        }),
      );
      yield* reopened.update((document) => ({ ...document }));
      expect(writes).toBe(1);
      yield* reopened.update((document) => ({ ...document, githubRoutingPermissions: [] }));
      expect(writes).toBe(2);
    }),
  );
});
