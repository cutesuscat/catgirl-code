import { describe, expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/http/HttpRouter";
import type * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as CollectRoutes from "./CollectRoutes.ts";
import * as CollectStore from "./CollectStore.ts";
import * as CollectTokens from "./CollectTokens.ts";

const RELAY = "https://relay.example.test";
const NOW = Date.parse("2026-11-26T12:00:00Z");
const OPERATOR_KEY = "operator-key-for-tests";
const SECRET = new TextEncoder().encode("collect-route-test-secret");

interface Harness {
  readonly limited: Set<string>;
  readonly credentialsDown: { current: boolean };
}

const layerSqliteStore = Layer.effect(
  CollectStore.CollectStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* CollectStore.migrate;
    const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
      effect.pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.mapError((cause) => new CollectStore.CollectStoreUnavailable({ cause })),
      );
    return CollectStore.CollectStore.of({
      insert: (rows) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => run(CollectStore.insert(rows, now))),
      summary: Effect.flatMap(Clock.currentTimeMillis, (now) => run(CollectStore.summary(now))),
    });
  }),
).pipe(Layer.provide(NodeSqliteClient.layer({ filename: ":memory:" })));

/** The routes with a real store, a stand-in for the relay's credential checks, and a limiter. */
const makeRelay = (
  harness: Harness,
  options: { readonly operatorKey?: string } = { operatorKey: OPERATOR_KEY },
) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(
      CollectRoutes.layerRoutes.pipe(
        HttpRouter.provideRequest(
          Layer.mergeAll(
            Layer.succeed(CollectRoutes.CollectSettings, {
              tokenSecret: SECRET,
              operatorKey:
                options.operatorKey === undefined ? undefined : Redacted.make(options.operatorKey),
              serviceName: "Test cats",
              relayUrl: RELAY,
              fingerprint: "3475 0f98 bd59 fcfc",
            }),
            Layer.succeed(CollectRoutes.CollectCredentials, {
              authenticate: (request) =>
                harness.credentialsDown.current
                  ? Effect.fail(
                      new CollectRoutes.CollectCredentialsUnavailable({ cause: "db down" }),
                    )
                  : Effect.succeed(
                      request.headers.authorization === "Bearer t3env_machine_secret"
                        ? {
                            rateKey: "environment:env-1",
                            installation: CollectTokens.installationBinding("environment", "env-1"),
                          }
                        : undefined,
                    ),
            }),
            Layer.succeed(CollectRoutes.CollectRateLimiter, {
              allowToken: (key) => Effect.succeed(!harness.limited.has(key)),
              allowCollect: (key) => Effect.succeed(!harness.limited.has(key)),
            }),
            layerSqliteStore,
          ),
        ),
      ),
    );
    return (request: Request) =>
      handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(request),
        ),
        Effect.map((response) => HttpServerResponse.toWeb(response)),
        Effect.scoped,
      );
  });

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${RELAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const jsonOf = (response: Response) =>
  Effect.promise(() => response.json() as Promise<Record<string, unknown>>);

const freshHarness = (): Harness => ({ limited: new Set(), credentialsDown: { current: false } });

const getToken = (
  fetch: (request: Request) => Effect.Effect<Response, HttpServerError.HttpServerError>,
) =>
  Effect.gen(function* () {
    const response = yield* fetch(
      post(CollectRoutes.COLLECT_TOKEN_PATH, {}, { authorization: "Bearer t3env_machine_secret" }),
    );
    expect(response.status).toBe(200);
    return String((yield* jsonOf(response)).token);
  });

describe("POST /v1/collect/token", () => {
  it.effect("gives a signed-in machine an hour-long write key", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fetch = yield* makeRelay(freshHarness());
      const response = yield* fetch(
        post(
          CollectRoutes.COLLECT_TOKEN_PATH,
          {},
          { authorization: "Bearer t3env_machine_secret" },
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = yield* jsonOf(response);
      expect(body).toMatchObject({ expiresAt: "2026-11-26T13:00:00Z", scope: "collect" });
      expect(
        CollectTokens.verifyCollectToken(SECRET, String(body.token), NOW / 1000),
      ).toBeDefined();
    }).pipe(Effect.scoped),
  );

  it.effect("refuses callers without a relay credential, and says why", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = freshHarness();
      const fetch = yield* makeRelay(harness);
      const none = yield* fetch(post(CollectRoutes.COLLECT_TOKEN_PATH, {}));
      expect(none.status).toBe(401);
      expect(none.headers.get("www-authenticate")).toContain("Bearer");
      const wrong = yield* fetch(
        post(CollectRoutes.COLLECT_TOKEN_PATH, {}, { authorization: "Bearer someone-else" }),
      );
      expect([wrong.status, yield* jsonOf(wrong)]).toEqual([401, { error: "not_authorized" }]);
      harness.limited.add("environment:env-1");
      const limited = yield* fetch(
        post(
          CollectRoutes.COLLECT_TOKEN_PATH,
          {},
          { authorization: "Bearer t3env_machine_secret" },
        ),
      );
      expect([limited.status, limited.headers.get("retry-after")]).toEqual([429, "60"]);
      harness.limited.clear();
      harness.credentialsDown.current = true;
      const down = yield* fetch(
        post(
          CollectRoutes.COLLECT_TOKEN_PATH,
          {},
          { authorization: "Bearer t3env_machine_secret" },
        ),
      );
      expect(down.status).toBe(503);
    }).pipe(Effect.scoped),
  );
});

const heartbeat = (token?: string) => ({
  ...(token === undefined ? {} : { api_key: token }),
  batch: [
    {
      uuid: "u-1",
      event: "server.boot.heartbeat",
      distinct_id: "install-1",
      properties: { installId: "install-1", t3CodeVersion: "1.12.3" },
      timestamp: "2026-11-26T11:59:00.000Z",
    },
  ],
});

const crashReport = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.version", value: { stringValue: "2.0.0-selfhost.10" } },
          { key: "expo.eas_client.id", value: { stringValue: "phone-1" } },
        ],
      },
      scopeLogs: [
        {
          logRecords: [
            {
              severityText: "ERROR",
              attributes: [{ key: "expo.error.source", value: { stringValue: "jsError" } }],
            },
          ],
        },
      ],
    },
  ],
};

const operatorAuth = (key = OPERATOR_KEY) => ({
  authorization: `Basic ${btoa(`operator:${key}`)}`,
});

describe("the collectors", () => {
  it.effect(
    "store the server's analytics batch, with the key in the body as the server sends it",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const fetch = yield* makeRelay(freshHarness());
        const token = yield* getToken(fetch);
        const viaBody = yield* fetch(
          post(`${CollectRoutes.ANALYTICS_PATH}/batch/`, heartbeat(token)),
        );
        expect([viaBody.status, yield* jsonOf(viaBody)]).toEqual([200, { status: 1 }]);
        const viaHeader = yield* fetch(
          post(CollectRoutes.ANALYTICS_PATH, heartbeat(), { authorization: `Bearer ${token}` }),
        );
        expect(viaHeader.status).toBe(200);
        const summary = yield* fetch(
          new Request(`${RELAY}/operator/summary.json`, { headers: operatorAuth() }),
        );
        expect(yield* jsonOf(summary)).toEqual({
          retentionDays: 30,
          rows: [
            {
              day: "2026-11-26",
              kind: "analytics",
              event: "server.boot.heartbeat",
              appVersion: "1.12.3",
              events: 2,
              installs: 1,
            },
          ],
        });
      }).pipe(Effect.scoped),
  );

  it.effect("store the phone's OTLP crash reports at the path expo-observe uses", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fetch = yield* makeRelay(freshHarness());
      const token = yield* getToken(fetch);
      const expoPath = yield* fetch(
        post(
          `${CollectRoutes.OTLP_PATH}/00000000-0000-0000-0000-000000000000/v1/logs`,
          crashReport,
          { authorization: `Bearer ${token}` },
        ),
      );
      expect([expoPath.status, yield* jsonOf(expoPath)]).toEqual([200, {}]);
      const plainPath = yield* fetch(
        post(`${CollectRoutes.OTLP_PATH}/v1/logs`, crashReport, {
          authorization: `Bearer ${token}`,
        }),
      );
      expect(plainPath.status).toBe(200);
      const page = yield* fetch(
        new Request(`${RELAY}${CollectRoutes.OPERATOR_PAGE_PATH}`, { headers: operatorAuth() }),
      );
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      const html = yield* Effect.promise(() => page.text());
      expect(html).toContain("<code>jsError</code>");
      expect(html).toContain("2.0.0-selfhost.10");
      expect(html).not.toContain("phone-1");
    }).pipe(Effect.scoped),
  );

  it.effect("refuse anything without a valid write key, and what they cannot read", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = freshHarness();
      const fetch = yield* makeRelay(harness);
      const token = yield* getToken(fetch);
      const auth = { authorization: `Bearer ${token}` };
      const cases: Array<[Request, number, string]> = [
        [post(CollectRoutes.ANALYTICS_PATH, heartbeat()), 401, "missing_token"],
        [post(CollectRoutes.ANALYTICS_PATH, heartbeat("cgc1.forged.token")), 401, "invalid_token"],
        [post(`${CollectRoutes.OTLP_PATH}/v1/logs`, crashReport), 401, "missing_token"],
        [
          post(`${CollectRoutes.OTLP_PATH}/v1/logs`, crashReport, {
            authorization: "Bearer t3env_machine_secret",
          }),
          401,
          "invalid_token",
        ],
        [post(CollectRoutes.ANALYTICS_PATH, "{not json", auth), 400, "invalid_body"],
        [
          post(
            CollectRoutes.ANALYTICS_PATH,
            "x".repeat(CollectRoutes.MAX_ANALYTICS_BODY_BYTES + 1),
            auth,
          ),
          413,
          "body_too_large",
        ],
        [
          post(CollectRoutes.ANALYTICS_PATH, heartbeat(), { ...auth, "content-encoding": "gzip" }),
          415,
          "unsupported_content_encoding",
        ],
        [
          post(`${CollectRoutes.OTLP_PATH}/v1/logs`, "", {
            ...auth,
            "content-type": "application/x-protobuf",
          }),
          415,
          "protobuf_not_supported_use_json",
        ],
        [post(`${CollectRoutes.OTLP_PATH}/v1/profiles`, crashReport, auth), 404, "unknown_signal"],
      ];
      for (const [request, status, error] of cases) {
        const response = yield* fetch(request);
        expect([request.url, response.status, (yield* jsonOf(response)).error]).toEqual([
          request.url,
          status,
          error,
        ]);
      }
      yield* TestClock.adjust("61 minutes");
      const expired = yield* fetch(post(CollectRoutes.ANALYTICS_PATH, heartbeat(), auth));
      expect(expired.status).toBe(401);
    }).pipe(Effect.scoped),
  );
});

describe("the operator's page", () => {
  it.effect("asks for the operator key and refuses everyone else", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fetch = yield* makeRelay(freshHarness());
      const anonymous = yield* fetch(new Request(`${RELAY}${CollectRoutes.OPERATOR_PAGE_PATH}`));
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("www-authenticate")).toContain("Basic");
      const wrong = yield* fetch(
        new Request(`${RELAY}${CollectRoutes.OPERATOR_PAGE_PATH}`, {
          headers: operatorAuth("guess"),
        }),
      );
      expect(wrong.status).toBe(401);
      const bearer = yield* fetch(
        new Request(`${RELAY}${CollectRoutes.OPERATOR_PAGE_PATH}/summary.json`, {
          headers: { authorization: `Bearer ${OPERATOR_KEY}` },
        }),
      );
      expect(bearer.status).toBe(200);
      const minted = yield* fetch(post(CollectRoutes.OPERATOR_TOKEN_PATH, {}, operatorAuth()));
      expect(minted.status).toBe(200);
      const notOperator = yield* fetch(
        post(
          CollectRoutes.OPERATOR_TOKEN_PATH,
          {},
          { authorization: "Bearer t3env_machine_secret" },
        ),
      );
      expect(notOperator.status).toBe(401);
    }).pipe(Effect.scoped),
  );

  it.effect("does not exist on a relay without an operator key", () =>
    Effect.gen(function* () {
      const fetch = yield* makeRelay(freshHarness(), {});
      const page = yield* fetch(
        new Request(`${RELAY}${CollectRoutes.OPERATOR_PAGE_PATH}`, { headers: operatorAuth() }),
      );
      expect(page.status).toBe(404);
      const token = yield* fetch(post(CollectRoutes.OPERATOR_TOKEN_PATH, {}, operatorAuth()));
      expect(token.status).toBe(404);
    }).pipe(Effect.scoped),
  );
});
