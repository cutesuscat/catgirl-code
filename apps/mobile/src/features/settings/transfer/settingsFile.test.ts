import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
  DpopConnectionCredential,
  RelayConnectionTarget,
  SshConnectionProfile,
  SshConnectionRegistration,
  SshConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  type ConnectServiceInUse,
  EMPTY_SETTINGS_CONTENT,
  type ImportPorts,
  type PairingKey,
  type SavedMachine,
  type SettingsContent,
  applyImport,
  defaultImportSelection,
  encodeAppSettings,
  importInstructions,
  isWrongPassphrase,
  passphraseProblem,
  planImport,
  readSettingsFile,
  savedMachines,
  settingsFailureMessage,
  settingsFileName,
  settingsPreferences,
} from "./settingsFile";

const NO_SERVICE: ConnectServiceInUse = {
  relayUrl: null,
  clerkPublishableKey: null,
  clerkJwtTemplate: null,
};
const SOURCE = { createdAt: "2026-11-25T23:00:00.000Z", app: "app 1.0", device: "Pixel" };

function paired(
  name: string,
  credential:
    | BearerConnectionCredential
    | DpopConnectionCredential = new BearerConnectionCredential({ token: `token-${name}` }),
  enabled = true,
): SavedMachine {
  const environmentId = EnvironmentId.make(`env-${name}`);
  const connectionId = `bearer:${name}`;
  return {
    enabled,
    registration: new BearerConnectionRegistration({
      target: new BearerConnectionTarget({ environmentId, label: name, connectionId }),
      profile: new BearerConnectionProfile({
        connectionId,
        environmentId,
        label: name,
        httpBaseUrl: `https://${name}.example/`,
        wsBaseUrl: `wss://${name}.example/`,
      }),
      credential,
    }),
  };
}

function overSsh(name: string): SavedMachine {
  const environmentId = EnvironmentId.make(`env-${name}`);
  const connectionId = `ssh:${name}`;
  return {
    enabled: true,
    registration: new SshConnectionRegistration({
      target: new SshConnectionTarget({ environmentId, label: name, connectionId }),
      profile: new SshConnectionProfile({
        connectionId,
        environmentId,
        label: name,
        target: { alias: name, hostname: `${name}.internal`, username: "me", port: null },
      }),
      credential: new BearerConnectionCredential({ token: `ssh-token-${name}` }),
    }),
  };
}

const tied = (name: string) =>
  paired(name, new DpopConnectionCredential({ accessToken: `dpop-${name}`, expiresAtEpochMs: 5 }));

const pairingKey = (seed: string): PairingKey => ({
  kty: "EC",
  crv: "P-256",
  x: `x-${seed}`,
  y: `y-${seed}`,
  d: `d-${seed}`,
});

const sshKey = (name: string) => ({
  line: `ssh-ed25519 AAAA${name} t3code-android`,
  fingerprint: `SHA256:${name}`,
});

const hostKey = (name: string, key: string) => ({
  line: `${name} ssh-ed25519 ${key}`,
  names: [name],
  keyType: "ssh-ed25519",
  fingerprint: `SHA256:${key}`,
});

const content = (parts: Partial<SettingsContent>): SettingsContent => ({
  ...EMPTY_SETTINGS_CONTENT,
  ...parts,
});

/** A file as import sees it: encoded, then read back the way an opened file is. */
function throughAFile(source: SettingsContent) {
  return readSettingsFile({
    key: source.sshKey,
    config: source.sshConfig === "" ? null : source.sshConfig,
    knownHosts: source.knownHosts,
    app: encodeAppSettings(source, SOURCE),
  });
}

function plan(
  file: SettingsContent,
  device: SettingsContent,
  inUse: ConnectServiceInUse = NO_SERVICE,
) {
  const items = planImport(file, device, inUse);
  const byId = new Map(items.map((item) => [item.id, item]));
  return { items, byId, selected: defaultImportSelection(items) };
}

describe("what goes in a settings file", () => {
  const catalog: ConnectionCatalogDocument = {
    schemaVersion: 1,
    targets: [
      paired("box").registration.target,
      overSsh("lab").registration.target,
      new RelayConnectionTarget({ environmentId: EnvironmentId.make("env-cloud"), label: "cloud" }),
      new BearerConnectionTarget({
        environmentId: EnvironmentId.make("env-box"),
        label: "box",
        connectionId: "learned:lan@bearer:box",
      }),
      new BearerConnectionTarget({
        environmentId: EnvironmentId.make("env-cloud"),
        label: "cloud",
        connectionId: "connect-direct",
      }),
      paired("orphan").registration.target,
    ],
    profiles: [
      paired("box").registration.profile,
      overSsh("lab").registration.profile,
      new BearerConnectionProfile({
        connectionId: "learned:lan@bearer:box",
        environmentId: EnvironmentId.make("env-box"),
        label: "box",
        httpBaseUrl: "http://192.168.1.4:3773/",
        wsBaseUrl: "ws://192.168.1.4:3773/",
        learned: true,
      }),
      new BearerConnectionProfile({
        connectionId: "connect-direct",
        environmentId: EnvironmentId.make("env-cloud"),
        label: "cloud",
        httpBaseUrl: "https://cloud.example/",
        wsBaseUrl: "wss://cloud.example/",
        authorization: "t3-connect",
      }),
      paired("orphan").registration.profile,
    ],
    credentials: [
      { connectionId: "bearer:box", credential: paired("box").registration.credential },
      { connectionId: "ssh:lab", credential: overSsh("lab").registration.credential },
      {
        connectionId: "connect-direct",
        credential: new BearerConnectionCredential({ token: "from-connect" }),
      },
    ],
    remoteDpopTokens: [],
    disabledEnvironmentIds: [EnvironmentId.make("env-lab")],
  };

  it("keeps machines paired by link or reached over SSH, and leaves out what comes back by itself", () => {
    const machines = savedMachines(catalog);

    // Not the Connect machine, the route a server reported, the route signed in through Connect,
    // or a route whose sign-in is gone.
    expect(machines.map((machine) => machine.registration.target.connectionId)).toEqual([
      "bearer:box",
      "ssh:lab",
    ]);
    expect(machines.map((machine) => machine.enabled)).toEqual([true, false]);
  });

  it("round-trips every part through the file", () => {
    const source = content({
      sshKey: sshKey("old"),
      sshConfig: "Host lab\n  HostName lab.internal\n",
      knownHosts: [hostKey("lab.internal", "AAAAhost")],
      machines: [paired("box"), overSsh("lab"), tied("den"), paired("off", undefined, false)],
      pairingKey: pairingKey("old"),
      clientCertificates: [{ origin: "https://*.example/", alias: "phone" }],
      connectService: {
        relayUrl: "https://relay.example",
        clerkPublishableKey: "pk_test_abc",
        clerkJwtTemplate: "relay",
        clerkCliOAuthClientId: null,
        source: "manual",
      },
      preferences: { themeMode: "dark", baseFontSize: 17 },
    });

    const opened = throughAFile(source);

    expect(opened.unreadable).toEqual([]);
    expect(opened.source).toEqual(SOURCE);
    expect(opened.content).toEqual(source);
  });

  it("carries the pairing key only when a machine's sign-in is tied to it", () => {
    const withTied = encodeAppSettings(
      content({ machines: [tied("den")], pairingKey: pairingKey("old") }),
      SOURCE,
    );
    const without = encodeAppSettings(
      content({ machines: [paired("box"), overSsh("lab")], pairingKey: pairingKey("old") }),
      SOURCE,
    );

    expect(withTied).toContain("d-old");
    expect(without).not.toContain("d-old");
    expect(without).not.toContain("pairingKey");
  });

  it("exports settings, not what the app happened to be showing", () => {
    const preferences = settingsPreferences({
      themeMode: "dark",
      language: "de",
      workspaceSelections: { settings: "SettingsSsh" },
      collapsedProjectGroups: ["a"],
      threadListSettledShelfExpanded: true,
      somethingNewer: 1,
    });

    expect(preferences).toEqual({ themeMode: "dark", language: "de" });
  });

  it("never names the SSH private key: that part is added by the native module", () => {
    const encoded = encodeAppSettings(content({ sshKey: sshKey("old") }), SOURCE);

    expect(encoded).not.toContain("ssh-ed25519");
    expect(encoded).not.toContain("SHA256:");
  });
});

describe("reading a file this version only partly understands", () => {
  const read = (app: string | null) =>
    readSettingsFile({ key: sshKey("old"), config: null, knownHosts: [], app });

  it("imports the SSH part when the app part is not JSON", () => {
    const opened = read("not json");

    expect(opened.content.sshKey).toEqual(sshKey("old"));
    expect(opened.content.machines).toEqual([]);
    expect(opened.unreadable).toEqual(["everything except the SSH settings"]);
  });

  it("reads a file with no app part at all", () => {
    expect(read(null).unreadable).toEqual([]);
    expect(read("{}").content).toEqual(content({ sshKey: sshKey("old") }));
  });

  it("names a part it cannot read and still takes the others", () => {
    const opened = read(
      JSON.stringify({
        machines: { schemaVersion: 9 },
        clientCertificates: [{ origin: "https://a.example/", alias: "phone" }],
        connectService: "relay",
        preferences: { themeMode: "dark" },
        somethingFromANewerVersion: [1, 2, 3],
      }),
    );

    expect(opened.unreadable).toEqual(["the saved machines", "the Connect service"]);
    expect(opened.content.clientCertificates).toEqual([
      { origin: "https://a.example/", alias: "phone" },
    ]);
    expect(opened.content.preferences).toEqual({ themeMode: "dark" });
    expect(opened.source).toBeNull();
  });

  it("drops a machine whose sign-in needs a pairing key the file does not hold", () => {
    const full = JSON.parse(
      encodeAppSettings(
        content({ machines: [tied("den"), paired("box")], pairingKey: pairingKey("old") }),
        SOURCE,
      ),
    ) as Record<string, unknown>;
    delete full.pairingKey;

    const opened = read(JSON.stringify(full));

    expect(opened.content.machines.map((machine) => machine.registration.target.label)).toEqual([
      "box",
    ]);
    expect(opened.unreadable).toEqual([
      "1 machines whose sign-in needs a pairing key the file does not hold",
    ]);
  });
});

describe("the import plan", () => {
  it("adds everything to a device that has nothing, and asks about nothing", () => {
    const file = content({
      sshKey: sshKey("old"),
      sshConfig: "Host lab\n  HostName lab.internal\n",
      knownHosts: [hostKey("lab.internal", "AAAAhost")],
      machines: [paired("box"), overSsh("lab"), tied("den")],
      pairingKey: pairingKey("old"),
      clientCertificates: [{ origin: "https://*.example/", alias: "phone" }],
      preferences: { themeMode: "dark" },
    });

    const { items, selected } = plan(file, EMPTY_SETTINGS_CONTENT);

    expect(items.map((item) => [item.id, item.action])).toEqual([
      ["ssh-key", "add"],
      ["ssh-config", "add"],
      ["known-hosts", "add"],
      ["machine:bearer:box", "add"],
      ["machine:ssh:lab", "add"],
      ["machine:bearer:den", "add"],
      ["certificate:https://*.example/", "add"],
      ["preferences-new", "add"],
    ]);
    expect(items.every((item) => item.warning === undefined)).toBe(true);
    expect([...selected]).toEqual(items.map((item) => item.id));

    const instructions = importInstructions(file, EMPTY_SETTINGS_CONTENT, items, selected);
    expect(instructions).toEqual({
      sshKey: "add",
      sshKeyInKeychain: false,
      sshConfig: "add",
      knownHosts: "add",
      machines: file.machines,
      pairingKey: pairingKey("old"),
      clientCertificates: file.clientCertificates,
      connectService: null,
      preferences: { themeMode: "dark" },
    });
  });

  it("does nothing when the device already has what the file holds", () => {
    const same = content({
      sshKey: sshKey("old"),
      sshConfig: "Host lab\n",
      knownHosts: [hostKey("lab", "AAAAhost")],
      machines: [paired("box"), tied("den")],
      pairingKey: pairingKey("old"),
      clientCertificates: [{ origin: "https://a.example/", alias: "phone" }],
      preferences: { themeMode: "dark" },
    });

    const { items, selected } = plan(same, same);

    expect(items.map((item) => item.action)).toEqual([
      "same",
      "same",
      "same",
      "same",
      "same",
      "same",
    ]);
    expect(selected.size).toBe(0);
    expect(importInstructions(same, same, items, new Set(items.map((item) => item.id)))).toEqual({
      sshKey: "skip",
      sshKeyInKeychain: false,
      sshConfig: "skip",
      knownHosts: "skip",
      machines: [],
      pairingKey: null,
      clientCertificates: [],
      connectService: null,
      preferences: {},
    });
  });

  it("leaves what would replace something switched off, and says what replacing costs", () => {
    const file = content({
      sshKey: sshKey("old"),
      sshConfig: "Host lab\n",
      machines: [paired("box", new BearerConnectionCredential({ token: "from-file" }))],
      clientCertificates: [{ origin: "https://a.example/", alias: "phone" }],
      preferences: { themeMode: "dark", language: "de" },
    });
    const device = content({
      sshKey: sshKey("new"),
      sshConfig: "Host mine\n",
      machines: [paired("box")],
      clientCertificates: [{ origin: "https://a.example/", alias: "tablet" }],
      preferences: { themeMode: "light" },
    });

    const { items, byId, selected } = plan(file, device);

    expect([...selected]).toEqual(["preferences-new"]);
    for (const id of [
      "ssh-key",
      "ssh-config",
      "machine:bearer:box",
      "certificate:https://a.example/",
      "preferences-changed",
    ]) {
      expect(byId.get(id)?.action, id).toBe("replace");
      expect(byId.get(id)?.warning, id).toBeTruthy();
    }
    expect(byId.get("ssh-key")?.warning).toContain("SHA256:new");
    expect(byId.get("certificate:https://a.example/")?.warning).toContain("tablet");
    expect(byId.get("preferences-new")?.detail).toBe("Language");
    expect(byId.get("preferences-changed")?.detail).toBe("Light or dark mode");

    const asShown = importInstructions(file, device, items, selected);
    expect(asShown).toMatchObject({
      sshKey: "skip",
      sshConfig: "skip",
      machines: [],
      clientCertificates: [],
      preferences: { language: "de" },
    });

    const everything = importInstructions(file, device, items, new Set(byId.keys()));
    expect(everything).toMatchObject({
      sshKey: "replace",
      sshConfig: "replace",
      machines: file.machines,
      clientCertificates: file.clientCertificates,
      preferences: { language: "de", themeMode: "dark" },
    });
  });

  it("shows a keychain key by its name, since the file holds no more than that", () => {
    const inKeychain = { ...sshKey("old"), keychainAlias: "my-phone" };
    const file = content({ sshKey: inKeychain });

    const { items, selected } = plan(file, EMPTY_SETTINGS_CONTENT);

    expect(items[0]).toMatchObject({ id: "ssh-key", action: "add" });
    expect(items[0]?.detail).toContain('as "my-phone"');
    expect(importInstructions(file, EMPTY_SETTINGS_CONTENT, items, selected)).toMatchObject({
      sshKey: "add",
      sshKeyInKeychain: true,
    });
    expect(plan(file, content({ sshKey: inKeychain })).items[0]?.action).toBe("same");
  });

  it("merges trusted host keys and never offers to replace one", () => {
    const file = content({
      knownHosts: [hostKey("a", "AAAAa"), hostKey("b", "AAAAb"), hostKey("c", "AAAAfile")],
    });
    const device = content({ knownHosts: [hostKey("a", "AAAAa"), hostKey("c", "AAAAmine")] });

    const item = plan(file, device).byId.get("known-hosts");

    expect(item?.action).toBe("add");
    expect(item?.detail).toBe("1 to add, 1 already here, 1 kept as this device has them");
    expect(
      plan(content({ knownHosts: [hostKey("c", "AAAAfile")] }), device).byId.get("known-hosts"),
    ).toMatchObject({ action: "same", detail: "1 host key, 1 kept as this device has them" });
    expect(plan(device, device).byId.get("known-hosts")).toMatchObject({
      action: "same",
      detail: "2 host keys",
    });
  });

  it("takes the file's pairing key quietly when nothing on the device depends on its own", () => {
    const file = content({ machines: [tied("den")], pairingKey: pairingKey("old") });
    const device = content({ machines: [paired("box")], pairingKey: pairingKey("new") });

    const { items, selected } = plan(file, device);

    expect(items.map((item) => [item.action, item.warning])).toEqual([["add", undefined]]);
    expect(importInstructions(file, device, items, selected).pairingKey).toEqual(pairingKey("old"));
  });

  it("asks before a pairing key change that would cost machines paired on this device", () => {
    const file = content({ machines: [tied("den"), paired("box")], pairingKey: pairingKey("old") });
    const device = content({
      machines: [tied("mine"), tied("too")],
      pairingKey: pairingKey("new"),
    });

    const { items, byId, selected } = plan(file, device);

    expect(byId.get("machine:bearer:den")?.action).toBe("replace");
    expect(byId.get("machine:bearer:den")?.warning).toContain("mine, too");
    expect(byId.get("machine:bearer:box")?.action).toBe("add");
    // Left as shown, this device keeps its own key.
    expect(importInstructions(file, device, items, selected).pairingKey).toBeNull();
    expect(importInstructions(file, device, items, new Set(byId.keys())).pairingKey).toEqual(
      pairingKey("old"),
    );
  });

  it("keeps this device's pairing key when it is the same, or when no imported machine needs it", () => {
    const file = content({ machines: [tied("den"), paired("box")], pairingKey: pairingKey("old") });
    const sameKey = content({ machines: [tied("mine")], pairingKey: pairingKey("old") });
    const otherKey = content({ pairingKey: pairingKey("new") });

    const same = plan(file, sameKey);
    expect(same.byId.get("machine:bearer:den")?.action).toBe("add");
    expect(importInstructions(file, sameKey, same.items, same.selected).pairingKey).toBeNull();

    const other = plan(file, otherKey);
    const onlyBox = new Set(["machine:bearer:box"]);
    expect(importInstructions(file, otherKey, other.items, onlyBox).pairingKey).toBeNull();
  });

  it("offers a saved Connect service only when it differs from the one in use", () => {
    const service = {
      relayUrl: "https://relay.example",
      clerkPublishableKey: "pk_test_abc",
      clerkJwtTemplate: "relay",
      clerkCliOAuthClientId: null,
      source: "manual" as const,
    };
    const file = content({ connectService: service });

    expect(plan(file, EMPTY_SETTINGS_CONTENT).byId.get("connect-service")?.action).toBe("add");
    expect(plan(file, EMPTY_SETTINGS_CONTENT, service).byId.get("connect-service")?.action).toBe(
      "same",
    );
    const other = plan(file, EMPTY_SETTINGS_CONTENT, {
      ...service,
      relayUrl: "https://other.example",
    });
    expect(other.byId.get("connect-service")?.action).toBe("replace");
    expect(other.selected.has("connect-service")).toBe(false);
    expect(plan(EMPTY_SETTINGS_CONTENT, EMPTY_SETTINGS_CONTENT, service).items).toEqual([]);
  });

  it("describes machines by where they are", () => {
    const { byId } = plan(
      content({ machines: [paired("box"), overSsh("lab")] }),
      EMPTY_SETTINGS_CONTENT,
    );

    expect(byId.get("machine:bearer:box")?.detail).toBe("https://box.example, paired with a link");
    expect(byId.get("machine:ssh:lab")?.detail).toBe("lab (me@lab.internal), over SSH");
  });
});

describe("applying an import", () => {
  function ports(overrides: Partial<ImportPorts> = {}) {
    const calls: string[] = [];
    const all: ImportPorts = {
      importSsh: vi.fn(async (key, config, knownHosts) => {
        calls.push(`ssh ${key} ${config} ${knownHosts}`);
        return { keyImported: true, configImported: false, knownHostsAdded: 2, knownHostsKept: 1 };
      }),
      storePairingKey: vi.fn(async () => {
        calls.push("pairing-key");
      }),
      saveMachine: vi.fn(async (machine) => {
        calls.push(`machine ${machine.registration.target.label}`);
      }),
      restoreCertificate: vi.fn(async (choice) => {
        calls.push(`certificate ${choice.alias}`);
        return choice.alias === "granted";
      }),
      savePreferences: vi.fn(async () => {
        calls.push("preferences");
      }),
      switchConnectService: vi.fn(async () => {
        calls.push("connect-service");
      }),
      ...overrides,
    };
    return { all, calls };
  }

  const everything = {
    sshKey: "add",
    sshKeyInKeychain: false,
    sshConfig: "skip",
    knownHosts: "add",
    machines: [tied("den"), paired("box")],
    pairingKey: pairingKey("old"),
    clientCertificates: [
      { origin: "https://a.example/", alias: "granted" },
      { origin: "https://b.example/", alias: "asks" },
    ],
    connectService: {
      relayUrl: "https://relay.example",
      clerkPublishableKey: "pk_test_abc",
      clerkJwtTemplate: "relay",
      clerkCliOAuthClientId: null,
      source: "manual",
    },
    preferences: { themeMode: "dark", language: "de" },
  } as const;

  it("stores the pairing key before the machines and switches the Connect service last", async () => {
    const { all, calls } = ports();

    const outcome = await applyImport(everything, all);

    expect(calls).toEqual([
      "ssh add skip add",
      "pairing-key",
      "machine den",
      "machine box",
      "certificate granted",
      "certificate asks",
      "preferences",
      "connect-service",
    ]);
    expect(outcome).toEqual({
      done: [
        "SSH key imported, and sealed with this app's own key.",
        "2 trusted host keys added.",
        "2 machines saved.",
        'Certificate "granted" selected again.',
        "2 preferences imported.",
        "Connect service set to relay.example.",
      ],
      failed: [],
      certificatesToAllow: [{ origin: "https://b.example/", alias: "asks" }],
      sshKeyToChoose: null,
      restart: true,
    });
  });

  it("touches nothing it was not told to", async () => {
    const { all, calls } = ports();

    const outcome = await applyImport(
      {
        sshKey: "skip",
        sshKeyInKeychain: false,
        sshConfig: "skip",
        knownHosts: "skip",
        machines: [paired("box")],
        pairingKey: null,
        clientCertificates: [],
        connectService: null,
        preferences: {},
      },
      all,
    );

    expect(calls).toEqual(["machine box"]);
    expect(outcome).toEqual({
      done: ["1 machine saved."],
      failed: [],
      certificatesToAllow: [],
      sshKeyToChoose: null,
      restart: false,
    });
  });

  it("reports a part that failed and still imports the rest", async () => {
    const { all, calls } = ports({
      importSsh: async () => {
        throw new Error("keystore unavailable");
      },
      saveMachine: async (machine) => {
        if (machine.registration.target.label === "den") throw new Error("already managed");
      },
    });

    const outcome = await applyImport(everything, all);

    expect(outcome.failed).toEqual(["SSH settings: keystore unavailable", "den: already managed"]);
    expect(outcome.done).toContain("1 machine saved.");
    expect(calls).toContain("connect-service");
  });

  it("says when the file's SSH key is a keychain entry this app may not use yet", async () => {
    const onlyKey = {
      ...everything,
      sshKeyInKeychain: true,
      knownHosts: "skip",
      machines: [],
      pairingKey: null,
      clientCertificates: [],
      connectService: null,
      preferences: {},
    } as const;
    const result = {
      keyImported: false,
      configImported: false,
      knownHostsAdded: 0,
      knownHostsKept: 0,
    };

    const asked = await applyImport(
      onlyKey,
      ports({ importSsh: async () => ({ ...result, keychainToChoose: "my-phone" }) }).all,
    );
    expect(asked).toMatchObject({ done: [], failed: [], sshKeyToChoose: "my-phone" });

    const allowed = await applyImport(
      onlyKey,
      ports({ importSsh: async () => ({ ...result, keyImported: true }) }).all,
    );
    expect(allowed).toMatchObject({
      done: ["SSH key from this phone's keychain selected again."],
      sshKeyToChoose: null,
    });
  });

  it("does not save a machine whose pairing key could not be stored", async () => {
    const { all, calls } = ports({
      storePairingKey: async () => {
        throw new Error("secure storage is locked");
      },
    });

    const outcome = await applyImport(everything, all);

    expect(calls).not.toContain("machine den");
    expect(calls).toContain("machine box");
    expect(outcome.failed).toEqual([
      "Pairing key: secure storage is locked",
      "den: not saved, because its pairing key could not be stored.",
    ]);
  });
});

describe("the small things around a file", () => {
  it("wants a passphrase of some length, typed the same twice", () => {
    expect(passphraseProblem("short", "short")).toBe("Use at least 8 characters.");
    expect(passphraseProblem("long enough", "long enoug")).toBe(
      "The two passphrases are different.",
    );
    expect(passphraseProblem("long enough", "long enough")).toBeNull();
  });

  it("names the file by the day it was made", () => {
    expect(settingsFileName(new Date("2026-11-25T23:59:00Z"))).toBe(
      "catgirl-code-settings-2026-11-25.cgsettings",
    );
  });

  it("turns native failures into something a person can act on", () => {
    const failure = (code: string, message = "Call to function 'T3Ssh.x' has been rejected.") =>
      Object.assign(new Error(message), { code });

    expect(settingsFailureMessage(failure("ERR_SETTINGS_WRONG_PASSPHRASE"))).toBe(
      "That passphrase does not open this file.",
    );
    expect(settingsFailureMessage(failure("ERR_SETTINGS_NEWER_VERSION"))).toContain(
      "newer version",
    );
    expect(settingsFailureMessage(failure("ERR_SETTINGS_DAMAGED"))).toContain("damaged");
    expect(settingsFailureMessage(failure("ERR_SETTINGS_NOT_A_FILE"))).toContain(
      "not a settings file",
    );
    expect(
      settingsFailureMessage(
        failure(
          "ERR_SSH",
          "Call to function 'T3Ssh.x' has been rejected.\n→ Caused by: No space left.",
        ),
      ),
    ).toBe("No space left.");
    expect(settingsFailureMessage("plain")).toBe("plain");
    expect(isWrongPassphrase(failure("ERR_SETTINGS_WRONG_PASSPHRASE"))).toBe(true);
    expect(isWrongPassphrase(failure("ERR_SETTINGS_DAMAGED"))).toBe(false);
  });
});
