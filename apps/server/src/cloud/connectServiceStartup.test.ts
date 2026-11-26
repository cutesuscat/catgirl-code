// @effect-diagnostics globalDate:off - Test documents are dated around a fixed clock.
import {
  signConnectDocumentForTests,
  TEST_CONNECT_SEEDS,
} from "@t3tools/shared/connectDocumentTesting";
import type { ConnectServiceFetch } from "@t3tools/shared/connectService";
import { describe, expect, it } from "vite-plus/test";

import {
  type ConnectServiceStartupIo,
  connectServiceFilePath,
  prepareConnectService,
} from "./connectServiceStartup.ts";

const RELAY = "https://relay.example.com";
const NOW = new Date("2026-12-02T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const OLD_FP = "3475 0f98 bd59 fcfc";
const NEW_FP = "6a38 03d5 f059 902a";
const FILE = "/home/cat/.catcode/userdata/connect-service.json";

const payload = (changes: Record<string, unknown> = {}, signIn: Record<string, unknown> = {}) => ({
  version: 2,
  issuedAt: at(-1),
  expiresAt: at(29),
  relayUrl: RELAY,
  service: { name: "Example cats" },
  signIn: {
    provider: "clerk",
    publishableKey: `pk_test_${btoa("example.clerk.accounts.dev$")}`,
    jwtTemplate: "t3-relay",
    cliOAuthClientId: "example-client",
    hostedAppUrl: "https://app.example.com",
    ...signIn,
  },
  diagnostics: {
    analytics: { url: `${RELAY}/v1/collect/analytics`, format: "posthog-batch", auth: "connect" },
  },
  ...changes,
});

function machine(options: {
  argv: ReadonlyArray<string>;
  document?: unknown;
  files?: Record<string, string>;
  env?: Record<string, string>;
  interactive?: boolean;
  answer?: boolean;
}) {
  const files = new Map(Object.entries(options.files ?? {}));
  const printed: string[] = [];
  const asked: string[] = [];
  const routes: Record<string, unknown> = {
    "/.well-known/oauth-authorization-server": { issuer: RELAY },
    "/.well-known/catgirl-connect.json": options.document,
  };
  const fetch: ConnectServiceFetch = async (url) => {
    const body = routes[new URL(url).pathname];
    return body === undefined
      ? { status: 404, json: async () => null }
      : { status: 200, json: async () => body };
  };
  const io: ConnectServiceStartupIo = {
    argv: options.argv,
    env: { ...options.env },
    homeDirectory: "/home/cat",
    readFile: (path) => files.get(path) ?? null,
    writeFile: (path, contents) => {
      if (contents === null) files.delete(path);
      else files.set(path, contents);
    },
    fetch,
    now: () => NOW,
    interactive: options.interactive ?? false,
    ask: async (question) => {
      asked.push(question);
      return options.answer ?? false;
    },
    print: (line) => printed.push(line),
    warn: (line) => printed.push(line),
  };
  const saved = () => {
    const raw = files.get(FILE);
    return raw === undefined ? undefined : JSON.parse(raw);
  };
  return { io, files, printed, asked, saved };
}

const signedOld = (changes?: Record<string, unknown>, signIn?: Record<string, unknown>) =>
  signConnectDocumentForTests(payload(changes, signIn), TEST_CONNECT_SEEDS.old);
const signedNew = () => signConnectDocumentForTests(payload(), TEST_CONNECT_SEEDS.new);
const T3 = ["node", "t3"];

async function savedMachine() {
  const first = machine({
    argv: [...T3, "connect", "--relay", `${RELAY}/#fp=${OLD_FP.replaceAll(" ", "")}`],
    document: signedOld(),
  });
  await prepareConnectService(first.io);
  return Object.fromEntries(first.files);
}

describe("t3 connect --relay", () => {
  it("checks a setup link's fingerprint, saves the service, then runs the usual connect", async () => {
    const run = machine({
      argv: [...T3, "connect", "--relay", `${RELAY}/#fp=${OLD_FP.replaceAll(" ", "")}`],
      document: signedOld(),
    });
    expect(await prepareConnectService(run.io)).toEqual({
      _tag: "Continue",
      argv: [...T3, "connect"],
    });
    // The emoji line, each name under its emoji, then the hex the setup link carries.
    expect(run.printed).toEqual(
      expect.arrayContaining([
        "  Identity: 🐙       🐰      🌙    🌷      ⌛         🐢      ✈️         🍓",
        "            Octopus  Rabbit  Moon  Flower  Hourglass  Turtle  Aeroplane  Strawberry",
        `            ${OLD_FP}`,
      ]),
    );
    expect(run.printed.join("\n")).toContain("Matches the setup link.");
    expect(run.printed.join("\n")).toContain(
      "Offers to receive usage data: off unless you turn it on.",
    );
    expect(run.saved()).toMatchObject({
      relayUrl: RELAY,
      connect: { document: { service: { name: "Example cats" } } },
    });
    expect(run.io.env).toMatchObject({
      T3CODE_RELAY_URL: RELAY,
      T3CODE_CLERK_PUBLISHABLE_KEY: `pk_test_${btoa("example.clerk.accounts.dev$")}`,
      T3CODE_CLERK_JWT_TEMPLATE: "t3-relay",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "example-client",
      T3CODE_HOSTED_APP_URL: "https://app.example.com",
      T3CODE_CONNECT_ANALYTICS_URL: `${RELAY}/v1/collect/analytics`,
      T3CODE_CONNECT_SERVICE_NAME: "Example cats",
    });
  });

  it("asks in a terminal, and saves nothing on no", async () => {
    const no = machine({
      argv: [...T3, "connect", `--relay=${RELAY}`],
      document: signedOld(),
      interactive: true,
    });
    expect(await prepareConnectService(no.io)).toEqual({ _tag: "Exit", code: 1 });
    expect(no.asked).toEqual(["Use this service on this machine? [y/N] "]);
    expect(no.saved()).toBeUndefined();
    expect(no.printed.join("\n")).toContain(
      "Check this matches what the service's operator gave you.",
    );

    const yes = machine({
      argv: [...T3, "connect", `--relay=${RELAY}`],
      document: signedOld(),
      interactive: true,
      answer: true,
    });
    expect(await prepareConnectService(yes.io)).toMatchObject({ _tag: "Continue" });
    expect(yes.saved()?.connect?.key).toBeDefined();
  });

  it("without a terminal, a signed service needs the setup link's fingerprint", async () => {
    const run = machine({ argv: [...T3, "connect", "--relay", RELAY], document: signedOld() });
    expect(await prepareConnectService(run.io)).toEqual({ _tag: "Exit", code: 1 });
    expect(run.saved()).toBeUndefined();
  });

  it("refuses a key other than the one the setup link names", async () => {
    const run = machine({
      argv: [...T3, "connect", "--relay", `${RELAY}/#fp=${OLD_FP.replaceAll(" ", "")}`],
      document: signedNew(),
    });
    expect(await prepareConnectService(run.io)).toEqual({ _tag: "Exit", code: 1 });
    expect(run.printed.join("\n")).toContain("does not match the fingerprint in the setup link");
    expect(run.saved()).toBeUndefined();
  });

  it("an identity change needs a yes in a terminal; a no is remembered", async () => {
    const files = await savedMachine();
    const no = machine({
      argv: [...T3, "connect", "--relay", RELAY],
      document: signedNew(),
      files,
      interactive: true,
    });
    expect(await prepareConnectService(no.io)).toEqual({ _tag: "Exit", code: 1 });
    expect(no.printed.join("\n")).toContain(
      [
        "  Trusted until now: 🐙       🐰      🌙    🌷      ⌛         🐢      ✈️         🍓",
        "                     Octopus  Rabbit  Moon  Flower  Hourglass  Turtle  Aeroplane  Strawberry",
        `                     ${OLD_FP}`,
        "  New identity:      🌽    🎅     🎩   🐎     ✈️         🤖     🐶   🍓",
        "                     Corn  Santa  Hat  Horse  Aeroplane  Robot  Dog  Strawberry",
        `                     ${NEW_FP}`,
      ].join("\n"),
    );
    expect(no.asked).toEqual([`Trust ${NEW_FP}? [y/N] `]);
    expect(no.saved()?.connect?.identityChange?.declined).toBe(true);

    const yes = machine({
      argv: [...T3, "connect", "--relay", RELAY],
      document: signedNew(),
      files,
      interactive: true,
      answer: true,
    });
    expect(await prepareConnectService(yes.io)).toMatchObject({ _tag: "Continue" });
    expect(yes.saved()?.connect?.recentChanges?.[0]).toMatchObject({
      kind: "identity-trusted",
      to: NEW_FP,
    });
  });

  it("an older service without a signed document is saved as before", async () => {
    const run = machine({
      argv: [...T3, "connect", "--relay", RELAY],
      interactive: true,
      answer: true,
    });
    const routes = {
      "/.well-known/oauth-authorization-server": { issuer: RELAY },
      "/.well-known/t3-connect.json": {
        version: 1,
        relayUrl: RELAY,
        clerk: { publishableKey: `pk_test_${btoa("v1.clerk.accounts.dev$")}`, jwtTemplate: "v1" },
      },
    } as Record<string, unknown>;
    const io = {
      ...run.io,
      fetch: (async (url) => {
        const body = routes[new URL(url).pathname];
        return body === undefined
          ? { status: 404, json: async () => null }
          : { status: 200, json: async () => body };
      }) satisfies ConnectServiceFetch,
    };
    expect(await prepareConnectService(io)).toMatchObject({ _tag: "Continue" });
    expect(run.printed.join("\n")).toContain("It publishes no signed identity");
    expect(run.saved()).toMatchObject({ clerkJwtTemplate: "v1", source: "discovered" });
    expect(run.saved()?.connect).toBeUndefined();
  });

  it("`none` removes the saved service", async () => {
    const files = await savedMachine();
    const run = machine({ argv: [...T3, "connect", "--relay", "none"], files });
    expect(await prepareConnectService(run.io)).toEqual({ _tag: "Exit", code: 0 });
    expect(run.saved()).toBeUndefined();
  });
});

describe("a machine with a saved service", () => {
  it("a server start keeps the last good settings when the identity changed, and says so", async () => {
    const files = await savedMachine();
    const run = machine({ argv: [...T3, "serve"], document: signedNew(), files });
    expect(await prepareConnectService(run.io)).toEqual({
      _tag: "Continue",
      argv: [...T3, "serve"],
    });
    expect(run.printed.join("\n")).toContain(
      `changed its identity to 🌽 🎅 🎩 🐎 ✈️ 🤖 🐶 🍓  ${NEW_FP}.`,
    );
    expect(run.saved()?.connect?.identityChange).toBeDefined();
    expect(run.io.env.T3CODE_RELAY_URL).toBe(RELAY);
    expect(run.io.env.T3CODE_CLERK_JWT_TEMPLATE).toBe("t3-relay");
  });

  it("a server start is a restart, so a waiting sign-in change applies", async () => {
    const files = await savedMachine();
    const run = machine({
      argv: [...T3, "serve"],
      document: signedOld({ issuedAt: at(0) }, { jwtTemplate: "next" }),
      files,
    });
    await prepareConnectService(run.io);
    expect(run.io.env.T3CODE_CLERK_JWT_TEMPLATE).toBe("next");
    expect(run.saved()?.connect?.pending).toBeUndefined();
  });

  it("a variable already set wins, and other commands do not reach the network", async () => {
    const files = await savedMachine();
    const run = machine({
      argv: [...T3, "status"],
      files,
      env: {
        T3CODE_RELAY_URL: "https://relay.mine.test",
        T3CODE_HOSTED_APP_URL: "https://mine.test",
      },
    });
    let fetched = 0;
    await prepareConnectService({
      ...run.io,
      fetch: async () => (fetched++, { status: 500, json: async () => null }),
    });
    expect(fetched).toBe(0);
    expect(run.io.env.T3CODE_RELAY_URL).toBe("https://relay.mine.test");
    expect(run.io.env.T3CODE_HOSTED_APP_URL).toBe("https://mine.test");
    expect(run.io.env.T3CODE_CLERK_JWT_TEMPLATE).toBe("t3-relay");
  });

  it("a service without a hosted app signs machines in with a code", async () => {
    const run = machine({
      argv: [...T3, "connect", "--relay", `${RELAY}/#fp=${OLD_FP.replaceAll(" ", "")}`],
      document: signedOld({}, { hostedAppUrl: null }),
    });
    expect(await prepareConnectService(run.io)).toEqual({
      _tag: "Continue",
      argv: [...T3, "connect", "--headless"],
    });
    const status = machine({
      argv: [...T3, "connect", "status"],
      files: Object.fromEntries(run.files),
    });
    expect(await prepareConnectService(status.io)).toEqual({
      _tag: "Continue",
      argv: [...T3, "connect", "status"],
    });
  });

  it("finds the file where the server keeps its state", () => {
    const io = { env: {}, homeDirectory: "/home/cat" };
    expect(connectServiceFilePath({ ...io, argv: T3 })).toBe(FILE);
    expect(connectServiceFilePath({ ...io, argv: [...T3, "serve", "--base-dir", "~/t3b/"] })).toBe(
      "/home/cat/t3b/userdata/connect-service.json",
    );
    expect(connectServiceFilePath({ ...io, argv: T3, env: { T3CODE_HOME: "/srv/t3" } })).toBe(
      "/srv/t3/userdata/connect-service.json",
    );
  });
});
