import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import * as CollectPayloads from "./CollectPayloads.ts";
import * as CollectStore from "./CollectStore.ts";
import * as CollectTokens from "./CollectTokens.ts";
import { renderSummaryPage } from "./OperatorSummary.ts";
import { isoSeconds } from "./ServiceDocument.ts";

export const COLLECT_TOKEN_PATH = "/v1/collect/token";
export const OPERATOR_TOKEN_PATH = "/v1/collect/operator-token";
export const ANALYTICS_PATH = "/v1/collect/analytics";
export const OTLP_PATH = "/v1/collect/otlp";
export const OPERATOR_PAGE_PATH = "/operator";

export const MAX_ANALYTICS_BODY_BYTES = 512 * 1024;
export const MAX_OTLP_BODY_BYTES = 1024 * 1024;
/** Per account: an app or machine asks once an hour, more after restarts. */
export const COLLECT_TOKEN_RATE_LIMIT = { limit: 30, periodSeconds: 60 } as const;
/** Per installation: a server flushes every 10 s; a phone a few batches per launch. */
export const COLLECT_RATE_LIMIT = { limit: 60, periodSeconds: 60 } as const;

/** Who a relay credential belongs to, as far as the collectors need to know. */
export interface CollectCaller {
  /** Rate-limit key: the account, or the machine for a machine credential. */
  readonly rateKey: string;
  /** Opaque label for the installation the token is bound to. */
  readonly installation: string;
}

export class CollectCredentialsUnavailable extends Schema.TaggedError<CollectCredentialsUnavailable>()(
  "CollectCredentialsUnavailable",
  { cause: Schema.Defect() },
) {}

/** Checks the credentials the relay already accepts from apps and machines. */
export class CollectCredentials extends Context.Service<
  CollectCredentials,
  {
    readonly authenticate: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<CollectCaller | undefined, CollectCredentialsUnavailable>;
  }
>()("t3code-relay/connect/CollectRoutes/CollectCredentials") {}

export class CollectRateLimiter extends Context.Service<
  CollectRateLimiter,
  {
    readonly allowToken: (key: string) => Effect.Effect<boolean>;
    readonly allowCollect: (key: string) => Effect.Effect<boolean>;
  }
>()("t3code-relay/connect/CollectRoutes/CollectRateLimiter") {}

export class CollectSettings extends Context.Service<
  CollectSettings,
  {
    readonly tokenSecret: Uint8Array;
    readonly operatorKey: Redacted.Redacted<string> | undefined;
    readonly serviceName: string;
    readonly relayUrl: string;
    readonly fingerprint: string;
  }
>()("t3code-relay/connect/CollectRoutes/CollectSettings") {}

class BodyTooLarge extends Schema.TaggedError<BodyTooLarge>()("BodyTooLarge", {}) {}

const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

const refuse = (status: number, error: string, headers?: Record<string, string>) =>
  json(status, { error }, headers);

const BEARER_CHALLENGE = { "www-authenticate": 'Bearer realm="catgirl-connect-collect"' };

const readCapped = (request: HttpServerRequest.HttpServerRequest, maxBytes: number) =>
  Effect.suspend(() => {
    if (request.source instanceof Request && request.source.body === null) {
      return Effect.succeed(new Uint8Array(0));
    }
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) return Effect.fail(new BodyTooLarge());
    const chunks: Array<Uint8Array> = [];
    let total = 0;
    return request.stream.pipe(
      Stream.runForEach((chunk) => {
        total += chunk.length;
        if (total > maxBytes) return Effect.fail(new BodyTooLarge());
        chunks.push(chunk);
        return Effect.void;
      }),
      Effect.map(() => {
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.length;
        }
        return body;
      }),
    );
  });

const bearerToken = (request: HttpServerRequest.HttpServerRequest): string | undefined =>
  /^Bearer +(\S+)\s*$/iu.exec(request.headers.authorization ?? "")?.[1];

const sameSecret = (left: string, right: string) => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
};

/** The operator's key, from Basic auth (any user name) or a bearer header. */
const isOperator = (
  request: HttpServerRequest.HttpServerRequest,
  key: Redacted.Redacted<string>,
) => {
  const header = request.headers.authorization ?? "";
  const basic = /^Basic +([A-Za-z0-9+/=]+)\s*$/iu.exec(header)?.[1];
  let presented: string | undefined = bearerToken(request);
  if (basic !== undefined) {
    try {
      const decoded = atob(basic);
      presented = decoded.slice(decoded.indexOf(":") + 1);
    } catch {
      presented = undefined;
    }
  }
  return presented !== undefined && sameSecret(presented, Redacted.value(key));
};

const isoFromSeconds = (seconds: number) => isoSeconds(seconds * 1000);

const mint = Effect.fn("relay.collect.mint_token")(function* (installation: string) {
  const settings = yield* CollectSettings;
  const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const minted = CollectTokens.mintCollectToken(settings.tokenSecret, {
    installation,
    expiresAtSeconds: nowSeconds + CollectTokens.COLLECT_TOKEN_TTL_SECONDS,
  });
  return json(200, {
    token: minted.token,
    expiresAt: isoFromSeconds(minted.expiresAtSeconds),
    scope: CollectTokens.COLLECT_TOKEN_SCOPE,
  });
});

const tokenRoute = Effect.fn("relay.collect.token")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const credentials = yield* CollectCredentials;
  const limiter = yield* CollectRateLimiter;
  const caller = yield* credentials.authenticate(request).pipe(Effect.result);
  if (Result.isFailure(caller)) return refuse(503, "credentials_unavailable");
  if (caller.success === undefined) return refuse(401, "not_authorized", BEARER_CHALLENGE);
  if (!(yield* limiter.allowToken(caller.success.rateKey))) {
    return refuse(429, "rate_limited", {
      "retry-after": String(COLLECT_TOKEN_RATE_LIMIT.periodSeconds),
    });
  }
  yield* Effect.annotateCurrentSpan({ "relay.collect.token_issued": true });
  return yield* mint(caller.success.installation);
});

const operatorTokenRoute = Effect.fn("relay.collect.operator_token")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const settings = yield* CollectSettings;
  if (settings.operatorKey === undefined) return refuse(404, "not_found");
  if (!isOperator(request, settings.operatorKey)) {
    return refuse(401, "not_authorized", BEARER_CHALLENGE);
  }
  return yield* mint(CollectTokens.installationBinding("operator", "test"));
});

/** Checks the write key and the installation's rate before anything is stored. */
const admit = Effect.fn("relay.collect.admit")(function* (token: string | undefined) {
  const settings = yield* CollectSettings;
  const limiter = yield* CollectRateLimiter;
  if (token === undefined) return { refused: refuse(401, "missing_token", BEARER_CHALLENGE) };
  const now = yield* Clock.currentTimeMillis;
  const claims = CollectTokens.verifyCollectToken(
    settings.tokenSecret,
    token,
    Math.floor(now / 1000),
  );
  if (claims === undefined) return { refused: refuse(401, "invalid_token", BEARER_CHALLENGE) };
  if (!(yield* limiter.allowCollect(claims.installation))) {
    return {
      refused: refuse(429, "rate_limited", {
        "retry-after": String(COLLECT_RATE_LIMIT.periodSeconds),
      }),
    };
  }
  return { now };
});

const unsupportedEncoding = (request: HttpServerRequest.HttpServerRequest) => {
  const encoding = (request.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  return encoding !== "" && encoding !== "identity";
};

const store = Effect.fn("relay.collect.store")(function* (
  rows: ReadonlyArray<CollectPayloads.CollectRow>,
) {
  const collectStore = yield* CollectStore.CollectStore;
  const stored = yield* collectStore.insert(rows).pipe(Effect.result);
  if (Result.isFailure(stored)) return undefined;
  yield* Effect.annotateCurrentSpan({
    "relay.collect.stored": stored.success.stored,
    "relay.collect.dropped": stored.success.dropped,
  });
  return stored.success;
});

const analyticsRoute = Effect.fn("relay.collect.analytics")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  if (unsupportedEncoding(request)) return refuse(415, "unsupported_content_encoding");
  const headerToken = bearerToken(request);
  if (headerToken !== undefined) {
    const early = yield* admit(headerToken);
    if ("refused" in early) return early.refused;
  }
  const body = yield* readCapped(request, MAX_ANALYTICS_BODY_BYTES).pipe(Effect.result);
  if (Result.isFailure(body)) {
    return body.failure._tag === "BodyTooLarge"
      ? refuse(413, "body_too_large")
      : refuse(400, "invalid_body");
  }
  const now = yield* Clock.currentTimeMillis;
  const parsed = CollectPayloads.parseAnalyticsBatch(
    CollectPayloads.parseJsonBody(body.success),
    now,
  );
  if (parsed === undefined) return refuse(400, "invalid_body");
  if (headerToken === undefined) {
    const admitted = yield* admit(parsed.apiKey);
    if ("refused" in admitted) return admitted.refused;
  }
  const result = yield* store(parsed.rows);
  if (result === undefined) return refuse(503, "storage_unavailable");
  return json(200, { status: 1 });
});

const otlpRoute = Effect.fn("relay.collect.otlp")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const signal = (yield* HttpRouter.params).signal;
  if (signal !== "logs" && signal !== "traces" && signal !== "metrics") {
    return refuse(404, "unknown_signal");
  }
  const contentType = (request.headers["content-type"] ?? "").toLowerCase();
  if (contentType.includes("protobuf")) return refuse(415, "protobuf_not_supported_use_json");
  if (unsupportedEncoding(request)) return refuse(415, "unsupported_content_encoding");
  const admitted = yield* admit(bearerToken(request));
  if ("refused" in admitted) return admitted.refused;
  const body = yield* readCapped(request, MAX_OTLP_BODY_BYTES).pipe(Effect.result);
  if (Result.isFailure(body)) {
    return body.failure._tag === "BodyTooLarge"
      ? refuse(413, "body_too_large")
      : refuse(400, "invalid_body");
  }
  const parsed = CollectPayloads.parseOtlp(
    signal,
    CollectPayloads.parseJsonBody(body.success),
    admitted.now,
  );
  if (parsed === undefined) return refuse(400, "invalid_body");
  const result = yield* store(parsed.rows);
  if (result === undefined) return refuse(503, "storage_unavailable");
  return json(200, CollectPayloads.otlpResponse(signal, parsed.skipped + result.dropped));
});

const operatorPage = (format: "html" | "json") =>
  Effect.fn("relay.collect.operator_summary")(function* (
    request: HttpServerRequest.HttpServerRequest,
  ) {
    const settings = yield* CollectSettings;
    if (settings.operatorKey === undefined) return refuse(404, "not_found");
    if (!isOperator(request, settings.operatorKey)) {
      return refuse(401, "not_authorized", {
        "www-authenticate": 'Basic realm="Catgirl Connect operator", charset="UTF-8"',
      });
    }
    const collectStore = yield* CollectStore.CollectStore;
    const now = yield* Clock.currentTimeMillis;
    const rows = yield* collectStore.summary.pipe(Effect.result);
    if (Result.isFailure(rows)) return refuse(503, "storage_unavailable");
    if (format === "json")
      return json(200, { retentionDays: CollectStore.RETENTION_DAYS, rows: rows.success });
    return HttpServerResponse.text(
      renderSummaryPage({
        serviceName: settings.serviceName,
        relayUrl: settings.relayUrl,
        fingerprint: settings.fingerprint,
        generatedAt: isoFromSeconds(Math.floor(now / 1000)),
        rows: rows.success,
      }),
      {
        contentType: "text/html; charset=utf-8",
        headers: {
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "referrer-policy": "no-referrer",
        },
      },
    );
  });

/** Every collector route; the services above are supplied by the Worker or by a test. `/batch` also matches `/batch/`, where the server posts. */
export const layerRoutes = Layer.mergeAll(
  HttpRouter.add("POST", COLLECT_TOKEN_PATH, tokenRoute),
  HttpRouter.add("POST", OPERATOR_TOKEN_PATH, operatorTokenRoute),
  HttpRouter.add("POST", ANALYTICS_PATH, analyticsRoute),
  HttpRouter.add("POST", `${ANALYTICS_PATH}/batch`, analyticsRoute),
  HttpRouter.add("POST", `${OTLP_PATH}/v1/:signal`, otlpRoute),
  HttpRouter.add("POST", `${OTLP_PATH}/:projectId/v1/:signal`, otlpRoute),
  HttpRouter.add("GET", OPERATOR_PAGE_PATH, operatorPage("html")),
  HttpRouter.add("GET", `${OPERATOR_PAGE_PATH}/summary.json`, operatorPage("json")),
);
