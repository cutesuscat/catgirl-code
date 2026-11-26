import { afterEach, expect, it, vi } from "vite-plus/test";

// Catgirl Code's own check, apart from upstream's app.config.test.ts: no Expo project, no update feed.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    T3CODE_MOBILE_UPDATES_ENABLED: process.env.T3CODE_MOBILE_UPDATES_ENABLED,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string, updatesEnabled: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", updatesEnabled);
  return (await import("./app.config.ts")).default;
}

it.each([
  ["preview", undefined],
  ["preview", "0"],
  ["production", undefined],
  ["development", "0"],
])("APP_VARIANT=%j with updates %j names no Expo project and no feed", async (variant, value) => {
  const config = await loadConfig(variant, value);
  expect(config.updates?.enabled).toBe(false);
  expect(config.updates?.url).toBeUndefined();
  expect(config.owner).toBeUndefined();
  expect(config.extra?.eas?.projectId).toBe("00000000-0000-0000-0000-000000000000");
  const text = JSON.stringify(config);
  expect(text).not.toContain("expo.dev");
  expect(text).not.toContain("d763fcb8-d37c-41ea-a773-b54a0ab4a454");
  expect(text).not.toContain("pingdotgg");
});

it("refuses a build that turns updates on instead of reaching upstream's feed", async () => {
  await expect(loadConfig("preview", "1")).rejects.toThrow(
    "T3CODE_MOBILE_UPDATES_ENABLED=1 asks for over-the-air updates, but Catgirl Code has no update feed",
  );
});
