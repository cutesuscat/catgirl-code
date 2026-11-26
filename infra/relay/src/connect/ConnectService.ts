import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/http/HttpRouter";

import type { CollectRow } from "./CollectPayloads.ts";
import * as CollectCredentials from "./CollectCredentials.ts";
import * as CollectRoutes from "./CollectRoutes.ts";
import * as CollectStore from "./CollectStore.ts";
import * as CollectStoreObject from "./CollectStoreObject.ts";
import * as ServiceDocument from "./ServiceDocument.ts";
import * as SigningKey from "./SigningKey.ts";

/**
 * Catgirl Connect v2 on the relay: the signed service document, the collect-token route,
 * the collectors and the operator's page. Everything instance-specific comes from here.
 */
export class ConnectConfigError extends Schema.TaggedError<ConnectConfigError>()(
  "ConnectConfigError",
  { message: Schema.String },
) {}

const optionalText = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Config.map(
      Option.flatMap((value) => (value.trim() === "" ? Option.none() : Option.some(value.trim()))),
    ),
    Config.map(Option.getOrUndefined),
  );

const DIAGNOSTICS_KINDS: ReadonlyArray<ServiceDocument.DiagnosticsKind> = [
  "analytics",
  "crashReports",
  "traces",
];

const readOffers = (value: string | undefined): ReadonlyArray<ServiceDocument.DiagnosticsKind> => {
  if (value === undefined) return DIAGNOSTICS_KINDS;
  if (value === "none") return [];
  return DIAGNOSTICS_KINDS.filter((kind) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .includes(kind),
  );
};

const seedFrom = Effect.fn("ConnectService.seedFrom")(function* (
  name: string,
  value: Redacted.Redacted<string>,
) {
  const seed = ServiceDocument.parseSigningSeed(Redacted.value(value));
  if (seed === undefined) {
    return yield* new ConnectConfigError({
      message: `${name} must be a 32-byte Ed25519 seed, as 64 hex digits or base64url.`,
    });
  }
  return seed;
});

const decodeHex = (value: Redacted.Redacted<string>) =>
  Uint8Array.from(Redacted.value(value).match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));

export interface ConnectServiceInput {
  readonly relayUrl: string;
  readonly clerkPublishableKey: string;
  readonly clerkJwtTemplate: string | undefined;
  readonly clerkCliOAuthClientId: string | undefined;
  readonly alchemyRuntimeContext: Alchemy.BaseRuntimeContext;
}

/** Reads the configuration and binds what the routes need; runs at deploy and in the Worker. */
export const make = Effect.fn("ConnectService.make")(function* (input: ConnectServiceInput) {
  // The signing key is generated once and kept in the deploy state. Raising the generation
  // makes a new key that the previous one endorses (SPEC.md, "Rotation").
  const generation = yield* Config.Int("CONNECT_SIGNING_KEY_GENERATION").pipe(
    Config.withDefault(1),
  );
  // Only for instances deployed before cat-first keys: their older generations stay as pinned.
  const catFirstSince = yield* Config.Int("CONNECT_SIGNING_KEY_CAT_FIRST_SINCE").pipe(
    Config.withDefault(1),
  );
  const explicitKey = yield* Config.Redacted("CONNECT_SIGNING_KEY").pipe(Config.option);
  const explicitPrevious = yield* Config.Redacted("CONNECT_PREVIOUS_SIGNING_KEY").pipe(
    Config.option,
  );
  const generatedKey = Option.isNone(explicitKey)
    ? yield* yield* SigningKey.makeSigningSeed(generation, catFirstSince)
    : undefined;
  const generatedPrevious =
    Option.isNone(explicitKey) && Option.isNone(explicitPrevious) && generation > 1
      ? yield* yield* SigningKey.makeSigningSeed(generation - 1, catFirstSince)
      : undefined;
  const collectTokenSecret = yield* yield* Alchemy.makeRandom("ConnectCollectTokenSecret", {
    bytes: 32,
  });
  const operatorKey = yield* Config.Redacted("CONNECT_OPERATOR_KEY").pipe(Config.option);
  const offers = readOffers(yield* optionalText("CONNECT_DIAGNOSTICS"));
  const serviceName = yield* optionalText("CONNECT_SERVICE_NAME");
  const operatorContact = yield* optionalText("CONNECT_OPERATOR_CONTACT");
  const privacyPolicyUrl = yield* optionalText("CONNECT_PRIVACY_POLICY_URL");
  const hostedAppUrl = yield* optionalText("CONNECT_HOSTED_APP_URL");
  const lifetimeHours = yield* Config.Int("CONNECT_DOCUMENT_LIFETIME_HOURS").pipe(
    Config.withDefault(ServiceDocument.DEFAULT_DOCUMENT_LIFETIME_HOURS),
  );
  const maxRowsPerDay = yield* Config.Int("CONNECT_COLLECT_MAX_ROWS_PER_DAY").pipe(
    Config.withDefault(CollectStore.DEFAULT_MAX_ROWS_PER_DAY),
  );

  const collectStores = yield* CollectStoreObject.CollectStoreObject;
  const tokenRateLimit = yield* Cloudflare.RateLimit("COLLECT_TOKEN_RATE_LIMIT", {
    namespaceId: 1004,
    simple: {
      limit: CollectRoutes.COLLECT_TOKEN_RATE_LIMIT.limit,
      period: CollectRoutes.COLLECT_TOKEN_RATE_LIMIT.periodSeconds,
    },
  });
  const collectRateLimit = yield* Cloudflare.RateLimit("COLLECT_RATE_LIMIT", {
    namespaceId: 1005,
    simple: {
      limit: CollectRoutes.COLLECT_RATE_LIMIT.limit,
      period: CollectRoutes.COLLECT_RATE_LIMIT.periodSeconds,
    },
  });
  const ctx = input.alchemyRuntimeContext;

  /** Per request: secrets resolve from the Worker's bindings. */
  const settings = Effect.gen(function* () {
    const signingSeed = Option.isSome(explicitKey)
      ? yield* seedFrom("CONNECT_SIGNING_KEY", explicitKey.value)
      : generatedKey === undefined
        ? yield* new ConnectConfigError({ message: "No signing key." })
        : yield* seedFrom("ConnectSigningKey", yield* generatedKey);
    const previousSigningSeed = Option.isSome(explicitPrevious)
      ? yield* seedFrom("CONNECT_PREVIOUS_SIGNING_KEY", explicitPrevious.value)
      : generatedPrevious === undefined
        ? undefined
        : yield* seedFrom("ConnectSigningKey", yield* generatedPrevious);
    const document: ServiceDocument.ServiceDocumentSettings = {
      relayUrl: input.relayUrl,
      keys: { signingSeed, previousSigningSeed },
      ...(serviceName === undefined
        ? {}
        : { service: { name: serviceName, operatorContact, privacyPolicyUrl } }),
      signIn: {
        publishableKey: input.clerkPublishableKey,
        jwtTemplate: input.clerkJwtTemplate,
        cliOAuthClientId: input.clerkCliOAuthClientId,
        hostedAppUrl,
      },
      offerDiagnostics: offers,
      lifetimeHours,
    };
    return {
      document,
      collect: {
        tokenSecret: decodeHex(yield* collectTokenSecret),
        operatorKey: Option.getOrUndefined(operatorKey),
        serviceName: serviceName ?? new URL(input.relayUrl).host,
        relayUrl: input.relayUrl,
        fingerprint: ServiceDocument.fingerprintOf(ServiceDocument.publicKeyOf(signingSeed)),
      },
    };
  }).pipe(Effect.provideService(Alchemy.RuntimeContext, ctx));

  // Fails open like the relay's other limiters: an outage must not drop diagnostics.
  const allow = (limiter: typeof tokenRateLimit) => (key: string) =>
    limiter.limit({ key }).pipe(
      Effect.map((result) => result.success),
      Effect.provideService(Alchemy.RuntimeContext, ctx),
      Effect.catch((error) =>
        Effect.logWarning("Collector rate limiter unavailable", { error: error.message }).pipe(
          Effect.as(true),
        ),
      ),
    );

  const storeCall = <A>(effect: Effect.Effect<A, never, Alchemy.RuntimeContext>) =>
    effect.pipe(
      Effect.provideService(Alchemy.RuntimeContext, ctx),
      Effect.catchCause((cause) =>
        Effect.fail(new CollectStore.CollectStoreUnavailable({ cause: Cause.squash(cause) })),
      ),
    );
  const store = CollectStore.CollectStore.of({
    insert: Effect.fn("CollectStore.insert")(function* (rows: ReadonlyArray<CollectRow>) {
      return yield* storeCall(
        collectStores.getByName(CollectStoreObject.COLLECT_STORE_NAME).insert(rows, maxRowsPerDay),
      );
    }),
    // Resolved per call: the namespace exists only inside the Worker, not at deploy time.
    summary: Effect.suspend(() =>
      storeCall(collectStores.getByName(CollectStoreObject.COLLECT_STORE_NAME).summary()),
    ),
  });

  /** The routes, given the relay's runtime services for checking credentials. */
  const routes = <A, E, R>(layerRuntime: Layer.Layer<A, E, R>) =>
    Layer.unwrap(
      Effect.map(settings, ({ document, collect }) =>
        Layer.mergeAll(
          ServiceDocument.layerRoute(document),
          offers.length === 0
            ? Layer.empty
            : CollectRoutes.layerRoutes.pipe(
                HttpRouter.provideRequest(
                  Layer.mergeAll(
                    Layer.succeed(CollectRoutes.CollectSettings, collect),
                    Layer.succeed(CollectStore.CollectStore, store),
                    Layer.succeed(CollectRoutes.CollectRateLimiter, {
                      allowToken: allow(tokenRateLimit),
                      allowCollect: allow(collectRateLimit),
                    }),
                    CollectCredentials.layer.pipe(Layer.provide(layerRuntime)),
                  ),
                ),
              ),
        ),
      ),
    );

  return { routes };
});
