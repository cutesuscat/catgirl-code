import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { parsePersistedServerObservabilitySettings } from "@t3tools/shared/serverSettings";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import {
  analyticsDestination,
  analyticsEnabledFor,
  describeAnalytics,
  resolveAnalyticsTarget,
  type SavedAnalytics,
} from "./AnalyticsDestination.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

const RELAY = "https://relay.example.com";
const OFFER = {
  serviceName: "Example cats",
  url: `${RELAY}/v1/collect/analytics`,
  relayUrl: RELAY,
} as const;
const OFFER_ENV = {
  T3CODE_RELAY_URL: RELAY,
  T3CODE_CONNECT_ANALYTICS_URL: OFFER.url,
  T3CODE_CONNECT_SERVICE_NAME: OFFER.serviceName,
};
const none = { url: undefined, key: undefined } as const;
const YES = { connectAnalytics: true } as const;

describe("a Connect service's usage-data offer", () => {
  it("is saved as the machine's own answer, no by default", () => {
    assert.isUndefined(parsePersistedServerObservabilitySettings("{}").connectAnalytics);
    assert.isTrue(
      parsePersistedServerObservabilitySettings('{"observability":{"connectAnalytics":true}}')
        .connectAnalytics,
    );
  });

  it("is only an offer until the machine says yes", () => {
    const target = resolveAnalyticsTarget(none, {}, OFFER);
    assert.isUndefined(analyticsDestination(target));
    assert.deepEqual(describeAnalytics({}, undefined, target), {
      connectAnalyticsOffer: { serviceName: "Example cats", url: OFFER.url },
      analyticsEnabled: false,
    });
  });

  it("after a yes, sends to the offered address itself", () => {
    const target = resolveAnalyticsTarget(none, YES, OFFER);
    assert.deepEqual(analyticsDestination(target), {
      url: OFFER.url,
      key: "connect",
      connect: OFFER,
    });
    assert.isTrue(analyticsEnabledFor({}, undefined, target));
  });

  it("the address fields and the environment win over it", () => {
    const saved = { ...YES, analyticsUrl: "https://saved.example", analyticsKey: "phc_saved" };
    assert.equal(
      analyticsDestination(resolveAnalyticsTarget(none, saved, OFFER))?.url,
      "https://saved.example",
    );
    const env = { url: "https://env.example", key: "phc_env" };
    assert.equal(
      analyticsDestination(resolveAnalyticsTarget(env, YES, OFFER))?.url,
      "https://env.example",
    );
    // A half set anywhere claims the destination, so it never falls back to the offer.
    assert.isUndefined(
      analyticsDestination(
        resolveAnalyticsTarget({ url: "https://env.example", key: undefined }, YES, OFFER),
      ),
    );
  });

  it("every existing no still wins over a yes", () => {
    const target = resolveAnalyticsTarget(none, YES, OFFER);
    assert.isFalse(analyticsEnabledFor({ T3CODE_TELEMETRY_ENABLED: "false" }, undefined, target));
    assert.isFalse(analyticsEnabledFor({ DO_NOT_TRACK: "1" }, undefined, target));
    assert.isFalse(analyticsEnabledFor({}, { limits: { telemetry: false } } as never, target));
  });
});

/** The real service, with the relay's token route and the collector behind one captured client. */
const run = (env: Record<string, string>, saved: SavedAnalytics, signedIn: boolean) =>
  Effect.gen(function* () {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push({ url: request.url, authorization: request.headers.authorization });
        const body =
          request.url === `${RELAY}/v1/collect/token`
            ? JSON.stringify({ token: "collect-1", expiresAt: "2099-01-01T00:00:00Z" })
            : null;
        return HttpClientResponse.fromWeb(
          request,
          new Response(body, { status: body ? 200 : 204 }),
        );
      }),
    );
    const tokens = Layer.succeed(CliTokenManager.CloudCliTokenManager, {
      getExisting: Effect.succeed(
        signedIn
          ? Option.some({ accessToken: "relay-credential", refreshToken: "r", expiresAtEpochMs: 0 })
          : Option.none(),
      ),
    } as unknown as CliTokenManager.CloudCliTokenManager["Service"]);
    const serverConfig = Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({ ...config, savedAnalytics: saved })),
    ).pipe(
      Layer.provide(
        ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-connect-offer-" }),
      ),
    );
    const queued = yield* Effect.gen(function* () {
      const analytics = yield* AnalyticsService.AnalyticsService;
      const queued = yield* analytics.record("test.connect");
      yield* analytics.flush;
      return queued;
    }).pipe(
      Effect.provide(
        AnalyticsService.layer.pipe(
          Layer.provideMerge(serverConfig),
          Layer.provideMerge(ManagedPolicy.layerTest(undefined)),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(HostProcess.Platform, "linux"),
              Layer.succeed(HostProcess.Architecture, "x64"),
              Layer.succeed(HttpClient.HttpClient, client),
              tokens,
            ),
          ),
          Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
      Effect.provideService(HostProcess.Environment, env),
    );
    return { queued, requests };
  });

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "AnalyticsService and a Connect offer",
  (it) => {
    it.effect("sends nothing without the machine's yes", () =>
      Effect.gen(function* () {
        assert.deepEqual(yield* run(OFFER_ENV, {}, true), { queued: false, requests: [] });
      }),
    );

    it.effect("after a yes, asks the relay for a collect token and sends with it", () =>
      Effect.gen(function* () {
        const { queued, requests } = yield* run(OFFER_ENV, YES, true);
        assert.isTrue(queued);
        assert.deepEqual(requests, [
          { url: `${RELAY}/v1/collect/token`, authorization: "Bearer relay-credential" },
          { url: OFFER.url, authorization: "Bearer collect-1" },
        ]);
      }),
    );

    it.effect("a machine not signed in to Connect sends nothing", () =>
      Effect.gen(function* () {
        const { requests } = yield* run(OFFER_ENV, YES, false);
        assert.deepEqual(requests, []);
      }),
    );
  },
);
