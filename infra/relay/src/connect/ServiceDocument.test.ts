import { describe, expect, it } from "@effect/vitest";
import { ed25519 } from "@noble/curves/ed25519";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Base64Url from "effect/encoding/Base64Url";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as TestClock from "effect/testing/TestClock";

import * as ServiceDocument from "./ServiceDocument.ts";
import vector from "./catgirlConnectDocument.vector.json" with { type: "json" };

const bytes = (text: string) => {
  const decoded = Base64Url.decode(text);
  if (Result.isFailure(decoded)) throw new Error(`not base64url: ${text}`);
  return decoded.success;
};
const seed = (hex: string) =>
  Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
const OLD = seed(vector.keys.old.seedHex);
const NEW = seed(vector.keys.new.seedHex);

type Outcome =
  | { readonly _tag: "apply"; readonly pin: string; readonly payload: Record<string, unknown> }
  | { readonly _tag: "identity-changed" }
  | { readonly _tag: "reject"; readonly reason: string };

/**
 * What an app does with an envelope, written from SPEC.md: verify the signature over the
 * payload bytes before parsing, then the version, the address and the expiry, then the key.
 */
function verifyEnvelope(
  envelope: ServiceDocument.ServiceDocumentEnvelope,
  input: {
    readonly pinnedKey: string | undefined;
    readonly fetchedFrom: string;
    readonly now: number;
  },
): Outcome {
  const payloadBytes = bytes(envelope.payload);
  if (!ed25519.verify(bytes(envelope.signature), payloadBytes, bytes(envelope.key))) {
    return { _tag: "reject", reason: "signature" };
  }
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
  if (payload.version !== 2) return { _tag: "reject", reason: "version" };
  if (payload.relayUrl !== new URL(input.fetchedFrom).origin)
    return { _tag: "reject", reason: "relayUrl" };
  const issuedAt = Date.parse(String(payload.issuedAt));
  const expiresAt = Date.parse(String(payload.expiresAt));
  if (!(expiresAt > input.now) || expiresAt - issuedAt > 60 * 24 * 3600 * 1000) {
    return { _tag: "reject", reason: "expiry" };
  }
  if (input.pinnedKey === undefined || input.pinnedKey === envelope.key) {
    return { _tag: "apply", pin: envelope.key, payload };
  }
  const rotation = payload.keyRotation as
    | { previousKey?: string; endorsement?: string }
    | undefined;
  if (
    rotation?.previousKey === input.pinnedKey &&
    rotation.endorsement !== undefined &&
    ed25519.verify(bytes(rotation.endorsement), bytes(envelope.key), bytes(input.pinnedKey))
  ) {
    return { _tag: "apply", pin: envelope.key, payload };
  }
  return { _tag: "identity-changed" };
}

const expectedTag = {
  apply: "apply",
  "apply-and-pin-new-key": "apply",
  "identity-changed": "identity-changed",
  reject: "reject",
} as const;

const jsonOf = (response: Response) =>
  Effect.promise(() => response.json() as Promise<Record<string, unknown>>);

const AT_VECTOR_TIME = Date.parse("2026-12-02T00:00:00Z");
const VECTOR_RELAY = "https://relay.example.com";

/** Settings that describe the vector's instance, as a relay operator would configure it. */
const exampleSettings = (
  keys: ServiceDocument.ServiceDocumentKeys,
): ServiceDocument.ServiceDocumentSettings => ({
  relayUrl: VECTOR_RELAY,
  keys,
  service: {
    name: "Example cats",
    operatorContact: "https://example.com/contact",
    privacyPolicyUrl: "https://example.com/privacy",
  },
  signIn: {
    publishableKey: "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
    jwtTemplate: "t3-relay",
    cliOAuthClientId: "example-client",
    hostedAppUrl: "https://app.example.com",
  },
  offerDiagnostics: ["analytics", "crashReports"],
  lifetimeHours: 30 * 24,
});

describe("the contract's test vector", () => {
  it.each(Object.entries(vector.cases))(
    "%s: an app following SPEC.md reaches the expected outcome",
    (_name, testCase) => {
      const outcome = verifyEnvelope(testCase.envelope, {
        pinnedKey: testCase.pinnedKey,
        fetchedFrom: VECTOR_RELAY,
        now: AT_VECTOR_TIME,
      });
      expect(outcome._tag).toBe(expectedTag[testCase.expect as keyof typeof expectedTag]);
      if (testCase.expect === "apply-and-pin-new-key" && outcome._tag === "apply") {
        expect(outcome.pin).toBe(vector.keys.new.publicKey);
      }
    },
  );

  it("derives the vector's keys and fingerprints", () => {
    expect(Base64Url.encode(ServiceDocument.publicKeyOf(OLD))).toBe(vector.keys.old.publicKey);
    expect(ServiceDocument.fingerprintOf(ServiceDocument.publicKeyOf(OLD))).toBe(
      vector.keys.old.fingerprint,
    );
    expect(ServiceDocument.fingerprintOf(ServiceDocument.publicKeyOf(NEW))).toBe(
      vector.keys.new.fingerprint,
    );
    expect(ServiceDocument.setupLinkOf(`${VECTOR_RELAY}/`, ServiceDocument.publicKeyOf(OLD))).toBe(
      `${VECTOR_RELAY}/#fp=${vector.keys.old.fingerprint.replaceAll(" ", "")}`,
    );
  });

  it("builds the vector's valid document byte for byte from relay settings", () => {
    const envelope = ServiceDocument.makeEnvelope(
      exampleSettings({ signingSeed: OLD }),
      Date.parse("2026-11-26T03:00:00Z"),
    );
    expect(envelope).toEqual(vector.cases.valid.envelope);
  });

  it("builds the vector's rotated document byte for byte, endorsed by the old key", () => {
    const envelope = ServiceDocument.makeEnvelope(
      exampleSettings({ signingSeed: NEW, previousSigningSeed: OLD }),
      Date.parse("2026-12-01T03:00:00Z"),
    );
    expect(envelope).toEqual(vector.cases.rotated.envelope);
  });
});

describe("signing keys", () => {
  it("reads a seed as Alchemy's hex or as base64url, and nothing else", () => {
    expect(ServiceDocument.parseSigningSeed(vector.keys.old.seedHex)).toEqual(OLD);
    expect(ServiceDocument.parseSigningSeed(` ${Base64Url.encode(NEW)} `)).toEqual(NEW);
    expect(ServiceDocument.parseSigningSeed("abc")).toBeUndefined();
    expect(ServiceDocument.parseSigningSeed(Base64Url.encode(new Uint8Array(31)))).toBeUndefined();
  });
});

const RELAY = "https://relay.example.test";
const SETTINGS: ServiceDocument.ServiceDocumentSettings = {
  relayUrl: RELAY,
  keys: { signingSeed: OLD },
  service: { name: "Test cats", privacyPolicyUrl: "http://not-https.example.test/privacy" },
  signIn: {
    publishableKey: `pk_live_${btoa("clerk.example.test$")}`,
    jwtTemplate: "t3-relay",
    cliOAuthClientId: undefined,
  },
  offerDiagnostics: ["analytics", "crashReports", "traces"],
};

/** Runs the route in the test's own fiber, so the test clock applies. */
const relay = (settings: ServiceDocument.ServiceDocumentSettings) =>
  Effect.map(
    HttpRouter.toHttpEffect(ServiceDocument.layerRoute(settings)),
    (handler) => (url: string) =>
      handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request(url)),
        ),
        Effect.map((response) => HttpServerResponse.toWeb(response)),
        Effect.scoped,
      ),
  );

describe("the document route", () => {
  it.effect("serves a document the apps accept, signed for the current hour", () =>
    Effect.gen(function* () {
      const now = Date.parse("2026-11-26T10:41:07Z");
      yield* TestClock.setTime(now);
      const fetch = yield* relay(SETTINGS);
      const response = yield* fetch(`${RELAY}${ServiceDocument.SERVICE_DOCUMENT_PATH}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
      const envelope = (yield* jsonOf(
        response,
      )) as unknown as ServiceDocument.ServiceDocumentEnvelope;
      const outcome = verifyEnvelope(envelope, { pinnedKey: undefined, fetchedFrom: RELAY, now });
      expect(outcome._tag).toBe("apply");
      if (outcome._tag !== "apply") return;
      expect(outcome.payload).toEqual({
        version: 2,
        issuedAt: "2026-11-26T10:00:00Z",
        expiresAt: "2026-12-03T10:00:00Z",
        relayUrl: RELAY,
        service: { name: "Test cats" },
        signIn: {
          provider: "clerk",
          publishableKey: SETTINGS.signIn.publishableKey,
          jwtTemplate: "t3-relay",
        },
        diagnostics: {
          analytics: {
            url: `${RELAY}/v1/collect/analytics`,
            format: "posthog-batch",
            auth: "connect",
          },
          crashReports: { url: `${RELAY}/v1/collect/otlp`, format: "otlp-http", auth: "connect" },
          traces: { url: `${RELAY}/v1/collect/otlp`, format: "otlp-http", auth: "connect" },
        },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("renews itself: a later hour gets a newer document from the same key", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-26T10:59:59Z"));
      const fetch = yield* relay(SETTINGS);
      const url = `${RELAY}${ServiceDocument.SERVICE_DOCUMENT_PATH}`;
      const first = (yield* jsonOf(
        yield* fetch(url),
      )) as unknown as ServiceDocument.ServiceDocumentEnvelope;
      yield* TestClock.adjust("2 seconds");
      const second = (yield* jsonOf(
        yield* fetch(url),
      )) as unknown as ServiceDocument.ServiceDocumentEnvelope;
      expect(second.key).toBe(first.key);
      expect(second.payload).not.toBe(first.payload);
      const issued = JSON.parse(new TextDecoder().decode(bytes(second.payload))).issuedAt;
      expect(issued).toBe("2026-11-26T11:00:00Z");
    }).pipe(Effect.scoped),
  );

  it("never claims more than 60 days, and offers nothing it was not asked to", () => {
    const envelope = ServiceDocument.makeEnvelope(
      { ...SETTINGS, lifetimeHours: 24 * 365, offerDiagnostics: [] },
      Date.parse("2026-11-26T00:00:00Z"),
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes(envelope!.payload)));
    expect(payload.expiresAt).toBe("2027-01-25T00:00:00Z");
    expect(payload.diagnostics).toBeUndefined();
  });

  it.effect("publishes nothing until the relay has its sign-in values", () =>
    Effect.gen(function* () {
      const fetch = yield* relay({
        ...SETTINGS,
        signIn: { ...SETTINGS.signIn, jwtTemplate: undefined },
      });
      const response = yield* fetch(`${RELAY}${ServiceDocument.SERVICE_DOCUMENT_PATH}`);
      expect(response.status).toBe(404);
    }).pipe(Effect.scoped),
  );
});
