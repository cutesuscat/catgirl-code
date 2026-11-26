import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { ConnectServiceSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopConnectService from "./DesktopConnectService.ts";

const service: ConnectServiceSettings = {
  relayUrl: "https://relay.example.test",
  clerkPublishableKey: `pk_live_${btoa("clerk.example.test$")}`,
  clerkJwtTemplate: "t3-relay",
  clerkCliOAuthClientId: "cli-client",
  source: "discovered",
};

// What a later check of a signed service adds; the file keeps it across launches.
const trust = {
  key: "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w",
  document: {
    version: 2,
    issuedAt: "2026-11-26T03:00:00Z",
    expiresAt: "2026-12-26T03:00:00Z",
    relayUrl: "https://relay.example.test",
    signIn: {
      provider: "clerk",
      publishableKey: service.clerkPublishableKey,
      jwtTemplate: "t3-relay",
    },
  },
  checkedAt: "2026-11-27T00:00:00.000Z",
  recentChanges: [{ at: "2026-11-27T00:00:00.000Z", kind: "name" as const, to: "Cats" }],
};

const layerNode = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

/** One app launch: the service reads its file while this layer builds. */
const launch = <A, E>(
  baseDir: string,
  use: (
    connectService: DesktopConnectService.DesktopConnectService["Service"],
  ) => Effect.Effect<A, E, DesktopEnvironment.DesktopEnvironment | FileSystem.FileSystem>,
) =>
  DesktopConnectService.DesktopConnectService.pipe(
    Effect.flatMap(use),
    Effect.provide(
      DesktopConnectService.layer.pipe(
        Layer.provideMerge(
          DesktopEnvironment.layer({
            dirname: "/repo/apps/desktop/src",
            homeDirectory: baseDir,
            platform: "darwin",
            processArch: "x64",
            appVersion: "1.2.3",
            appPath: "/repo",
            isPackaged: true,
            resourcesPath: "/missing/resources",
            runningUnderArm64Translation: false,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(layerNode, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
            ),
          ),
        ),
        Layer.provideMerge(layerNode),
      ),
    ),
  );

const withHome = <A, E>(effect: (baseDir: string) => Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* effect(
      yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-desktop-connect-service-test-" }),
    );
  }).pipe(Effect.provide(layerNode));

describe("DesktopConnectService", () => {
  it.effect("applies a saved service on the next launch and drops it on reset", () =>
    withHome((baseDir) =>
      Effect.gen(function* () {
        const first = yield* launch(baseDir, (connectService) =>
          connectService.save(service).pipe(Effect.as(connectService)),
        );
        // The launch that saved keeps running on what it started with.
        assert.strictEqual(first.saved, null);
        assert.deepStrictEqual(first.backendEnvironment, {});

        const second = yield* launch(baseDir, (connectService) =>
          connectService.save(null).pipe(Effect.as(connectService)),
        );
        assert.deepStrictEqual(second.saved, service);
        assert.strictEqual(second.clerkFrontendApiHostname, "clerk.example.test");
        assert.deepStrictEqual(second.backendEnvironment, {
          T3CODE_RELAY_URL: "https://relay.example.test",
          T3CODE_CLERK_PUBLISHABLE_KEY: service.clerkPublishableKey,
          T3CODE_CLERK_JWT_TEMPLATE: "t3-relay",
          T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "cli-client",
        });

        const third = yield* launch(baseDir, Effect.succeed);
        assert.strictEqual(third.saved, null);
        assert.strictEqual(third.clerkFrontendApiHostname, undefined);
      }),
    ),
  );

  it.effect("starts on the built-in service when the saved file is unusable", () =>
    withHome((baseDir) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* launch(baseDir, () =>
          Effect.map(DesktopEnvironment.DesktopEnvironment, (environment) =>
            environment.path.join(environment.stateDir, "connect-service.json"),
          ),
        );
        yield* fileSystem.makeDirectory(path.replace(/[^/\\]+$/u, ""), { recursive: true });
        for (const contents of [
          "{ not json",
          JSON.stringify({ ...service, relayUrl: "http://relay.example.test" }),
          JSON.stringify({ ...service, clerkPublishableKey: "sk_live_secret" }),
        ]) {
          yield* fileSystem.writeFileString(path, contents);
          const launched = yield* launch(baseDir, Effect.succeed);
          assert.strictEqual(launched.saved, null);
          assert.deepStrictEqual(launched.backendEnvironment, {});
        }
      }),
    ),
  );

  it.effect("saves a later check of the same service in place, never new sign-in values", () =>
    withHome((baseDir) =>
      Effect.gen(function* () {
        yield* launch(baseDir, (connectService) => connectService.save(service));
        const checked = { ...service, clerkCliOAuthClientId: "cli-client" } as const;
        const launched = yield* launch(baseDir, (connectService) =>
          Effect.gen(function* () {
            const refused = yield* connectService.update({ ...checked, clerkJwtTemplate: "other" });
            const saved = yield* connectService.update({ ...checked, connect: trust });
            return { connectService, refused, saved };
          }),
        );
        assert.strictEqual(launched.refused, false);
        assert.strictEqual(launched.saved, true);
        assert.deepStrictEqual(launched.connectService.saved, service);
        assert.strictEqual(launched.connectService.current()?.connect?.key, trust.key);

        const next = yield* launch(baseDir, Effect.succeed);
        assert.deepStrictEqual(next.saved?.connect, trust);
        assert.strictEqual(next.saved?.clerkJwtTemplate, "t3-relay");
      }),
    ),
  );
});
