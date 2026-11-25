import { describe, expect, it, vi } from "vite-plus/test";

import { hasCloudPublicConfig, resolveCloudPublicConfig } from "./publicConfig";

const saved = vi.hoisted(() => ({
  service: null as null | {
    relayUrl: string;
    clerkPublishableKey: string;
    clerkJwtTemplate: string;
    clerkCliOAuthClientId: null;
    source: "discovered";
  },
}));

vi.mock("./connectService", () => ({ savedConnectService: () => saved.service }));

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe("resolveCloudPublicConfig", () => {
  it("uses a service saved on this device in place of the build's, keeping its tracing", () => {
    saved.service = {
      relayUrl: "https://relay.saved.test",
      clerkPublishableKey: "pk_test_saved",
      clerkJwtTemplate: "saved-template",
      clerkCliOAuthClientId: null,
      source: "discovered",
    };

    expect(
      resolveCloudPublicConfig({
        clerk: { publishableKey: "pk_test_example", jwtTemplate: "t3-relay" },
        relay: { url: "https://relay.example.test" },
        observability: { tracesDataset: "mobile" },
      }),
    ).toEqual({
      clerk: { publishableKey: "pk_test_saved", jwtTemplate: "saved-template" },
      relay: { url: "https://relay.saved.test" },
      observability: { tracesUrl: null, tracesDataset: "mobile", tracesToken: null },
    });
    // The build in this test ships nothing, so the saved service alone turns T3 Connect on.
    expect(hasCloudPublicConfig()).toBe(true);
  });

  it("rejects an insecure relay URL", () => {
    saved.service = null;
    expect(
      resolveCloudPublicConfig({
        clerk: { publishableKey: "pk_test_example", jwtTemplate: "t3-relay" },
        relay: { url: "http://relay.example.test" },
      }),
    ).toEqual({
      clerk: {
        publishableKey: "pk_test_example",
        jwtTemplate: "t3-relay",
      },
      relay: {
        url: null,
      },
      observability: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
  });
});
