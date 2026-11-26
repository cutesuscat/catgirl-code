import type { ConnectServiceSettings } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { connectTracesOffer, fetchWithCollectToken } from "./connectDiagnostics";

const RELAY = "https://relay.example.com";
const state = vi.hoisted(() => ({
  saved: null as ConnectServiceSettings | null,
  current: null as ConnectServiceSettings | null,
}));
vi.mock("../cloud/connectService", () => ({
  savedConnectService: () => state.saved,
  currentConnectService: () => state.current,
}));

const document = {
  version: 2,
  issuedAt: "2026-11-26T03:00:00Z",
  expiresAt: "2026-12-26T03:00:00Z",
  relayUrl: RELAY,
  signIn: { provider: "clerk", publishableKey: "pk_test_x", jwtTemplate: "t3-relay" },
  diagnostics: {
    traces: { url: `${RELAY}/v1/collect/otlp`, format: "otlp-http", auth: "connect" },
  },
};
const service = (diagnostics?: { traces: boolean }): ConnectServiceSettings => ({
  relayUrl: RELAY,
  clerkPublishableKey: "pk_test_x",
  clerkJwtTemplate: "t3-relay",
  clerkCliOAuthClientId: null,
  source: "discovered",
  connect: {
    key: "key",
    document,
    checkedAt: "2026-11-26T03:00:00Z",
    ...(diagnostics ? { diagnostics } : {}),
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("the service's connection-traces offer on this phone", () => {
  it("replaces the build's address, and sends only after this phone's own yes", () => {
    state.saved = service();
    state.current = service();
    const offer = connectTracesOffer();
    expect(offer?.config.tracesUrl).toBe(`${RELAY}/v1/collect/otlp`);
    expect(offer?.isEnabled()).toBe(false);
    state.current = service({ traces: true });
    expect(offer?.isEnabled()).toBe(true);
    state.current = service({ traces: false });
    expect(offer?.isEnabled()).toBe(false);
  });

  it("is nothing without a signed service that offers traces", () => {
    state.saved = { ...service(), connect: undefined };
    expect(connectTracesOffer()).toBeNull();
    state.saved = null;
    expect(connectTracesOffer()).toBeNull();
  });

  it("sends with a collect token asked for with the phone's sign-in, reused until it expires", async () => {
    const calls: Array<{ url: string; authorization: string | null; dataset: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(input),
          authorization: headers.get("authorization"),
          dataset: headers.get("x-axiom-dataset"),
        });
        return String(input).endsWith("/v1/collect/token")
          ? Response.json({ token: "collect-1", expiresAt: "2099-01-01T00:00:00Z" })
          : new Response(null, { status: 202 });
      }),
    );
    const send = fetchWithCollectToken(RELAY, async () => "clerk-session-jwt");
    const exportInit = {
      headers: { authorization: "Bearer connect", "x-axiom-dataset": "connect" },
    };
    await send(`${RELAY}/v1/collect/otlp`, exportInit);
    await send(`${RELAY}/v1/collect/otlp`, exportInit);
    expect(calls).toEqual([
      {
        url: `${RELAY}/v1/collect/token`,
        authorization: "Bearer clerk-session-jwt",
        dataset: null,
      },
      { url: `${RELAY}/v1/collect/otlp`, authorization: "Bearer collect-1", dataset: null },
      { url: `${RELAY}/v1/collect/otlp`, authorization: "Bearer collect-1", dataset: null },
    ]);
  });

  it("a phone not signed in sends nothing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const send = fetchWithCollectToken(RELAY, async () => {
      throw new Error("Not signed in to Catgirl Connect.");
    });
    await expect(send(`${RELAY}/v1/collect/otlp`, {})).rejects.toThrow("Not signed in");
    expect(fetch).not.toHaveBeenCalled();
  });
});
