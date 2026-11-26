// Catgirl Code: where product usage analytics go is set on the machine, never built in.
import type { ManagedPolicySummary, ServerObservability } from "@t3tools/contracts";
import { isAnalyticsAllowed } from "@t3tools/shared/otelEnvironment";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import * as ServerConfig from "../config.ts";

type Source = "environment" | "settings";

export type SavedAnalytics = NonNullable<ServerConfig.ServerConfig["Service"]["savedAnalytics"]>;

/** What the machine's Catgirl Connect service offers, filled in when the server starts. */
export interface ConnectAnalyticsOffer {
  readonly serviceName: string;
  /** Events are posted to this address itself, with a token from Connect sign-in. */
  readonly url: string;
  readonly relayUrl: string;
}

/** Each half with where it came from. A half that is missing or unusable is absent. */
export interface AnalyticsTarget {
  /** Events are posted to `${url}/batch/`. */
  readonly url?: string;
  readonly urlSource?: Source;
  readonly key?: string;
  readonly keySource?: Source;
  readonly offer?: ConnectAnalyticsOffer;
  /** The offer is the destination: the machine said yes and named no other. */
  readonly connect?: true;
}

/** Stands in for the project key: a Connect collector authenticates the bearer token instead. */
const CONNECT_KEY = "connect";

const blankAsUnset = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const httpUrl = (raw: string) => {
  const url = URL.canParse(raw) ? new URL(raw) : undefined;
  if (url?.protocol !== "http:" && url?.protocol !== "https:") return undefined;
  return raw.replace(/\/+$/, "");
};

/**
 * The environment wins over the saved setting, one half at a time. A variable that is set claims
 * its half even when unusable, so a bad value sends nothing rather than falling back.
 */
export const resolveAnalyticsTarget = (
  environment: { readonly url: string | undefined; readonly key: string | undefined },
  saved: SavedAnalytics | undefined,
  offer?: ConnectAnalyticsOffer,
): AnalyticsTarget => {
  const environmentUrl = blankAsUnset(environment.url);
  const environmentKey = blankAsUnset(environment.key);
  const url = httpUrl(environmentUrl ?? blankAsUnset(saved?.analyticsUrl) ?? "");
  const key = environmentKey ?? blankAsUnset(saved?.analyticsKey);
  const named = environmentUrl ?? environmentKey ?? url ?? key;
  if (offer !== undefined && named === undefined && saved?.connectAnalytics === true) {
    return {
      url: offer.url,
      urlSource: "settings",
      key: CONNECT_KEY,
      keySource: "settings",
      offer,
      connect: true,
    };
  }
  return {
    ...(offer === undefined ? {} : { offer }),
    ...(url === undefined
      ? {}
      : { url, urlSource: environmentUrl === undefined ? "settings" : "environment" }),
    ...(key === undefined
      ? {}
      : { key, keySource: environmentKey === undefined ? "settings" : "environment" }),
  };
};

/** Both halves, or there is nowhere to send to. */
export const analyticsDestination = ({ url, key, offer, connect }: AnalyticsTarget) =>
  url === undefined || key === undefined
    ? undefined
    : { url, key, ...(connect && offer ? { connect: offer } : {}) };

type Destination = NonNullable<ReturnType<typeof analyticsDestination>>;

/** A PostHog ingest takes `/batch/`; a Connect collector's address is the endpoint itself. */
export const endpointOf = (destination: Destination) =>
  destination.connect ? destination.url : `${destination.url}/batch/`;

const CollectToken = Schema.Struct({ token: Schema.String, expiresAt: Schema.String });

export class CollectTokenError extends Schema.TaggedError<CollectTokenError>()(
  "CollectTokenError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not get a Catgirl Connect collect token.";
  }
}
const isCollectTokenError = Schema.is(CollectTokenError);
const TOKEN_MARGIN_MS = 60_000;

/**
 * For a Connect collector: a short-lived token from `<relay>/v1/collect/token`, asked for with the
 * credential this machine already signs in to the relay with, and reused until it nearly expires.
 */
export const collectAuthorization = Effect.fn("AnalyticsDestination.collectAuthorization")(
  function* (destination: Destination | undefined) {
    const offer = destination?.connect;
    if (offer === undefined)
      return (request: HttpClientRequest.HttpClientRequest) => Effect.succeed(request);
    const httpClient = yield* HttpClient.HttpClient;
    const tokens = yield* Effect.serviceOption(CliTokenManager.CloudCliTokenManager);
    let cached: { readonly token: string; readonly until: number } | null = null;
    const token = Effect.gen(function* () {
      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      if (cached !== null && cached.until > now) return cached.token;
      const credential = Option.isSome(tokens) ? yield* tokens.value.getExisting : Option.none();
      if (Option.isNone(credential))
        return yield* new CollectTokenError({ cause: "not signed in" });
      const issued = yield* HttpClientRequest.post(`${offer.relayUrl}/v1/collect/token`).pipe(
        HttpClientRequest.bearerToken(credential.value.accessToken),
        HttpClientRequest.bodyJson({}),
        Effect.flatMap(httpClient.execute),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(CollectToken)),
      );
      cached = { token: issued.token, until: Date.parse(issued.expiresAt) - TOKEN_MARGIN_MS };
      return issued.token;
    }).pipe(
      Effect.mapError((cause) =>
        isCollectTokenError(cause) ? cause : new CollectTokenError({ cause }),
      ),
    );
    return (request: HttpClientRequest.HttpClientRequest) =>
      token.pipe(Effect.map((value) => HttpClientRequest.bearerToken(request, value)));
  },
);

/**
 * Whether this server sends usage analytics. Naming a destination is the opt-in; an environment
 * that says no, `DO_NOT_TRACK`, a managed policy and an unasked CI runner each still turn it off.
 */
export const analyticsEnabledFor = (
  env: Readonly<Record<string, string | undefined>>,
  policy: ManagedPolicySummary | undefined,
  target: AnalyticsTarget,
) =>
  analyticsDestination(target) !== undefined &&
  policy?.limits?.telemetry !== false &&
  env.T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING !== "1" &&
  isAnalyticsAllowed(env);

/** What clients are told: the address and where each half came from, never the key itself. */
export const describeAnalytics = (
  env: Readonly<Record<string, string | undefined>>,
  policy: ManagedPolicySummary | undefined,
  target: AnalyticsTarget,
): Pick<
  ServerObservability,
  | "analyticsUrl"
  | "analyticsUrlSource"
  | "analyticsKeySource"
  | "analyticsEnabled"
  | "connectAnalyticsOffer"
> => ({
  ...(target.offer === undefined
    ? {}
    : { connectAnalyticsOffer: { serviceName: target.offer.serviceName, url: target.offer.url } }),
  ...(target.url === undefined
    ? {}
    : { analyticsUrl: target.url, analyticsUrlSource: target.urlSource }),
  ...(target.keySource === undefined ? {} : { analyticsKeySource: target.keySource }),
  analyticsEnabled: analyticsEnabledFor(env, policy, target),
});

/** Set at start from the machine's saved Catgirl Connect service (cloud/connectServiceStartup.ts). */
const CONNECT_ANALYTICS_URL_VARIABLE = "T3CODE_CONNECT_ANALYTICS_URL";
const CONNECT_SERVICE_NAME_VARIABLE = "T3CODE_CONNECT_SERVICE_NAME";

const optionalString = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));

/** What the running server resolved at start: the environment over the setting saved then. */
export const resolved = Effect.gen(function* () {
  const environment = yield* Config.all({
    url: optionalString("T3CODE_POSTHOG_HOST"),
    key: optionalString("T3CODE_POSTHOG_KEY"),
  });
  const connect = yield* Config.all({
    url: optionalString(CONNECT_ANALYTICS_URL_VARIABLE),
    serviceName: optionalString(CONNECT_SERVICE_NAME_VARIABLE),
    relayUrl: optionalString("T3CODE_RELAY_URL"),
  });
  const { savedAnalytics } = yield* ServerConfig.ServerConfig;
  const offer =
    connect.url && connect.relayUrl
      ? {
          url: connect.url,
          relayUrl: connect.relayUrl,
          serviceName: connect.serviceName ?? connect.relayUrl,
        }
      : undefined;
  return resolveAnalyticsTarget(environment, savedAnalytics, offer);
}).pipe(Effect.orElseSucceed((): AnalyticsTarget => ({})));

/**
 * A fixed destination for one `AnalyticsService` built under it: agent feedback for T3 Code's team
 * goes through its own instance so usage analytics keep having no built-in destination.
 */
export const FixedTarget = Context.Reference<AnalyticsTarget | undefined>(
  "catgirl/telemetry/AnalyticsFixedTarget",
  { defaultValue: () => undefined },
);

/** What an `AnalyticsService` sends to: its fixed destination, else the machine's own. */
export const target = Effect.gen(function* () {
  return (yield* FixedTarget) ?? (yield* resolved);
});
