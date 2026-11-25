import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type ManagedPolicyDocument } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { parsePersistedServerObservabilitySettings } from "@t3tools/shared/serverSettings";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import {
  analyticsDestination,
  analyticsEnabledFor,
  describeAnalytics,
  resolveAnalyticsTarget,
  resolved,
  type SavedAnalytics,
} from "./AnalyticsDestination.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

const SAVED = { analyticsUrl: "https://saved.example", analyticsKey: "phc_saved" } as const;
const none = { url: undefined, key: undefined } as const;

describe("the saved usage analytics setting", () => {
  it("is empty by default", () => {
    assert.equal(DEFAULT_SERVER_SETTINGS.observability.analyticsUrl, "");
    assert.equal(DEFAULT_SERVER_SETTINGS.observability.analyticsKey, "");
    const saved = parsePersistedServerObservabilitySettings(
      JSON.stringify(DEFAULT_SERVER_SETTINGS),
    );
    assert.deepEqual(resolveAnalyticsTarget({ url: undefined, key: undefined }, saved), {});
  });

  it("is read from the settings file the way the server reads it at start", () => {
    const saved = parsePersistedServerObservabilitySettings(
      JSON.stringify({
        observability: { analyticsUrl: " https://saved.example ", analyticsKey: " phc_saved " },
      }),
    );
    assert.deepEqual(
      analyticsDestination(resolveAnalyticsTarget({ url: undefined, key: undefined }, saved)),
      { url: "https://saved.example", key: "phc_saved" },
    );
    assert.isUndefined(parsePersistedServerObservabilitySettings("{").analyticsUrl);
  });
});

describe("resolveAnalyticsTarget", () => {
  it("has no destination until the machine names one", () => {
    assert.deepEqual(resolveAnalyticsTarget(none, undefined), {});
    assert.deepEqual(resolveAnalyticsTarget(none, {}), {});
    assert.deepEqual(resolveAnalyticsTarget({ url: " ", key: "" }, { analyticsUrl: "" }), {});
    assert.isUndefined(analyticsDestination(resolveAnalyticsTarget(none, undefined)));
  });

  it("needs both the address and the key", () => {
    const addressOnly = resolveAnalyticsTarget(none, { analyticsUrl: SAVED.analyticsUrl });
    assert.deepEqual(addressOnly, { url: "https://saved.example", urlSource: "settings" });
    assert.isUndefined(analyticsDestination(addressOnly));
    const keyOnly = resolveAnalyticsTarget({ url: undefined, key: "phc_env" }, {});
    assert.deepEqual(keyOnly, { key: "phc_env", keySource: "environment" });
    assert.isUndefined(analyticsDestination(keyOnly));
  });

  it("takes the saved address and key", () => {
    const target = resolveAnalyticsTarget(none, SAVED);
    assert.deepEqual(target, {
      url: "https://saved.example",
      urlSource: "settings",
      key: "phc_saved",
      keySource: "settings",
    });
    assert.deepEqual(analyticsDestination(target), {
      url: "https://saved.example",
      key: "phc_saved",
    });
  });

  it("lets the environment win over the saved setting, one half at a time", () => {
    assert.deepEqual(
      resolveAnalyticsTarget({ url: "https://env.example", key: "phc_env" }, SAVED),
      {
        url: "https://env.example",
        urlSource: "environment",
        key: "phc_env",
        keySource: "environment",
      },
    );
    assert.deepEqual(resolveAnalyticsTarget({ url: "https://env.example", key: "" }, SAVED), {
      url: "https://env.example",
      urlSource: "environment",
      key: "phc_saved",
      keySource: "settings",
    });
  });

  it("sends nothing to an address that is not http or https, and never falls back from one", () => {
    assert.isUndefined(resolveAnalyticsTarget(none, { analyticsUrl: "ftp://saved.example" }).url);
    assert.isUndefined(resolveAnalyticsTarget(none, { analyticsUrl: "saved.example" }).url);
    assert.isUndefined(resolveAnalyticsTarget({ url: "not a url", key: undefined }, SAVED).url);
  });

  it("drops trailing slashes so the batch path is not doubled", () => {
    assert.equal(
      resolveAnalyticsTarget(none, { analyticsUrl: " http://127.0.0.1:8099/ingest// " }).url,
      "http://127.0.0.1:8099/ingest",
    );
  });
});

describe("analyticsEnabledFor", () => {
  const target = resolveAnalyticsTarget(none, SAVED);
  const policy = (telemetry: boolean) => ({
    organization: "Example Corp",
    lockedSettings: [],
    limits: { telemetry },
  });

  it("is on once an address and key are set, with no second switch", () => {
    assert.isTrue(analyticsEnabledFor({}, undefined, target));
    assert.isTrue(analyticsEnabledFor({}, policy(true), target));
  });

  it("stays off without a destination, whatever the other switches say", () => {
    const optedIn = { T3CODE_TELEMETRY_ENABLED: "true" };
    assert.isFalse(analyticsEnabledFor(optedIn, undefined, {}));
    assert.isFalse(analyticsEnabledFor(optedIn, policy(true), { url: "https://saved.example" }));
    assert.isFalse(analyticsEnabledFor(optedIn, undefined, { key: "phc_saved" }));
  });

  it("lets every way of saying no win over a configured destination", () => {
    assert.isFalse(analyticsEnabledFor({ T3CODE_TELEMETRY_ENABLED: "false" }, undefined, target));
    assert.isFalse(analyticsEnabledFor({ T3CODE_TELEMETRY_ENABLED: "0" }, undefined, target));
    assert.isFalse(analyticsEnabledFor({ DO_NOT_TRACK: "1" }, undefined, target));
    assert.isFalse(
      analyticsEnabledFor(
        { DO_NOT_TRACK: "1", T3CODE_TELEMETRY_ENABLED: "true" },
        undefined,
        target,
      ),
    );
    assert.isFalse(analyticsEnabledFor({}, policy(false), target));
    assert.isFalse(
      analyticsEnabledFor({ T3CODE_TELEMETRY_ENABLED: "true" }, policy(false), target),
    );
    assert.isFalse(analyticsEnabledFor({ CI: "true" }, undefined, target));
    assert.isFalse(analyticsEnabledFor({ GITHUB_ACTIONS: "true" }, undefined, target));
    assert.isTrue(
      analyticsEnabledFor({ CI: "true", T3CODE_TELEMETRY_ENABLED: "true" }, undefined, target),
    );
    // Until the desktop has read the login shell, an opt-out there is still unknown.
    assert.isFalse(
      analyticsEnabledFor({ T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING: "1" }, undefined, target),
    );
  });

  it("tells clients the address and the sources, never the key", () => {
    assert.deepEqual(describeAnalytics({}, undefined, target), {
      analyticsUrl: "https://saved.example",
      analyticsUrlSource: "settings",
      analyticsKeySource: "settings",
      analyticsEnabled: true,
    });
    assert.deepEqual(describeAnalytics({ DO_NOT_TRACK: "1" }, undefined, target), {
      analyticsUrl: "https://saved.example",
      analyticsUrlSource: "settings",
      analyticsKeySource: "settings",
      analyticsEnabled: false,
    });
    assert.deepEqual(describeAnalytics({}, undefined, {}), { analyticsEnabled: false });
  });
});

interface Sent {
  readonly url: string;
  readonly apiKey: string;
  readonly events: number;
}

const SentBody = Schema.fromJsonString(
  Schema.Struct({ api_key: Schema.String, batch: Schema.Array(Schema.Unknown) }),
);
const decodeSentBody = Schema.decodeEffect(SentBody);

/**
 * Starts the service as a server does, with `env` as the whole environment and `saved` as the
 * settings file's destination, records one event and flushes. `later` changes the environment and
 * a second event follows. Returns what left the machine.
 */
const run = (
  env: Record<string, string>,
  saved?: SavedAnalytics,
  policy?: ManagedPolicyDocument,
  later?: (env: Record<string, string>) => void,
) =>
  Effect.gen(function* () {
    const sent: Array<Sent> = [];
    const client = HttpClient.make((request) =>
      Effect.gen(function* () {
        if (request.body._tag === "Uint8Array") {
          const body = yield* decodeSentBody(new TextDecoder().decode(request.body.body)).pipe(
            Effect.orDie,
          );
          sent.push({ url: request.url, apiKey: body.api_key, events: body.batch.length });
        }
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
      }),
    );
    const serverConfig = Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({
        ...config,
        ...(saved === undefined ? {} : { savedAnalytics: saved }),
      })),
    ).pipe(
      Layer.provide(
        ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-analytics-destination-" }),
      ),
    );
    const outcome = yield* Effect.gen(function* () {
      const analytics = yield* AnalyticsService.AnalyticsService;
      let queued = yield* analytics.record("test.destination");
      yield* analytics.flush;
      if (later !== undefined) {
        later(env);
        queued = yield* analytics.record("test.destination.later");
        yield* analytics.flush;
      }
      // What the server tells clients must agree with what the service does.
      const reported = analyticsEnabledFor(
        env,
        (yield* ManagedPolicy.ManagedPolicy).summary,
        yield* resolved,
      );
      return { queued, reported };
    }).pipe(
      Effect.provide(
        AnalyticsService.layer.pipe(
          Layer.provideMerge(serverConfig),
          Layer.provideMerge(ManagedPolicy.layerTest(policy)),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(HostProcess.Platform, "linux"),
              Layer.succeed(HostProcess.Architecture, "x64"),
              Layer.succeed(HttpClient.HttpClient, client),
            ),
          ),
          Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
      Effect.provideService(HostProcess.Environment, env),
    );
    assert.equal(outcome.reported, outcome.queued, "reported state matches the service");
    return { ...outcome, sent };
  });

const SILENT = { queued: false, reported: false, sent: [] };
const ENV_DESTINATION = {
  T3CODE_POSTHOG_HOST: "https://env.example/",
  T3CODE_POSTHOG_KEY: "phc_env",
};

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "AnalyticsService destination",
  (it) => {
    it.effect("queues and sends nothing when no destination is configured", () =>
      Effect.gen(function* () {
        assert.deepEqual(yield* run({}), SILENT);
        assert.deepEqual(yield* run({ T3CODE_TELEMETRY_ENABLED: "true" }), SILENT);
        assert.deepEqual(yield* run({ T3CODE_TELEMETRY_ENABLED: "true" }, {}), SILENT);
      }),
    );

    it.effect("queues and sends nothing with only an address or only a key", () =>
      Effect.gen(function* () {
        const optedIn = { T3CODE_TELEMETRY_ENABLED: "true" };
        assert.deepEqual(yield* run(optedIn, { analyticsUrl: SAVED.analyticsUrl }), SILENT);
        assert.deepEqual(yield* run(optedIn, { analyticsKey: SAVED.analyticsKey }), SILENT);
        assert.deepEqual(
          yield* run({ ...optedIn, T3CODE_POSTHOG_HOST: "https://env.example" }),
          SILENT,
        );
        assert.deepEqual(yield* run({ ...optedIn, T3CODE_POSTHOG_KEY: "phc_env" }), SILENT);
      }),
    );

    it.effect("sends to the saved address with the saved key, with no other switch", () =>
      Effect.gen(function* () {
        assert.deepEqual(yield* run({}, SAVED), {
          queued: true,
          reported: true,
          sent: [{ url: "https://saved.example/batch/", apiKey: "phc_saved", events: 1 }],
        });
      }),
    );

    it.effect("sends where the environment says, over the saved setting", () =>
      Effect.gen(function* () {
        assert.deepEqual((yield* run(ENV_DESTINATION, SAVED)).sent, [
          { url: "https://env.example/batch/", apiKey: "phc_env", events: 1 },
        ]);
        assert.deepEqual((yield* run(ENV_DESTINATION)).sent, [
          { url: "https://env.example/batch/", apiKey: "phc_env", events: 1 },
        ]);
        assert.deepEqual((yield* run({ T3CODE_POSTHOG_KEY: "phc_env" }, SAVED)).sent, [
          { url: "https://saved.example/batch/", apiKey: "phc_env", events: 1 },
        ]);
      }),
    );

    it.effect("sends nothing to a configured destination when anything says no", () =>
      Effect.gen(function* () {
        const policy = { schemaVersion: 1, organization: "Example Corp" } as const;
        assert.deepEqual(yield* run({ T3CODE_TELEMETRY_ENABLED: "false" }, SAVED), SILENT);
        assert.deepEqual(yield* run({ DO_NOT_TRACK: "1" }, SAVED), SILENT);
        assert.deepEqual(
          yield* run({ DO_NOT_TRACK: "1", T3CODE_TELEMETRY_ENABLED: "true" }, SAVED),
          SILENT,
        );
        assert.deepEqual(yield* run({ ...ENV_DESTINATION, DO_NOT_TRACK: "1" }), SILENT);
        assert.deepEqual(
          yield* run({}, SAVED, { ...policy, limits: { telemetry: false } }),
          SILENT,
        );
        assert.deepEqual(yield* run({ CI: "true" }, SAVED), SILENT);
        assert.equal(
          (yield* run({ CI: "true", T3CODE_TELEMETRY_ENABLED: "true" }, SAVED)).sent.length,
          1,
        );
        assert.equal(
          (yield* run({}, SAVED, { ...policy, limits: { telemetry: true } })).sent.length,
          1,
        );
      }),
    );

    it.effect("waits for the desktop login shell, which can still say no", () =>
      Effect.gen(function* () {
        const pending = () => ({ T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING: "1" });
        assert.deepEqual(yield* run(pending(), SAVED), SILENT);
        const read = (env: Record<string, string>) => {
          delete env.T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING;
        };
        // Nothing in the shell profile: the saved destination is the opt-in.
        assert.deepEqual(yield* run(pending(), SAVED, undefined, read), {
          queued: true,
          reported: true,
          sent: [{ url: "https://saved.example/batch/", apiKey: "phc_saved", events: 1 }],
        });
        const optedOut = (env: Record<string, string>) => {
          read(env);
          env.T3CODE_TELEMETRY_ENABLED = "false";
        };
        assert.deepEqual(yield* run(pending(), SAVED, undefined, optedOut), SILENT);
      }),
    );
  },
);
