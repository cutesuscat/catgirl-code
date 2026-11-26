import { createClerkClient, verifyToken } from "@clerk/backend";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { vi } from "vite-plus/test";

import * as RelayConfiguration from "../Config.ts";
import * as DpopProofs from "../auth/DpopProofs.ts";
import * as RelayTokens from "../auth/RelayTokens.ts";
import * as EnvironmentCredentials from "../environments/EnvironmentCredentials.ts";
import * as CollectCredentials from "./CollectCredentials.ts";
import { CollectCredentials as CollectCredentialsService } from "./CollectRoutes.ts";
import { installationBinding } from "./CollectTokens.ts";

vi.mock("@clerk/backend", () => ({
  createClerkClient: vi.fn(),
  verifyToken: vi.fn(),
}));

const config = RelayConfiguration.RelayConfiguration.of({
  relayIssuer: "https://relay.example.test",
  apns: null,
  clerkSecretKey: Redacted.make("clerk-secret"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "t3-code-relay",
  apnsDeliveryJobSigningSecret: Redacted.make("job-secret"),
  cloudMintPrivateKey: Redacted.make("cloud-private-key"),
  cloudMintPublicKey: "cloud-public-key",
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
});

const proofs: Array<unknown> = [];
const machines = { down: false };

const layer = CollectCredentials.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      RelayConfiguration.layer(config),
      Layer.mock(EnvironmentCredentials.EnvironmentCredentials, {
        authenticate: (token) =>
          machines.down
            ? Effect.fail(
                new EnvironmentCredentials.EnvironmentCredentialAuthenticatePersistenceError({
                  stage: "lookup-credential",
                  cause: "database down",
                }),
              )
            : Effect.succeed(
                token === "t3env_known_secret"
                  ? Option.some({
                      credentialId: "c1",
                      environmentId: "env-1",
                      environmentPublicKey: "k",
                    })
                  : Option.none(),
              ),
      }),
      Layer.mock(RelayTokens.RelayTokens, {
        resolveDpopAccessTokenScopes: () => null,
        verifyDpopAccessToken: ({ token }) =>
          Effect.succeed(
            token === "relay-access-token"
              ? ({
                  sub: "user_dpop",
                  cnf: { jkt: "thumbprint-1" },
                } as RelayTokens.RelayDpopAccessTokenClaims)
              : null,
          ),
      }),
      Layer.mock(DpopProofs.DpopProofReplay, {
        verifyAndConsume: (input) =>
          Effect.suspend(() => {
            proofs.push(input);
            return input.proof === "good-proof"
              ? Effect.succeed("jti-1")
              : Effect.fail(new DpopProofs.DpopProofRejected({ code: "replayed" }));
          }),
      }),
    ),
  ),
);

const authenticate = (headers: Record<string, string>) =>
  Effect.gen(function* () {
    const credentials = yield* CollectCredentialsService;
    return yield* credentials.authenticate(
      HttpServerRequest.fromWeb(
        // The relay reads the DPoP target from the Host header, as every Worker request has.
        new Request("https://relay.example.test/v1/collect/token", {
          method: "POST",
          headers: { host: "relay.example.test", ...headers },
        }),
      ),
    );
  }).pipe(Effect.provide(layer));

/** A token shaped like a Clerk session JWT; Clerk's verification itself is mocked. */
const sessionJwt = `h.${btoa(JSON.stringify({ sub: "user_1", sid: "sess_1" })).replaceAll("=", "")}.s`;

describe("credentials for a collect token", () => {
  it.effect("accept an app's Clerk session and bind the token to that sign-in", () =>
    Effect.gen(function* () {
      vi.mocked(verifyToken).mockResolvedValue({ sub: "user_1", aud: "t3-code-relay" } as never);
      expect(yield* authenticate({ authorization: `Bearer ${sessionJwt}` })).toEqual({
        rateKey: "user:user_1",
        installation: installationBinding("clerk", "user_1:sess_1"),
      });
    }).pipe(Effect.ensuring(Effect.sync(() => vi.mocked(verifyToken).mockReset()))),
  );

  it.effect("refuse a token Clerk does not accept", () =>
    Effect.gen(function* () {
      vi.mocked(verifyToken).mockRejectedValue(new Error("invalid"));
      vi.mocked(createClerkClient).mockReturnValue({
        authenticateRequest: async () => ({ isAuthenticated: false, toAuth: () => ({}) }),
      } as never);
      expect(yield* authenticate({ authorization: `Bearer ${sessionJwt}` })).toBeUndefined();
      expect(yield* authenticate({})).toBeUndefined();
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.mocked(verifyToken).mockReset();
          vi.mocked(createClerkClient).mockReset();
        }),
      ),
    ),
  );

  it.effect("accept a machine's credential, and say so when they cannot be checked", () =>
    Effect.gen(function* () {
      expect(yield* authenticate({ authorization: "Bearer t3env_known_secret" })).toEqual({
        rateKey: "environment:env-1",
        installation: installationBinding("environment", "env-1"),
      });
      expect(yield* authenticate({ authorization: "Bearer t3env_unknown" })).toBeUndefined();
      expect(verifyToken).not.toHaveBeenCalled();
      machines.down = true;
      const down = yield* Effect.flip(authenticate({ authorization: "Bearer t3env_known_secret" }));
      expect(down._tag).toBe("CollectCredentialsUnavailable");
    }).pipe(Effect.ensuring(Effect.sync(() => (machines.down = false)))),
  );

  it.effect("accept a DPoP relay token only with a fresh proof bound to it", () =>
    Effect.gen(function* () {
      proofs.length = 0;
      expect(
        yield* authenticate({ authorization: "DPoP relay-access-token", dpop: "good-proof" }),
      ).toEqual({
        rateKey: "user:user_dpop",
        installation: installationBinding("dpop", "thumbprint-1"),
      });
      expect(proofs[0]).toMatchObject({
        proof: "good-proof",
        method: "POST",
        url: "https://relay.example.test/v1/collect/token",
        expectedThumbprint: "thumbprint-1",
        expectedAccessToken: "relay-access-token",
      });
      expect(
        yield* authenticate({ authorization: "DPoP relay-access-token", dpop: "replayed-proof" }),
      ).toBeUndefined();
      expect(
        yield* authenticate({ authorization: "DPoP forged", dpop: "good-proof" }),
      ).toBeUndefined();
    }),
  );
});
