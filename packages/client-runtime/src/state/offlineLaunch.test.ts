import {
  EnvironmentId,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadDetailSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import * as ClientCapabilities from "../platform/capabilities.ts";
import * as Connectivity from "../connection/connectivity.ts";
import * as ConnectionCredentialStore from "../connection/credentialStore.ts";
import * as ConnectionDriver from "../connection/driver.ts";
import { ConnectionTransientError, PrimaryConnectionTarget } from "../connection/model.ts";
import * as ConnectionProfileStore from "../connection/profileStore.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import * as Persistence from "../platform/persistence.ts";
import { createEnvironmentCatalogAtoms } from "./connections.ts";
import { v2Projection, v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import {
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createSteadyShellAtoms,
} from "./shell.ts";
import * as ShellSnapshotLoader from "./shellSnapshotHttp.ts";
import { createEnvironmentThreadStateAtoms } from "./threads.ts";
import * as ThreadSnapshotLoader from "./threadSnapshotHttp.ts";

// One machine whose connect never answers (a slow or dead route) and one that is offline.
const SILENT = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("silent-machine"),
  label: "Silent",
  httpBaseUrl: "https://silent.example.test",
  wsBaseUrl: "wss://silent.example.test",
});
const OFFLINE = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("offline-machine"),
  label: "Offline",
  httpBaseUrl: "https://offline.example.test",
  wsBaseUrl: "wss://offline.example.test",
});

const shell = (title: string): OrchestrationV2ShellSnapshot => ({
  ...v2ShellSnapshot,
  snapshotSequence: 4,
  threads: [{ ...v2ThreadShell, title }],
});
const CACHED_SHELLS = new Map([
  [SILENT.environmentId, shell("Silent machine's chat")],
  [OFFLINE.environmentId, shell("Offline machine's chat")],
]);
const CACHED_THREAD: OrchestrationV2ThreadDetailSnapshot = {
  snapshotSequence: 4,
  projection: { ...v2Projection, thread: { ...v2Projection.thread, title: "Silent chat" } },
};

const layerCache = Layer.succeed(
  Persistence.EnvironmentCacheStore,
  Persistence.EnvironmentCacheStore.of({
    loadShell: (environmentId) =>
      Effect.succeed(Option.fromUndefinedOr(CACHED_SHELLS.get(environmentId))),
    saveShell: () => Effect.void,
    loadThread: (environmentId, threadId) =>
      Effect.succeed(
        environmentId === SILENT.environmentId && threadId === v2ThreadShell.id
          ? Option.some(CACHED_THREAD)
          : Option.none(),
      ),
    saveThread: () => Effect.void,
    removeThread: () => Effect.void,
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  }),
);

const layer = EnvironmentRegistry.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(
        Persistence.ConnectionTargetStore,
        Persistence.ConnectionTargetStore.of({
          list: Effect.succeed([SILENT, OFFLINE]),
          listDisabled: Effect.succeed([]),
        }),
      ),
      Layer.succeed(
        Persistence.ConnectionRegistrationStore,
        Persistence.ConnectionRegistrationStore.of({
          register: () => Effect.void,
          setRoutes: () => Effect.void,
          remove: () => Effect.void,
          setEnabled: () => Effect.void,
        }),
      ),
      Layer.succeed(
        ConnectionProfileStore.ConnectionProfileStore,
        ConnectionProfileStore.ConnectionProfileStore.of({
          get: () => Effect.succeedNone,
          put: () => Effect.void,
          remove: () => Effect.void,
        }),
      ),
      Layer.succeed(
        ConnectionCredentialStore.ConnectionCredentialStore,
        ConnectionCredentialStore.ConnectionCredentialStore.of({
          get: () => Effect.succeedNone,
          put: () => Effect.void,
          remove: () => Effect.void,
        }),
      ),
      Layer.succeed(
        ClientCapabilities.SshEnvironmentGateway,
        ClientCapabilities.SshEnvironmentGateway.of({
          provision: () => Effect.die("unused"),
          prepare: () => Effect.die("unused"),
          disconnect: () => Effect.void,
        }),
      ),
      Layer.succeed(
        Connectivity.Connectivity,
        Connectivity.Connectivity.of({ status: Effect.succeed("online"), changes: Stream.never }),
      ),
      Layer.succeed(
        ConnectionWakeups.ConnectionWakeups,
        ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.never }),
      ),
      Layer.succeed(
        ConnectionDriver.ConnectionDriver,
        ConnectionDriver.ConnectionDriver.of({
          connect: (entry, reportProgress) =>
            reportProgress({ stage: "preparing" }).pipe(
              Effect.andThen(
                entry.target.environmentId === SILENT.environmentId
                  ? Effect.never
                  : Effect.fail(
                      new ConnectionTransientError({ reason: "network", detail: "Unreachable." }),
                    ),
              ),
            ),
          preflight: () => Effect.never,
          checkHost: () => Effect.never,
        }),
      ),
    ),
  ),
  Layer.provideMerge(layerCache),
);

const runtime = Atom.runtime(
  Layer.mergeAll(
    layer,
    Layer.succeed(
      ShellSnapshotLoader.ShellSnapshotLoader,
      ShellSnapshotLoader.ShellSnapshotLoader.of({ load: () => Effect.succeedNone }),
    ),
    Layer.succeed(
      ThreadSnapshotLoader.ThreadSnapshotLoader,
      ThreadSnapshotLoader.ThreadSnapshotLoader.of({
        load: () => Effect.succeed({ _tag: "unavailable" as const }),
      }),
    ),
  ),
);

/** Mounts `atom` and resolves with its first value that passes `ready`, or fails after a second. */
function settle<A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  ready: (a: A) => boolean,
) {
  return Effect.callback<A, Error>((resume) => {
    const check = (value: A) => {
      if (ready(value)) resume(Effect.succeed(value));
    };
    const release = registry.mount(atom);
    const unsubscribe = registry.subscribe(atom, check, { immediate: true });
    return Effect.sync(() => {
      unsubscribe();
      release();
    });
  }).pipe(Effect.timeout("1 second"));
}

describe("launch with machines that do not answer", () => {
  it.live("shows every cached chat and opens a known thread before any machine connects", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const catalog = createEnvironmentCatalogAtoms(runtime);
      const shells = createEnvironmentShellAtoms(runtime);
      const snapshots = createEnvironmentSnapshotAtom(shells.stateAtom);
      const threads = createEnvironmentThreadStateAtoms(runtime);
      // The phone's thread list arranges rows through this hold.
      const steady = createSteadyShellAtoms({
        catalogValueAtom: catalog.catalogValueAtom,
        snapshotAtom: snapshots,
        shellStateAtom: shells.stateValueAtom,
        rowActionsAtom: () => Atom.make(0),
        connectionStateAtom: catalog.stateAtom,
      });
      const titles = (environmentId: EnvironmentId) =>
        Atom.make((get) => get(steady.snapshotAtom(environmentId))?.threads[0]?.title ?? null);

      expect(yield* settle(registry, titles(SILENT.environmentId), (title) => title !== null)).toBe(
        "Silent machine's chat",
      );
      expect(
        yield* settle(registry, titles(OFFLINE.environmentId), (title) => title !== null),
      ).toBe("Offline machine's chat");

      const opened = yield* settle(
        registry,
        threads.stateAtom(SILENT.environmentId, v2ThreadShell.id),
        (result) => AsyncResult.isSuccess(result) && Option.isSome(result.value.data),
      );
      expect(
        AsyncResult.isSuccess(opened) && Option.getOrNull(opened.value.data)?.thread.title,
      ).toBe("Silent chat");

      // The silent machine is still on its first attempt, in its own corner.
      const silent = yield* settle(registry, catalog.stateAtom(SILENT.environmentId), (result) =>
        AsyncResult.isSuccess(result),
      );
      expect(AsyncResult.isSuccess(silent) && silent.value.phase).toBe("connecting");
      expect(registry.get(shells.stateValueAtom(SILENT.environmentId)).status).toBe(
        "synchronizing",
      );
      registry.dispose();
    }),
  );
});
