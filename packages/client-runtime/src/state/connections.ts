import type { EnvironmentId as EnvironmentIdType } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/reactivity";

import * as EnvironmentRegistry from "../connection/registry.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import {
  PullRequestRoutingPermissions,
  type PullRequestRoutingPermission,
  type StoredPullRequestRoutingPermission,
} from "../connection/pullRequestRoutingPermissions.ts";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
  environmentSessionGenerationAtom,
  followStreamInEnvironment,
} from "./runtime.ts";

export interface EnvironmentCatalogState {
  readonly isReady: boolean;
  readonly entries: ReadonlyMap<EnvironmentIdType, ConnectionCatalogEntry>;
}

export function* enabledEnvironmentIds(
  catalog: EnvironmentCatalogState,
): Generator<EnvironmentIdType> {
  for (const [environmentId, entry] of catalog.entries) {
    if (entry.enabled && entry.unsupportedReason === undefined) {
      yield environmentId;
    }
  }
}

const EMPTY_ENVIRONMENT_CATALOG_STATE: EnvironmentCatalogState = Object.freeze({
  isReady: false,
  entries: new Map(),
});

export type EnvironmentLabelOverrides = Readonly<Record<string, string>>;

/**
 * Shows each environment under the name this device gave it. An entry keeps its identity
 * while its saved entry and its name stay the same, so readers that compare entries hold.
 */
export function createEnvironmentLabelOverrider() {
  const renamed = new WeakMap<ConnectionCatalogEntry, ConnectionCatalogEntry>();
  let previous: EnvironmentCatalogState = EMPTY_ENVIRONMENT_CATALOG_STATE;
  return (
    catalog: EnvironmentCatalogState,
    overrides: EnvironmentLabelOverrides,
  ): EnvironmentCatalogState => {
    let changed = false;
    const entries = new Map<EnvironmentIdType, ConnectionCatalogEntry>();
    for (const [environmentId, entry] of catalog.entries) {
      const label = overrides[environmentId]?.trim();
      if (!label || label === entry.target.label) {
        entries.set(environmentId, entry);
        continue;
      }
      changed = true;
      let next = renamed.get(entry);
      if (next === undefined || next.target.label !== label) {
        const target: ConnectionCatalogEntry["target"] = Object.assign(
          Object.create(Object.getPrototypeOf(entry.target)),
          entry.target,
          { label },
        );
        next = { ...entry, target };
        renamed.set(entry, next);
      }
      entries.set(environmentId, next);
    }
    if (!changed) return catalog;
    const same =
      previous.isReady === catalog.isReady &&
      previous.entries.size === entries.size &&
      [...entries].every(([environmentId, entry]) => previous.entries.get(environmentId) === entry);
    if (!same) previous = { isReady: catalog.isReady, entries };
    return previous;
  };
}

export function createEnvironmentCatalogAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
  options?: {
    /** Names this device shows in place of each environment's own, by environment id. */
    readonly labelOverridesAtom?: Atom.Atom<EnvironmentLabelOverrides>;
  },
) {
  const commandScheduler = createAtomCommandScheduler();
  const serial = { mode: "serial" as const, key: () => "environment-catalog" };
  const catalogAtom = runtime.atom(
    Stream.unwrap(
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.map((registry) =>
          SubscriptionRef.changes(registry.entries).pipe(
            Stream.map((entries) => ({
              isReady: true,
              entries,
            })),
          ),
        ),
      ),
    ),
    { initialValue: EMPTY_ENVIRONMENT_CATALOG_STATE },
  );

  /** The catalog as saved, under each environment's own name. */
  const savedCatalogValueAtom = Atom.make((get) =>
    AsyncResult.getOrElse(get(catalogAtom), () => EMPTY_ENVIRONMENT_CATALOG_STATE),
  ).pipe(Atom.withLabel("environment-catalog-saved-value"));

  const labelOverridesAtom = options?.labelOverridesAtom;
  const overrideLabels = createEnvironmentLabelOverrider();
  const catalogValueAtom = (
    labelOverridesAtom === undefined
      ? savedCatalogValueAtom
      : Atom.make((get) => overrideLabels(get(savedCatalogValueAtom), get(labelOverridesAtom)))
  ).pipe(Atom.withLabel("environment-catalog-value"));

  const pullRequestRoutingPermissionsAtom = runtime.atom(
    Stream.unwrap(
      PullRequestRoutingPermissions.pipe(Effect.map((permissions) => permissions.changes)),
    ),
    { initialValue: [] as ReadonlyArray<StoredPullRequestRoutingPermission> },
  );
  const pullRequestRoutingPermissionsValueAtom = Atom.make((get) =>
    AsyncResult.getOrElse(get(pullRequestRoutingPermissionsAtom), () => []),
  ).pipe(Atom.withLabel("environment-pull-request-routing-permissions"));
  const setPullRequestRoutingPermission = createRuntimeCommand(runtime, {
    label: "environment-catalog:pull-request-routing-permission",
    scheduler: commandScheduler,
    concurrency: serial,
    execute: Effect.fn(function* (input: {
      readonly environmentId: EnvironmentIdType;
      readonly permission: PullRequestRoutingPermission;
    }) {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      const entry = (yield* SubscriptionRef.get(registry.entries)).get(input.environmentId);
      if (entry === undefined)
        return yield* new EnvironmentRegistry.EnvironmentNotRegisteredError({
          environmentId: input.environmentId,
        });
      const permissions = yield* PullRequestRoutingPermissions;
      yield* permissions.set(entry, input.permission);
    }),
  });

  const networkStatusAtom = runtime.atom(
    Stream.unwrap(
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.map((registry) => SubscriptionRef.changes(registry.networkStatus)),
      ),
    ),
    { initialValue: "unknown" as const },
  );

  const networkStatusValueAtom = Atom.make((get) =>
    AsyncResult.getOrElse(get(networkStatusAtom), () => "unknown" as const),
  ).pipe(Atom.withLabel("environment-network-status-value"));

  const stateAtom = Atom.family((environmentId: EnvironmentIdType) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.map((supervisor) => SubscriptionRef.changes(supervisor.state)),
          ),
        ),
      ),
      { initialValue: AVAILABLE_CONNECTION_STATE },
    ),
  );

  const sessionGenerationAtom = (environmentId: EnvironmentIdType) =>
    environmentSessionGenerationAtom(runtime, environmentId);

  const register = createRuntimeCommand(runtime, {
    label: "environment-catalog:register",
    scheduler: commandScheduler,
    concurrency: serial,
    execute: (
      target: Parameters<EnvironmentRegistry.EnvironmentRegistry["Service"]["register"]>[0],
    ) =>
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.register(target)),
      ),
  });
  const remove = createRuntimeCommand(runtime, {
    label: "environment-catalog:remove",
    scheduler: commandScheduler,
    concurrency: serial,
    execute: (environmentId: EnvironmentIdType) =>
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.remove(environmentId)),
      ),
  });
  const removeRelayEnvironments = createRuntimeCommand(runtime, {
    label: "environment-catalog:remove-relay-environments",
    scheduler: commandScheduler,
    concurrency: serial,
    execute: (_input: void) =>
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.removeRelayEnvironments()),
      ),
  });
  const setEnabled = createRuntimeCommand(runtime, {
    label: "environment-catalog:set-enabled",
    scheduler: commandScheduler,
    concurrency: serial,
    execute: (input: { readonly environmentId: EnvironmentIdType; readonly enabled: boolean }) =>
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.setEnabled(input.environmentId, input.enabled)),
      ),
  });
  const removeRoute = createRuntimeCommand(runtime, {
    label: "environment-catalog:remove-route",
    scheduler: commandScheduler,
    concurrency: serial,
    execute: (input: { readonly environmentId: EnvironmentIdType; readonly routeId: string }) =>
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.removeRoute(input.environmentId, input.routeId)),
      ),
  });
  const reorderRoutes = createRuntimeCommand(runtime, {
    label: "environment-catalog:reorder-routes",
    scheduler: commandScheduler,
    concurrency: serial,
    execute: (input: {
      readonly environmentId: EnvironmentIdType;
      readonly routeIds: ReadonlyArray<string>;
    }) =>
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.reorderRoutes(input.environmentId, input.routeIds)),
      ),
  });
  const retryNow = createRuntimeCommand(runtime, {
    label: "environment-catalog:retry-now",
    scheduler: commandScheduler,
    concurrency: serial,
    execute: (environmentId: EnvironmentIdType) =>
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.retryNow(environmentId)),
      ),
  });

  return {
    catalogAtom,
    catalogValueAtom,
    savedCatalogValueAtom,
    pullRequestRoutingPermissionsValueAtom,
    setPullRequestRoutingPermission,
    networkStatusAtom,
    networkStatusValueAtom,
    stateAtom,
    sessionGenerationAtom,
    register,
    remove,
    removeRoute,
    reorderRoutes,
    removeRelayEnvironments,
    retryNow,
    setEnabled,
  };
}
