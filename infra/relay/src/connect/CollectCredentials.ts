import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Base64Url from "effect/encoding/Base64Url";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import * as RelayConfiguration from "../Config.ts";
import * as DpopProofs from "../auth/DpopProofs.ts";
import * as RelayTokens from "../auth/RelayTokens.ts";
import * as EnvironmentCredentials from "../environments/EnvironmentCredentials.ts";
import { verifyRelayClientBearerToken } from "../http/Api.ts";
import {
  type CollectCaller,
  CollectCredentials,
  CollectCredentialsUnavailable,
} from "./CollectRoutes.ts";
import { installationBinding } from "./CollectTokens.ts";

const ENVIRONMENT_CREDENTIAL_PREFIX = "t3env_";

/** The Clerk session a verified token belongs to: one per sign-in on a device. */
function clerkSessionOf(token: string): string | undefined {
  const middle = token.split(".")[1];
  if (middle === undefined) return undefined;
  const decoded = Base64Url.decodeString(middle);
  if (Result.isFailure(decoded)) return undefined;
  try {
    const claims: unknown = JSON.parse(decoded.success);
    if (typeof claims !== "object" || claims === null) return undefined;
    const sid: unknown = Reflect.get(claims, "sid");
    return typeof sid === "string" && sid !== "" ? sid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Accepts what the relay accepts elsewhere: a Clerk session or OAuth token from an
 * app, a DPoP-bound relay token with its proof, or a machine's environment credential.
 */
export const layer = Layer.effect(
  CollectCredentials,
  Effect.gen(function* () {
    const config = yield* RelayConfiguration.RelayConfiguration;
    const environmentCredentials = yield* EnvironmentCredentials.EnvironmentCredentials;
    const relayTokens = yield* RelayTokens.RelayTokens;
    const dpopProofs = yield* DpopProofs.DpopProofReplay;

    const viaDpop = Effect.fn("relay.collect.credentials.dpop")(function* (
      request: HttpServerRequest.HttpServerRequest,
      token: string,
    ) {
      const claims = yield* relayTokens.verifyDpopAccessToken({ token });
      if (!claims) return undefined;
      const url = HttpServerRequest.toURL(request);
      if (Option.isNone(url)) return undefined;
      const proof = yield* dpopProofs
        .verifyAndConsume({
          proof: request.headers.dpop,
          method: request.method,
          url: url.value.href,
          now: yield* DateTime.now,
          expectedThumbprint: claims.cnf.jkt,
          expectedAccessToken: token,
        })
        .pipe(
          Effect.as(true),
          Effect.catchTags({
            DpopProofRejected: () => Effect.succeed(false),
            DpopProofReplayPersistenceError: (cause) =>
              Effect.fail(new CollectCredentialsUnavailable({ cause })),
          }),
        );
      if (!proof) return undefined;
      return {
        rateKey: `user:${claims.sub}`,
        installation: installationBinding("dpop", claims.cnf.jkt),
      } satisfies CollectCaller;
    });

    const viaEnvironment = Effect.fn("relay.collect.credentials.environment")(function* (
      token: string,
    ) {
      const principal = yield* environmentCredentials
        .authenticate(token)
        .pipe(Effect.mapError((cause) => new CollectCredentialsUnavailable({ cause })));
      if (Option.isNone(principal)) return undefined;
      return {
        rateKey: `environment:${principal.value.environmentId}`,
        installation: installationBinding("environment", principal.value.environmentId),
      } satisfies CollectCaller;
    });

    const viaClerk = Effect.fn("relay.collect.credentials.clerk")(function* (token: string) {
      const verified = yield* verifyRelayClientBearerToken(config, token).pipe(Effect.option);
      if (Option.isNone(verified)) return undefined;
      const session = clerkSessionOf(token);
      return {
        rateKey: `user:${verified.value.sub}`,
        installation: installationBinding(
          "clerk",
          session === undefined ? verified.value.sub : `${verified.value.sub}:${session}`,
        ),
      } satisfies CollectCaller;
    });

    return CollectCredentials.of({
      authenticate: Effect.fn("relay.collect.credentials")(function* (request) {
        const match = /^(Bearer|DPoP) +(\S+)\s*$/iu.exec(request.headers.authorization ?? "");
        if (!match) return undefined;
        const scheme = (match[1] ?? "").toLowerCase();
        const token = match[2] ?? "";
        if (scheme === "dpop") return yield* viaDpop(request, token);
        if (token.startsWith(ENVIRONMENT_CREDENTIAL_PREFIX)) return yield* viaEnvironment(token);
        return yield* viaClerk(token);
      }),
    });
  }),
);
