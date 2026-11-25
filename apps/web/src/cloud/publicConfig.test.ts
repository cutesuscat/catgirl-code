import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { __resetSavedConnectServiceForTests, appliedConnectService } from "./connectService.ts";
import { hasCloudPublicConfig, resolveCloudPublicConfig } from "./publicConfig.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __resetSavedConnectServiceForTests();
});

describe("a T3 Connect service saved on this device", () => {
  const saved = {
    relayUrl: "https://relay.saved.test",
    clerkPublishableKey: `pk_test_${btoa("saved.clerk.accounts.dev$")}`,
    clerkJwtTemplate: "saved-template",
    clerkCliOAuthClientId: null,
    source: "discovered",
  };
  const browser = (stored: string | null) => ({
    location: new URL("http://localhost:3773"),
    localStorage: { getItem: () => stored },
  });

  it("turns T3 Connect on in a browser whose build ships no service", () => {
    vi.stubGlobal("window", browser(JSON.stringify(saved)));

    expect(resolveCloudPublicConfig()).toMatchObject({
      relayUrl: saved.relayUrl,
      clerkPublishableKey: saved.clerkPublishableKey,
      clerkJwtTemplate: saved.clerkJwtTemplate,
    });
    expect(hasCloudPublicConfig()).toBe(true);
  });

  it("replaces every built-in value in the desktop app", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("clerk.example.com$")}`);
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
    vi.stubEnv("VITE_CLERK_CLI_OAUTH_CLIENT_ID", "built-in-client");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
    vi.stubGlobal("window", {
      location: new URL("t3code://app/index.html"),
      desktopBridge: { getConnectService: () => saved },
    });

    expect(appliedConnectService()).toEqual(saved);
  });

  it.each([
    ["nothing", null],
    ["a value that is not a service", JSON.stringify({ relayUrl: "https://relay.saved.test" })],
    ["a secret key", JSON.stringify({ ...saved, clerkPublishableKey: "sk_live_secret" })],
  ])("keeps the built-in service when storage holds %s", (_name, stored) => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
    vi.stubGlobal("window", browser(stored));

    expect(appliedConnectService()).toMatchObject({
      source: "built-in",
      relayUrl: "https://relay.example.test",
      clerkPublishableKey: "pk_test_example",
    });
    expect(hasCloudPublicConfig()).toBe(true);
  });
});

describe("hasCloudPublicConfig", () => {
  it("rejects an insecure relay URL", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "http://relay.example.test");

    expect(hasCloudPublicConfig()).toBe(false);
  });

  describe("browser origins", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("clerk.example.com$")}`);
      vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
      vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
    });

    it.each(["https://example.com", "https://nightly.app.example.com:443"])(
      "enables production auth on the configured root and subdomains: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(true);
      },
    );

    it.each(["http://localhost:3773", "https://machine.example.ts.net"])(
      "disables production auth on private browser origins: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it.each(["http://app.example.com:443", "https://app.example.com:3773"])(
      "rejects unsupported schemes and ports even on the configured domain: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it.each(["https://notexample.com", "https://example.com.evil.test"])(
      "rejects domain lookalikes: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it.each([
      ["https://tenant.clerk.accounts.dev", true],
      ["https://other.clerk.accounts.dev", false],
    ])("keeps a provider hostname scoped to its own instance: %s", (origin, expected) => {
      vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("tenant.clerk.accounts.dev$")}`);
      vi.stubGlobal("window", { location: new URL(origin) });

      expect(hasCloudPublicConfig()).toBe(expected);
    });

    it("keeps production keys available in the Electron auth shell", () => {
      vi.stubGlobal("window", { location: new URL("file:///app/index.html"), desktopBridge: {} });

      expect(hasCloudPublicConfig()).toBe(true);
    });
  });
});
