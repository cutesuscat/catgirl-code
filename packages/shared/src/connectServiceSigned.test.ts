// @effect-diagnostics globalDate:off - Test documents are dated, and checked against fixed clocks.
import { ed25519 } from "@noble/curves/ed25519";
import { hexToBytes } from "@noble/hashes/utils";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import vector from "./catgirlConnectDocument.vector.json" with { type: "json" };
import { setConnectDiagnosticsAnswer } from "./connectDocument.ts";
import {
  checkConnectService,
  connectServiceAfterRestart,
  connectServiceNeedsRestart,
  type ConnectServiceFetch,
  readConnectServiceSettings,
  refreshConnectService,
} from "./connectService.ts";

const RELAY = "https://relay.example.com";
const NOW = new Date("2026-12-02T00:00:00Z");
const EMPTY = { clerkPublishableKey: "", clerkJwtTemplate: "", clerkCliOAuthClientId: "" };
const V1 = {
  version: 1,
  relayUrl: RELAY,
  clerk: {
    publishableKey: `pk_test_${btoa("v1.clerk.accounts.dev$")}`,
    jwtTemplate: "v1-template",
  },
};
const VALID_PAYLOAD = JSON.parse(
  Result.getOrThrow(Base64Url.decodeString(vector.cases.valid.envelope.payload)),
) as Record<string, unknown>;

function signOld(changes: Record<string, unknown>) {
  const seed = hexToBytes(vector.keys.old.seedHex);
  const bytes = new TextEncoder().encode(JSON.stringify({ ...VALID_PAYLOAD, ...changes }));
  return {
    payload: Base64Url.encode(bytes),
    signature: Base64Url.encode(ed25519.sign(bytes, seed)),
    key: vector.keys.old.publicKey,
  };
}

function relay(routes: Record<string, unknown>) {
  const requested: string[] = [];
  const fetch: ConnectServiceFetch = async (url) => {
    requested.push(new URL(url).pathname);
    const body = routes[new URL(url).pathname];
    if (body === undefined) return { status: 404, json: async () => null };
    return { status: 200, json: async () => body };
  };
  return {
    requested,
    options: (extra: object = {}) => ({ fetch, now: NOW, ...extra }),
    routes,
  };
}

const METADATA = { "/.well-known/oauth-authorization-server": { issuer: RELAY } };
const V2 = "/.well-known/catgirl-connect.json";
const V1_PATH = "/.well-known/t3-connect.json";

describe("saving a Connect address", () => {
  it("prefers the signed document and pins its key", async () => {
    const service = relay({ ...METADATA, [V2]: vector.cases.valid.envelope, [V1_PATH]: V1 });
    const check = await checkConnectService({ relayUrl: RELAY, ...EMPTY }, service.options());
    expect(check._tag).toBe("Ready");
    if (check._tag !== "Ready") return;
    expect(check.settings).toMatchObject({
      relayUrl: RELAY,
      clerkPublishableKey: "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
      clerkJwtTemplate: "t3-relay",
      clerkCliOAuthClientId: "example-client",
      source: "discovered",
      connect: { key: vector.keys.old.publicKey },
    });
    expect(service.requested).not.toContain(V1_PATH);
  });

  it("falls back to version 1 when there is no signed document, or one of another version", async () => {
    for (const v2 of [undefined, signOld({ version: 3 })]) {
      const service = relay({ ...METADATA, [V2]: v2, [V1_PATH]: V1 });
      const check = await checkConnectService({ relayUrl: RELAY, ...EMPTY }, service.options());
      expect(check).toMatchObject({
        _tag: "Ready",
        settings: { clerkJwtTemplate: "v1-template", source: "discovered" },
      });
      if (check._tag === "Ready") expect(check.settings.connect).toBeUndefined();
    }
  });

  it("then to typing the values, exactly as before", async () => {
    const service = relay({ ...METADATA });
    expect(await checkConnectService({ relayUrl: RELAY, ...EMPTY }, service.options())).toEqual({
      _tag: "NotPublished",
    });
  });

  it("refuses a document that fails its check instead of falling back", async () => {
    const service = relay({ ...METADATA, [V2]: vector.cases.badSignature.envelope, [V1_PATH]: V1 });
    expect(await checkConnectService({ relayUrl: RELAY, ...EMPTY }, service.options())).toEqual({
      _tag: "DocumentRejected",
      problem: "bad-signature",
    });
  });

  it("takes a setup link, and refuses a different key than the link names", async () => {
    const fp = vector.keys.old.fingerprint.replaceAll(" ", "");
    const good = relay({ ...METADATA, [V2]: vector.cases.valid.envelope });
    expect(
      (await checkConnectService({ relayUrl: `${RELAY}/#fp=${fp}`, ...EMPTY }, good.options()))
        ._tag,
    ).toBe("Ready");
    const other = relay({ ...METADATA, [V2]: vector.cases.identityChanged.envelope });
    expect(
      await checkConnectService({ relayUrl: `${RELAY}/#fp=${fp}`, ...EMPTY }, other.options()),
    ).toEqual({ _tag: "DocumentRejected", problem: "fingerprint-mismatch" });
    const unsigned = relay({ ...METADATA, [V1_PATH]: V1 });
    expect(
      await checkConnectService({ relayUrl: `${RELAY}#fp=${fp}`, ...EMPTY }, unsigned.options()),
    ).toEqual({ _tag: "DocumentRejected", problem: "fingerprint-mismatch" });
  });

  it("typed values still win and skip the signed document", async () => {
    const service = relay({ ...METADATA, [V2]: vector.cases.valid.envelope });
    const check = await checkConnectService(
      {
        relayUrl: RELAY,
        clerkPublishableKey: V1.clerk.publishableKey,
        clerkJwtTemplate: "typed",
        clerkCliOAuthClientId: "",
      },
      service.options(),
    );
    expect(check).toMatchObject({ _tag: "Ready", settings: { source: "manual" } });
    expect(service.requested).not.toContain(V2);
  });
});

async function savedValid() {
  const service = relay({ ...METADATA, [V2]: vector.cases.valid.envelope });
  const check = await checkConnectService({ relayUrl: RELAY, ...EMPTY }, service.options());
  if (check._tag !== "Ready") throw new Error(check._tag);
  return check.settings;
}

describe("a service saved with a pinned key", () => {
  it("is read back whole at the next start", async () => {
    const saved = await savedValid();
    const read = readConnectServiceSettings(JSON.parse(JSON.stringify(saved)));
    expect(read).toEqual(saved);
    expect(read?.connect?.key).toBe(vector.keys.old.publicKey);
  });

  it("saving again checks against the pin and keeps the person's answers", async () => {
    const saved = await savedValid();
    const answered = {
      ...saved,
      connect: setConnectDiagnosticsAnswer(saved.connect!, "analytics", true),
    };
    const service = relay({ ...METADATA, [V2]: vector.cases.rotated.envelope });
    const check = await checkConnectService(
      { relayUrl: RELAY, ...EMPTY },
      service.options({ saved: answered }),
    );
    expect(check).toMatchObject({
      _tag: "Ready",
      settings: { connect: { key: vector.keys.new.publicKey, diagnostics: { analytics: true } } },
    });
  });

  it("saving again with a stranger's key reports the identity change", async () => {
    const saved = await savedValid();
    const service = relay({ ...METADATA, [V2]: vector.cases.identityChanged.envelope });
    const check = await checkConnectService(
      { relayUrl: RELAY, ...EMPTY },
      service.options({ saved }),
    );
    expect(check._tag).toBe("IdentityChanged");
  });

  it("a service that stops signing is not quietly taken unsigned", async () => {
    const saved = await savedValid();
    const service = relay({ ...METADATA, [V1_PATH]: V1 });
    expect(
      await checkConnectService({ relayUrl: RELAY, ...EMPTY }, service.options({ saved })),
    ).toEqual({ _tag: "DocumentRejected", problem: "missing" });
  });

  it("the daily check never changes sign-in values by itself", async () => {
    const saved = await savedValid();
    const signIn = VALID_PAYLOAD.signIn as Record<string, unknown>;
    const service = relay({ [V2]: signOld({ signIn: { ...signIn, jwtTemplate: "next" } }) });
    const refreshed = await refreshConnectService(saved, service.options());
    expect(refreshed?.outcome).toBe("restart-needed");
    expect(refreshed?.settings.clerkJwtTemplate).toBe("t3-relay");
    expect(connectServiceNeedsRestart(saved, refreshed!.settings)).toBe(false);

    const restarted = connectServiceAfterRestart(refreshed!.settings, "pending", NOW);
    expect(restarted).toMatchObject({
      clerkJwtTemplate: "next",
      connect: { document: { signIn: { jwtTemplate: "next" } } },
    });
    expect(restarted?.connect?.pending).toBeUndefined();
    expect(restarted?.connect?.recentChanges?.[0]?.kind).toBe("sign-in");
    expect(connectServiceNeedsRestart(saved, restarted)).toBe(true);
  });

  it("trusting a new identity re-checks it and starts the answers over", async () => {
    const saved = await savedValid();
    const answered = {
      ...saved,
      connect: setConnectDiagnosticsAnswer(saved.connect!, "analytics", true),
    };
    const service = relay({ [V2]: vector.cases.identityChanged.envelope });
    const refreshed = await refreshConnectService(answered, service.options());
    expect(refreshed?.outcome).toBe("identity-changed");
    expect(refreshed?.settings.connect?.key).toBe(vector.keys.old.publicKey);
    const trusted = connectServiceAfterRestart(refreshed!.settings, "trust-new-identity", NOW);
    expect(trusted?.connect?.key).toBe(vector.keys.new.publicKey);
    expect(trusted?.connect?.diagnostics).toBeUndefined();
    expect(trusted?.connect?.identityChange).toBeUndefined();
    expect(trusted?.connect?.recentChanges?.[0]).toMatchObject({
      kind: "identity-trusted",
      from: vector.keys.old.fingerprint,
      to: vector.keys.new.fingerprint,
    });
  });

  it("a relay that does not answer keeps the last good document", async () => {
    const saved = await savedValid();
    const refreshed = await refreshConnectService(saved, relay({}).options());
    expect(refreshed?.settings).toMatchObject({
      clerkJwtTemplate: "t3-relay",
      connect: { refreshProblem: "unreachable", key: vector.keys.old.publicKey },
    });
  });
});
