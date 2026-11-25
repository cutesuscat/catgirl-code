import { describe, expect, it } from "vite-plus/test";

import {
  checkConnectService,
  connectServiceDiscoveryDocument,
  connectServiceEnvironment,
  type ConnectServiceFetch,
  isClerkPublishableKey,
  parseConnectServiceSettings,
  readConnectServiceSettings,
  resolveConnectService,
} from "./connectService.ts";

const RELAY = "https://relay.example.test";
const KEY = `pk_live_${btoa("clerk.example.test$")}`;
const VALUES = {
  relayUrl: RELAY,
  clerkPublishableKey: KEY,
  clerkJwtTemplate: "t3-relay",
  clerkCliOAuthClientId: "cli-client",
};
const NO_SIGN_IN_VALUES = {
  clerkPublishableKey: "",
  clerkJwtTemplate: "",
  clerkCliOAuthClientId: "",
};
const BUILT_IN = {
  relayUrl: "https://relay.built-in.test",
  clerkPublishableKey: `pk_test_${btoa("built-in.clerk.accounts.dev$")}`,
  clerkJwtTemplate: "built-in",
  clerkCliOAuthClientId: null,
};

/** A relay as the apps see it: a path either answers JSON, answers a status, or fails to connect. */
function relay(routes: Record<string, unknown>) {
  const requested: string[] = [];
  const fetch: ConnectServiceFetch = async (url) => {
    requested.push(url);
    const body = routes[new URL(url).pathname];
    if (body === undefined) return { status: 404, json: async () => null };
    if (body instanceof Error) throw body;
    return { status: 200, json: async () => body };
  };
  return { fetch, requested };
}

const METADATA = { "/.well-known/oauth-authorization-server": { issuer: RELAY } };

describe("isClerkPublishableKey", () => {
  it.each([
    [KEY, true],
    [`pk_test_${btoa("tenant.clerk.accounts.dev$")}`, true],
    ["sk_live_secret", false],
    ["pk_live_", false],
    [`pk_live_${btoa("clerk.example.test")}`, false],
    [`pk_live_${btoa("localhost$")}`, false],
    ["pk_live_not base64!", false],
  ])("%s -> %s", (key, expected) => {
    expect(isClerkPublishableKey(key)).toBe(expected);
  });
});

describe("readConnectServiceSettings", () => {
  it("normalizes a stored service", () => {
    expect(
      readConnectServiceSettings(
        parseConnectServiceSettings(
          JSON.stringify({ ...VALUES, relayUrl: `${RELAY}/`, source: "manual" }),
        ),
      ),
    ).toEqual({ ...VALUES, source: "manual" });
  });

  it.each([
    ["nothing stored", null],
    ["text that is not JSON", "{"],
    ["a missing field", JSON.stringify({ relayUrl: RELAY, source: "manual" })],
    ["an insecure address", JSON.stringify({ ...VALUES, relayUrl: "http://relay.example.test" })],
    ["a secret key", JSON.stringify({ ...VALUES, clerkPublishableKey: "sk_live_x" })],
    ["an unknown source", JSON.stringify({ ...VALUES, source: "guessed" })],
  ])("reads %s as nothing saved", (_name, stored) => {
    expect(readConnectServiceSettings(parseConnectServiceSettings(stored))).toBeNull();
  });
});

describe("resolveConnectService", () => {
  it("uses the built-in service until one is saved", () => {
    expect(resolveConnectService(null, BUILT_IN)).toEqual({ ...BUILT_IN, source: "built-in" });
  });

  it("replaces every built-in value with the saved service", () => {
    const saved = { ...VALUES, clerkCliOAuthClientId: null, source: "discovered" as const };
    expect(resolveConnectService(saved, BUILT_IN)).toEqual(saved);
  });

  it("is not set up when the build ships no service", () => {
    const empty = { ...BUILT_IN, relayUrl: null, clerkPublishableKey: null };
    expect(resolveConnectService(null, empty).source).toBe("none");
  });
});

describe("connectServiceEnvironment", () => {
  it("gives a server the saved service and nothing when none is saved", () => {
    expect(connectServiceEnvironment(null)).toEqual({});
    expect(connectServiceEnvironment({ ...VALUES, source: "manual" })).toEqual({
      T3CODE_RELAY_URL: RELAY,
      T3CODE_CLERK_PUBLISHABLE_KEY: KEY,
      T3CODE_CLERK_JWT_TEMPLATE: "t3-relay",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "cli-client",
    });
  });
});

describe("checkConnectService", () => {
  it("takes the sign-in values the relay publishes", async () => {
    const { fetch, requested } = relay({
      ...METADATA,
      "/.well-known/t3-connect.json": connectServiceDiscoveryDocument(VALUES),
    });

    expect(
      await checkConnectService({ relayUrl: ` ${RELAY}/ `, ...NO_SIGN_IN_VALUES }, { fetch }),
    ).toEqual({ _tag: "Ready", settings: { ...VALUES, source: "discovered" } });
    expect(requested).toEqual([
      `${RELAY}/.well-known/oauth-authorization-server`,
      `${RELAY}/.well-known/t3-connect.json`,
    ]);
  });

  it("uses typed sign-in values without asking the relay for its own", async () => {
    const { fetch, requested } = relay(METADATA);

    expect(await checkConnectService({ ...VALUES, clerkCliOAuthClientId: "" }, { fetch })).toEqual({
      _tag: "Ready",
      settings: { ...VALUES, clerkCliOAuthClientId: null, source: "manual" },
    });
    expect(requested).toEqual([`${RELAY}/.well-known/oauth-authorization-server`]);
  });

  it("names the typed fields that are wrong before contacting anything", async () => {
    const { fetch, requested } = relay(METADATA);

    expect(
      await checkConnectService(
        { ...VALUES, clerkPublishableKey: "sk_live_x", clerkJwtTemplate: "" },
        { fetch },
      ),
    ).toEqual({ _tag: "InvalidFields", fields: ["clerkPublishableKey", "clerkJwtTemplate"] });
    expect(
      await checkConnectService(
        { relayUrl: "relay.example.test", ...NO_SIGN_IN_VALUES },
        { fetch },
      ),
    ).toEqual({ _tag: "InvalidFields", fields: ["relayUrl"] });
    expect(requested).toEqual([]);
  });

  it.each([
    [
      "a host that does not answer",
      { "/.well-known/oauth-authorization-server": new Error("offline") },
      "Unreachable",
    ],
    ["a web server that is not a relay", {}, "NotARelay"],
    ["a relay with no published values", METADATA, "NotPublished"],
    [
      "a document from a newer version",
      {
        ...METADATA,
        "/.well-known/t3-connect.json": { ...connectServiceDiscoveryDocument(VALUES), version: 2 },
      },
      "UnreadableDocument",
    ],
    [
      "a document for another relay",
      {
        ...METADATA,
        "/.well-known/t3-connect.json": connectServiceDiscoveryDocument({
          ...VALUES,
          relayUrl: "https://other.example.test",
        }),
      },
      "UnreadableDocument",
    ],
    [
      "a document with a secret key",
      {
        ...METADATA,
        "/.well-known/t3-connect.json": connectServiceDiscoveryDocument({
          ...VALUES,
          clerkPublishableKey: "sk_live_x",
        }),
      },
      "UnreadableDocument",
    ],
  ])("does not save %s", async (_name, routes, expected) => {
    const { fetch } = relay(routes);

    expect(
      (await checkConnectService({ relayUrl: RELAY, ...NO_SIGN_IN_VALUES }, { fetch }))._tag,
    ).toBe(expected);
  });

  it("points at the address the relay calls itself", async () => {
    const { fetch } = relay({
      "/.well-known/oauth-authorization-server": { issuer: "https://relay.other.test" },
    });

    expect(await checkConnectService({ relayUrl: RELAY, ...NO_SIGN_IN_VALUES }, { fetch })).toEqual(
      { _tag: "RelayAddressMismatch", relayUrl: "https://relay.other.test" },
    );
  });
});
