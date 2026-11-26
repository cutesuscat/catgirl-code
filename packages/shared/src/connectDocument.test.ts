// @effect-diagnostics globalDate:off - Test documents are dated, and checked against fixed clocks.
import { ed25519 } from "@noble/curves/ed25519";
import { hexToBytes } from "@noble/hashes/utils";
import type { ConnectServiceTrust } from "@t3tools/contracts";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import vector from "./catgirlConnectDocument.vector.json" with { type: "json" };
import {
  connectDiagnosticsAllowed,
  connectDiagnosticsOffers,
  connectDocumentChanges,
  connectHostedAppUrl,
  connectKeyFingerprint,
  connectRefreshDue,
  connectServiceName,
  declineConnectIdentityChange,
  parseConnectSetupLink,
  pinConnectService,
  refreshConnectTrust,
  setConnectDiagnosticsAnswer,
  verifyConnectDocument,
} from "./connectDocument.ts";

const RELAY = "https://relay.example.com";
const OLD = vector.keys.old;
const NEW = vector.keys.new;
// Inside both test documents' lifetimes (the rotated one starts on 2026-12-01).
const NOW = new Date("2026-12-02T00:00:00Z");

const decodePayload = (payload: string) =>
  JSON.parse(Result.getOrThrow(Base64Url.decodeString(payload))) as Record<string, unknown>;

const VALID_PAYLOAD = decodePayload(vector.cases.valid.envelope.payload);

/** Signs any payload with a TEST-ONLY seed from the vector, as a relay would. */
function sign(payload: unknown, seedHex: string) {
  const seed = hexToBytes(seedHex);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    payload: Base64Url.encode(bytes),
    signature: Base64Url.encode(ed25519.sign(bytes, seed)),
    key: Base64Url.encode(ed25519.getPublicKey(seed)),
  };
}

const signOld = (changes: Record<string, unknown>) =>
  sign({ ...VALID_PAYLOAD, ...changes }, OLD.seedHex);

describe("the coordinator's test vector", () => {
  it("derives both fingerprints", () => {
    expect(connectKeyFingerprint(OLD.publicKey)).toBe(OLD.fingerprint);
    expect(connectKeyFingerprint(NEW.publicKey)).toBe(NEW.fingerprint);
  });

  it("valid: applies with the pinned key", () => {
    const check = verifyConnectDocument(vector.cases.valid.envelope, {
      relayUrl: RELAY,
      pinnedKey: vector.cases.valid.pinnedKey,
      now: NOW,
    });
    expect(check).toMatchObject({ _tag: "Apply", key: OLD.publicKey, rotatedFrom: null });
    if (check._tag === "Apply") expect(check.document.service?.name).toBe("Example cats");
  });

  it("rotated: applies and pins the new key the old one endorsed", () => {
    const check = verifyConnectDocument(vector.cases.rotated.envelope, {
      relayUrl: RELAY,
      pinnedKey: vector.cases.rotated.pinnedKey,
      now: NOW,
    });
    expect(check).toMatchObject({
      _tag: "Apply",
      key: NEW.publicKey,
      rotatedFrom: OLD.publicKey,
    });
  });

  it("identityChanged: a new key with no endorsement applies nothing", () => {
    const check = verifyConnectDocument(vector.cases.identityChanged.envelope, {
      relayUrl: RELAY,
      pinnedKey: vector.cases.identityChanged.pinnedKey,
      now: NOW,
    });
    expect(check).toMatchObject({
      _tag: "IdentityChanged",
      key: NEW.publicKey,
      pinnedKey: OLD.publicKey,
    });
  });

  it("badSignature: a payload altered after signing is rejected before it is read", () => {
    const check = verifyConnectDocument(vector.cases.badSignature.envelope, {
      relayUrl: "https://evil.example.com",
      pinnedKey: vector.cases.badSignature.pinnedKey,
      now: NOW,
    });
    expect(check).toEqual({ _tag: "Rejected", problem: "bad-signature" });
  });

  it("an endorsement that does not verify is an identity change, not a rotation", () => {
    const payload = decodePayload(vector.cases.rotated.envelope.payload);
    const rotation = payload.keyRotation as { previousKey: string; endorsement: string };
    const forged = sign(
      {
        ...payload,
        keyRotation: { ...rotation, endorsement: Base64Url.encode(new Uint8Array(64)) },
      },
      NEW.seedHex,
    );
    expect(
      verifyConnectDocument(forged, { relayUrl: RELAY, pinnedKey: OLD.publicKey, now: NOW })._tag,
    ).toBe("IdentityChanged");
  });
});

describe("first use", () => {
  it("applies any well-signed document and pins its key", () => {
    const check = verifyConnectDocument(vector.cases.identityChanged.envelope, {
      relayUrl: RELAY,
      pinnedKey: null,
      now: NOW,
    });
    expect(check).toMatchObject({ _tag: "Apply", key: NEW.publicKey });
  });

  it("a setup link's fingerprint must match", () => {
    const options = { relayUrl: RELAY, pinnedKey: null, now: NOW };
    const link = parseConnectSetupLink(`${RELAY}/#fp=${OLD.fingerprint.replaceAll(" ", "")}`);
    expect(link).toEqual({ address: `${RELAY}/`, fingerprint: "34750f98bd59fcfc" });
    expect(
      verifyConnectDocument(vector.cases.valid.envelope, {
        ...options,
        expectedFingerprint: link.fingerprint,
      })._tag,
    ).toBe("Apply");
    expect(
      verifyConnectDocument(vector.cases.identityChanged.envelope, {
        ...options,
        expectedFingerprint: link.fingerprint,
      }),
    ).toEqual({ _tag: "Rejected", problem: "fingerprint-mismatch" });
  });

  it("a malformed fingerprint in a link can only refuse", () => {
    const link = parseConnectSetupLink(`${RELAY}#fp=nonsense`);
    expect(
      verifyConnectDocument(vector.cases.valid.envelope, {
        relayUrl: RELAY,
        pinnedKey: null,
        expectedFingerprint: link.fingerprint,
        now: NOW,
      }),
    ).toEqual({ _tag: "Rejected", problem: "fingerprint-mismatch" });
    expect(parseConnectSetupLink(" https://relay.example.com ")).toEqual({
      address: RELAY,
      fingerprint: null,
    });
  });
});

describe("the document's own rules", () => {
  const check = (envelope: unknown, now = NOW) =>
    verifyConnectDocument(envelope, { relayUrl: RELAY, pinnedKey: OLD.publicKey, now });

  it("an expired document is not applied", () => {
    expect(check(vector.cases.valid.envelope, new Date("2026-12-26T03:00:01Z"))).toEqual({
      _tag: "Rejected",
      problem: "expired",
    });
  });

  it("relayUrl must be the address it was fetched from", () => {
    expect(
      verifyConnectDocument(vector.cases.valid.envelope, {
        relayUrl: "https://relay.other.example",
        pinnedKey: OLD.publicKey,
        now: NOW,
      }),
    ).toEqual({ _tag: "Rejected", problem: "relay-mismatch" });
    expect(check(signOld({ relayUrl: "https://relay.example.com/" }))._tag).toBe("Apply");
  });

  it("lives at most 60 days, and not from far in the future", () => {
    expect(check(signOld({ expiresAt: "2027-01-26T03:00:00Z" }))).toEqual({
      _tag: "Rejected",
      problem: "lifetime",
    });
    expect(
      check(signOld({ issuedAt: "2027-01-01T00:00:00Z", expiresAt: "2027-02-01T00:00:00Z" })),
    ).toEqual({ _tag: "Rejected", problem: "not-yet-valid" });
    expect(check(signOld({ issuedAt: "yesterday" }))).toEqual({
      _tag: "Rejected",
      problem: "malformed",
    });
  });

  it("ignores fields it does not know, anywhere", () => {
    const result = check(
      signOld({
        futureBlock: { anything: true },
        service: { name: "Example cats", logo: "https://example.com/cat.png" },
        diagnostics: { analytics: { url: `${RELAY}/a`, format: "posthog-batch", region: "eu" } },
      }),
    );
    expect(result._tag).toBe("Apply");
    if (result._tag === "Apply") {
      expect(connectDiagnosticsOffers(result.document).analytics?.url).toBe(`${RELAY}/a`);
    }
  });

  it("a version other than 2 is not used", () => {
    expect(check(signOld({ version: 3, signIn: { provider: "other" } }))).toEqual({
      _tag: "Rejected",
      problem: "unsupported-version",
    });
  });

  it("rejects envelopes it cannot read", () => {
    expect(check({ payload: "x" })).toEqual({ _tag: "Rejected", problem: "malformed" });
    expect(check({ ...vector.cases.valid.envelope, key: "c2hvcnQ" })).toEqual({
      _tag: "Rejected",
      problem: "malformed",
    });
    expect(check({ ...signOld({}), payload: Base64Url.encode(new Uint8Array([0xff])) })).toEqual({
      _tag: "Rejected",
      problem: "bad-signature",
    });
  });
});

describe("what a document offers", () => {
  it("offers only https addresses in the formats this app sends, with Connect sign-in", () => {
    const result = verifyConnectDocument(
      signOld({
        diagnostics: {
          analytics: {
            url: "http://relay.example.com/a",
            format: "posthog-batch",
            auth: "connect",
          },
          crashReports: { url: `${RELAY}/c`, format: "sentry", auth: "connect" },
          traces: { url: `${RELAY}/t`, format: "otlp-http", auth: "connect" },
        },
      }),
      { relayUrl: RELAY, pinnedKey: OLD.publicKey, now: NOW },
    );
    if (result._tag !== "Apply") throw new Error(result._tag);
    expect(Object.keys(connectDiagnosticsOffers(result.document))).toEqual(["traces"]);
  });

  it("names the service, or its host", () => {
    const document = decodePayload(vector.cases.valid.envelope.payload) as never;
    expect(connectServiceName(document, RELAY)).toBe("Example cats");
    expect(connectServiceName(undefined, RELAY)).toBe("relay.example.com");
    expect(connectHostedAppUrl(document)).toBe("https://app.example.com");
  });
});

function trustFromValid(): ConnectServiceTrust {
  const check = verifyConnectDocument(vector.cases.valid.envelope, {
    relayUrl: RELAY,
    pinnedKey: null,
    now: NOW,
  });
  if (check._tag !== "Apply") throw new Error(check._tag);
  return pinConnectService(check, new Date("2026-11-30T00:00:00Z"));
}

describe("later checks of a pinned service", () => {
  const refresh = (trust: ConnectServiceTrust, envelope: unknown) =>
    refreshConnectTrust(trust, { _tag: "Envelope", envelope }, { relayUrl: RELAY, now: NOW });

  it("rotation pins the new key and says so under Recent changes", () => {
    const result = refresh(trustFromValid(), vector.cases.rotated.envelope);
    expect(result.outcome).toBe("rotated");
    expect(result.trust.key).toBe(NEW.publicKey);
    expect(result.trust.recentChanges?.[0]).toMatchObject({
      kind: "key-rotated",
      from: OLD.fingerprint,
      to: NEW.fingerprint,
    });
  });

  it("an identity change keeps the last good document and remembers what it saw", () => {
    const before = trustFromValid();
    const result = refresh(before, vector.cases.identityChanged.envelope);
    expect(result.outcome).toBe("identity-changed");
    expect(result.trust.key).toBe(OLD.publicKey);
    expect(result.trust.document).toEqual(before.document);
    expect(result.trust.identityChange?.envelope.key).toBe(NEW.publicKey);
    const declined = declineConnectIdentityChange(result.trust);
    expect(
      refresh(declined, vector.cases.identityChanged.envelope).trust.identityChange?.declined,
    ).toBe(true);
  });

  it("a bad signature, an expired document or no answer keeps the last good one", () => {
    const before = trustFromValid();
    expect(refresh(before, vector.cases.badSignature.envelope)).toMatchObject({
      outcome: "problem",
      trust: { refreshProblem: "invalid", document: before.document },
    });
    expect(
      refreshConnectTrust(
        before,
        { _tag: "Envelope", envelope: vector.cases.valid.envelope },
        {
          relayUrl: RELAY,
          now: new Date("2027-01-01T00:00:00Z"),
        },
      ),
    ).toMatchObject({ outcome: "problem", trust: { refreshProblem: "expired" } });
    expect(
      refreshConnectTrust(before, { _tag: "Unreachable" }, { relayUrl: RELAY, now: NOW }).trust
        .refreshProblem,
    ).toBe("unreachable");
  });

  it("changes outside sign-in apply quietly and are listed", () => {
    const signIn = VALID_PAYLOAD.signIn as Record<string, unknown>;
    const result = refresh(
      trustFromValid(),
      signOld({
        issuedAt: "2026-12-01T00:00:00Z",
        service: { name: "Example cats 2" },
        signIn: { ...signIn, hostedAppUrl: null },
        diagnostics: {
          traces: { url: `${RELAY}/v1/collect/otlp`, format: "otlp-http", auth: "connect" },
        },
      }),
    );
    expect(result.outcome).toBe("applied");
    expect(result.trust.pending).toBeUndefined();
    expect(result.trust.recentChanges?.map((change) => [change.kind, change.diagnostics])).toEqual([
      ["name", undefined],
      ["contact", undefined],
      ["privacy", undefined],
      ["hosted-app", undefined],
      ["offer-removed", "analytics"],
      ["offer-removed", "crashReports"],
      ["offer-added", "traces"],
    ]);
  });

  it("a sign-in change waits for a restart", () => {
    const signIn = VALID_PAYLOAD.signIn as Record<string, unknown>;
    const before = trustFromValid();
    const result = refresh(before, signOld({ signIn: { ...signIn, jwtTemplate: "other" } }));
    expect(result.outcome).toBe("restart-needed");
    expect(result.trust.document).toEqual(before.document);
    expect(result.trust.pending?.document.signIn.jwtTemplate).toBe("other");
  });

  it("an older document than the one in use changes nothing", () => {
    const result = refresh(
      trustFromValid(),
      signOld({ issuedAt: "2026-11-01T00:00:00Z", service: { name: "Old name" } }),
    );
    expect(result.outcome).toBe("unchanged");
    expect(result.trust.document.service?.name).toBe("Example cats");
  });

  it("is due once a day, or after a failed try", () => {
    const trust = trustFromValid();
    expect(connectRefreshDue(trust, new Date("2026-11-30T12:00:00Z"))).toBe(false);
    expect(connectRefreshDue(trust, new Date("2026-12-01T00:00:00Z"))).toBe(true);
    expect(
      connectRefreshDue(
        { ...trust, refreshProblem: "unreachable" },
        new Date("2026-11-30T01:00:00Z"),
      ),
    ).toBe(true);
  });
});

describe("the person's answer to each offer", () => {
  it("is no until they say yes, and only while it is offered", () => {
    const trust = trustFromValid();
    expect(connectDiagnosticsAllowed(trust, "analytics")).toBe(false);
    const yes = setConnectDiagnosticsAnswer(trust, "analytics", true);
    expect(connectDiagnosticsAllowed(yes, "analytics")).toBe(true);
    expect(connectDiagnosticsAllowed(yes, "crashReports")).toBe(false);
    expect(connectDiagnosticsAllowed(yes, "traces")).toBe(false);
    const { diagnostics: _none, ...withoutOffers } = yes.document;
    expect(connectDiagnosticsAllowed({ ...yes, document: withoutOffers }, "analytics")).toBe(false);
  });

  it("lists every difference between two documents", () => {
    const document = trustFromValid().document;
    expect(connectDocumentChanges(document, document, NOW.toISOString())).toEqual([]);
  });
});
