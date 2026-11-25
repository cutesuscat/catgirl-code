import { describe, expect, it } from "@effect/vitest";
import { checkConnectService } from "@t3tools/shared/connectService";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import * as ConnectServiceDiscovery from "./ConnectServiceDiscovery.ts";

const RELAY = "https://relay.example.test";
const SETTINGS = {
  relayUrl: RELAY,
  clerkPublishableKey: `pk_live_${btoa("clerk.example.test$")}`,
  clerkJwtTemplate: "t3-relay",
  clerkCliOAuthClientId: "cli-client",
};

/** The route beside the metadata every relay serves, driven the way an app's settings screen does. */
const relay = (settings: ConnectServiceDiscovery.ConnectServiceDiscoverySettings) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        Layer.mergeAll(
          ConnectServiceDiscovery.layerRoute(settings),
          HttpRouter.add(
            "GET",
            "/.well-known/oauth-authorization-server",
            HttpServerResponse.jsonUnsafe({ issuer: settings.relayUrl }),
          ),
        ).pipe(Layer.provide(HttpServer.layerServices)),
        { disableLogger: true },
      ),
    ),
    (app) => Effect.promise(() => app.dispose()),
  ).pipe(
    Effect.map((app) => ({
      fetch: (url: string) => app.handler(new Request(url)),
    })),
  );

const NO_SIGN_IN_VALUES = {
  clerkPublishableKey: "",
  clerkJwtTemplate: "",
  clerkCliOAuthClientId: "",
};

describe("connect service discovery route", () => {
  it.effect("gives an app everything it needs from the relay address alone", () =>
    Effect.gen(function* () {
      const { fetch } = yield* relay(SETTINGS);

      const response = yield* Effect.promise(() => fetch(`${RELAY}/.well-known/t3-connect.json`));
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
      expect(yield* Effect.promise(() => response.json())).toEqual({
        version: 1,
        relayUrl: RELAY,
        clerk: {
          publishableKey: SETTINGS.clerkPublishableKey,
          jwtTemplate: "t3-relay",
          cliOAuthClientId: "cli-client",
        },
      });
      expect(
        yield* Effect.promise(() =>
          checkConnectService({ relayUrl: RELAY, ...NO_SIGN_IN_VALUES }, { fetch }),
        ),
      ).toEqual({ _tag: "Ready", settings: { ...SETTINGS, source: "discovered" } });
    }).pipe(Effect.scoped),
  );

  it.effect("publishes nothing until the relay is given its token template", () =>
    Effect.gen(function* () {
      const { fetch } = yield* relay({ ...SETTINGS, clerkJwtTemplate: undefined });

      expect(
        yield* Effect.promise(() =>
          checkConnectService({ relayUrl: RELAY, ...NO_SIGN_IN_VALUES }, { fetch }),
        ),
      ).toEqual({ _tag: "NotPublished" });
    }).pipe(Effect.scoped),
  );
});
