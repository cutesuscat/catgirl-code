/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import {
  BearerConnectionRegistration,
  SshConnectionRegistration,
} from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { ConnectServiceSettings } from "@t3tools/contracts";
import { DpopPublicJwk } from "@t3tools/shared/dpopCommon";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type {
  OpenedSettingsFile as NativeSettingsFile,
  SshKnownHost,
  SshPublicKey,
} from "../../../connection/ssh/native";
import { parseSshConfig } from "../../../connection/ssh/sshConfig";
import type { ClientCertificateChoice } from "../../../lib/clientCertificates.types";
import type { Preferences } from "../../../persistence/mobile-preferences";

/**
 * Every preference the app stores: the name import shows for it, or null for view state that
 * nobody sets up by hand (which page was open, which lists were folded). A preference upstream
 * adds fails the typecheck here until someone decides which of the two it is.
 */
export const PREFERENCE_LABELS = {
  navigationTabOrder: "Navigation tab order",
  hiddenNavigationTabs: "Hidden navigation tabs",
  sharedSlotTab: null,
  pullRequestHideTestFiles: "Hide test files in pull requests",
  pullRequestActivityVisibility: "Pull request activity shown",
  pullRequestMergeMethod: "Pull request merge method",
  liveActivitiesEnabled: "Live activities",
  themeId: "Theme",
  lightThemeId: "Light theme",
  darkThemeId: "Dark theme",
  themeMode: "Light or dark mode",
  androidNavigationStyle: "Navigation style",
  baseFontSize: "Text size",
  terminalFontSize: "Terminal text size",
  markdownFontSize: "Message text size",
  codeFontSize: "Code text size",
  codeWordBreak: "Code line wrapping",
  mathRenderingEnabled: "Math rendering",
  crashReportsEnabled: "Crash reports",
  connectionTracesEnabled: "Connection traces",
  connectOnboardingOptOutAccounts: null,
  collapsedProjectGroups: null,
  dismissedDatabaseStorageNotices: null,
  connectDevicesSeenThrough: null,
  composerEnterBehavior: "Return key in the composer",
  followUpBehavior: "Follow-up behavior",
  language: "Language",
  microphones: "Microphone order",
  projectGroupingEnabled: "Project grouping",
  projectGroupingMode: "Project grouping mode",
  toolCallVisibility: "Tool call visibility",
  workingShelfEnabled: "Working shelf",
  workflowQuestionKind: null,
  useLastProjectForNewThreads: "Use the last project for new threads",
  lastThreadProject: null,
  modelFavorites: "Favorite models",
  threadListSettledShelfExpanded: null,
  threadListSnoozedShelfExpanded: null,
  threadListWorkingShelfExpanded: null,
  threadListFilters: null,
  pullRequestListFilters: null,
  workspaceSelections: null,
  pullRequestSavedViews: "Saved pull request views",
  issueSavedViews: "Saved issue views",
} as const satisfies Record<keyof Preferences, string | null>;

type PreferenceKey = keyof typeof PREFERENCE_LABELS;
const PREFERENCE_KEYS = Object.keys(PREFERENCE_LABELS) as ReadonlyArray<PreferenceKey>;

/** The settings among `preferences`, without view state and without unknown keys. */
export function settingsPreferences(preferences: Readonly<Record<string, unknown>>) {
  const settings: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) {
    if (PREFERENCE_LABELS[key] !== null && preferences[key] !== undefined) {
      settings[key] = preferences[key];
    }
  }
  return settings as Partial<Preferences>;
}

/** The key a directly paired machine's sign-in is tied to. Private: it only travels encrypted. */
export const PairingKey = Schema.Struct({ ...DpopPublicJwk.fields, d: Schema.String });
export type PairingKey = typeof PairingKey.Type;

/** A machine this device reaches without T3 Connect: by a pairing link, or over SSH. */
export interface SavedMachine {
  readonly registration: BearerConnectionRegistration | SshConnectionRegistration;
  readonly enabled: boolean;
}

/**
 * What a person set up by hand, in one shape for both sides of an import: what this device
 * has and what a file holds.
 */
export interface SettingsContent {
  readonly sshKey: SshPublicKey | null;
  readonly sshConfig: string;
  readonly knownHosts: ReadonlyArray<SshKnownHost>;
  readonly machines: ReadonlyArray<SavedMachine>;
  readonly pairingKey: PairingKey | null;
  readonly clientCertificates: ReadonlyArray<ClientCertificateChoice>;
  readonly connectService: ConnectServiceSettings | null;
  readonly preferences: Partial<Preferences>;
}

export const EMPTY_SETTINGS_CONTENT: SettingsContent = {
  sshKey: null,
  sshConfig: "",
  knownHosts: [],
  machines: [],
  pairingKey: null,
  clientCertificates: [],
  connectService: null,
  preferences: {},
};

const usesPairingKey = (machine: SavedMachine) =>
  machine.registration.credential._tag === "DpopConnectionCredential";

/**
 * The machines in a connection catalog that T3 Connect does not hold. Routes a server reported
 * by itself and routes signed in through Connect are left out: both come back on their own.
 */
export function savedMachines(catalog: ConnectionCatalogDocument): ReadonlyArray<SavedMachine> {
  const disabled = new Set<string>(catalog.disabledEnvironmentIds);
  return catalog.targets.flatMap((target): SavedMachine[] => {
    if (target._tag === "RelayConnectionTarget") return [];
    const profile = catalog.profiles.find((entry) => entry.connectionId === target.connectionId);
    const credential = catalog.credentials.find(
      (entry) => entry.connectionId === target.connectionId,
    )?.credential;
    if (profile === undefined || credential === undefined) return [];
    const enabled = !disabled.has(target.environmentId);
    if (target._tag === "SshConnectionTarget") {
      return profile._tag === "SshConnectionProfile" &&
        credential._tag === "BearerConnectionCredential"
        ? [
            {
              registration: new SshConnectionRegistration({ target, profile, credential }),
              enabled,
            },
          ]
        : [];
    }
    return profile._tag === "BearerConnectionProfile" &&
      profile.learned !== true &&
      profile.authorization !== "t3-connect"
      ? [
          {
            registration: new BearerConnectionRegistration({ target, profile, credential }),
            enabled,
          },
        ]
      : [];
  });
}

function machinesDocument(machines: ReadonlyArray<SavedMachine>): ConnectionCatalogDocument {
  return {
    schemaVersion: 1,
    targets: machines.map((machine) => machine.registration.target),
    profiles: machines.map((machine) => machine.registration.profile),
    credentials: machines.map((machine) => ({
      connectionId: machine.registration.target.connectionId,
      credential: machine.registration.credential,
    })),
    remoteDpopTokens: [],
    disabledEnvironmentIds: [
      ...new Set(
        machines
          .filter((machine) => !machine.enabled)
          .map((machine) => machine.registration.target.environmentId),
      ),
    ],
  };
}

const encodeMachines = Schema.encodeSync(ConnectionCatalogDocument);
const decodeMachines = Schema.decodeUnknownOption(ConnectionCatalogDocument);
const decodePairingKey = Schema.decodeUnknownOption(PairingKey);
const decodeConnectService = Schema.decodeUnknownOption(ConnectServiceSettings);
const decodeCertificates = Schema.decodeUnknownOption(
  Schema.Array(Schema.Struct({ origin: Schema.String, alias: Schema.String })),
);
const decodeObject = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const decodeSource = Schema.decodeUnknownOption(
  Schema.Struct({
    createdAt: Schema.String,
    app: Schema.NullOr(Schema.String),
    device: Schema.NullOr(Schema.String),
  }),
);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export interface SettingsFileSource {
  readonly createdAt: string;
  readonly app: string | null;
  readonly device: string | null;
}

/**
 * The app's part of a settings file, as JSON. The SSH key, config and host keys are added by
 * the native module, which also encrypts the whole file; the private SSH key never comes here.
 * The pairing key goes in only when a machine in the file needs it.
 */
export function encodeAppSettings(content: SettingsContent, source: SettingsFileSource): string {
  return encodeJson({
    source,
    machines: encodeMachines(machinesDocument(content.machines)),
    ...(content.pairingKey !== null && content.machines.some(usesPairingKey)
      ? { pairingKey: content.pairingKey }
      : {}),
    clientCertificates: content.clientCertificates,
    ...(content.connectService === null ? {} : { connectService: content.connectService }),
    preferences: settingsPreferences(content.preferences),
  });
}

export interface OpenedSettingsFile {
  readonly content: SettingsContent;
  readonly source: SettingsFileSource | null;
  /** Parts this version of the app could not read. The rest of the file still imports. */
  readonly unreadable: ReadonlyArray<string>;
}

/** Each part is read on its own, so one this version cannot read does not lose the others. */
export function readSettingsFile(opened: NativeSettingsFile): OpenedSettingsFile {
  const unreadable: string[] = [];
  const app = Option.getOrNull(Option.flatMap(decodeJson(opened.app ?? "{}"), decodeObject));
  if (app === null) unreadable.push("everything except the SSH settings");
  const part = <A>(name: string, key: string, decode: (value: unknown) => Option.Option<A>) => {
    const value = app?.[key];
    if (value === undefined || value === null) return null;
    const decoded = Option.getOrNull(decode(value));
    if (decoded === null) unreadable.push(name);
    return decoded;
  };
  const pairingKey = part("the pairing key", "pairingKey", decodePairingKey);
  const catalog = part("the saved machines", "machines", decodeMachines);
  const machines = catalog === null ? [] : savedMachines(catalog);
  const usable = machines.filter((machine) => pairingKey !== null || !usesPairingKey(machine));
  if (usable.length < machines.length) {
    unreadable.push(
      `${machines.length - usable.length} machines whose sign-in needs a pairing key the file does not hold`,
    );
  }
  const source = Option.getOrNull(decodeSource(app?.source));
  return {
    content: {
      sshKey: opened.key,
      sshConfig: opened.config ?? "",
      knownHosts: opened.knownHosts,
      machines: usable,
      pairingKey,
      clientCertificates:
        part("the certificate choices", "clientCertificates", decodeCertificates) ?? [],
      connectService: part("the Connect service", "connectService", decodeConnectService),
      preferences: settingsPreferences(part("the preferences", "preferences", decodeObject) ?? {}),
    },
    source,
    unreadable,
  };
}

export type ImportGroup = "ssh" | "machines" | "certificates" | "connect" | "preferences";

export interface ImportItem {
  readonly id: string;
  readonly group: ImportGroup;
  readonly title: string;
  readonly detail: string;
  /**
   * "add" changes nothing this device already has. "replace" does, so the person has to switch
   * it on. "same" is already here and has nothing to do.
   */
  readonly action: "add" | "replace" | "same";
  /** What switching a "replace" on costs. */
  readonly warning?: string;
}

/** The Connect service a device talks to now, saved or built in. */
export interface ConnectServiceInUse {
  readonly relayUrl: string | null;
  readonly clerkPublishableKey: string | null;
  readonly clerkJwtTemplate: string | null;
}

const MACHINE = "machine:";
const CERTIFICATE = "certificate:";

const samePairingKey = (left: PairingKey | null, right: PairingKey | null) =>
  left !== null && right !== null && left.x === right.x && left.y === right.y && left.d === right.d;

const connectionId = (machine: SavedMachine) => machine.registration.target.connectionId;

function machineAddress(machine: SavedMachine): string {
  const { registration } = machine;
  if (registration._tag === "BearerConnectionRegistration") {
    return `${registration.profile.httpBaseUrl.replace(/\/+$/u, "")}, paired with a link`;
  }
  const { alias, hostname, username } = registration.profile.target;
  const host = username === null ? hostname : `${username}@${hostname}`;
  return `${alias === hostname ? host : `${alias} (${host})`}, over SSH`;
}

/** Machines paired on this device whose sign-in stops working if its pairing key is replaced. */
function machinesTiedToThisDevice(file: SettingsContent, device: SettingsContent) {
  if (device.pairingKey === null || samePairingKey(file.pairingKey, device.pairingKey)) return [];
  const inFile = new Set(file.machines.map(connectionId));
  return device.machines.filter(
    (machine) => usesPairingKey(machine) && !inFile.has(connectionId(machine)),
  );
}

function sshItems(file: SettingsContent, device: SettingsContent): ImportItem[] {
  const items: ImportItem[] = [];
  if (file.sshKey !== null) {
    const same = device.sshKey?.fingerprint === file.sshKey.fingerprint;
    items.push({
      id: "ssh-key",
      group: "ssh",
      title: "SSH key",
      detail: file.sshKey.fingerprint,
      action: same ? "same" : device.sshKey === null ? "add" : "replace",
      ...(same || device.sshKey === null
        ? {}
        : {
            warning: `This device has another key (${device.sshKey.fingerprint}). Hosts that only know that key stop accepting this device.`,
          }),
    });
  }
  if (file.sshConfig.trim() !== "") {
    const hosts = parseSshConfig(file.sshConfig).hosts.map((host) => host.alias);
    const same = device.sshConfig === file.sshConfig;
    const empty = device.sshConfig.trim() === "";
    items.push({
      id: "ssh-config",
      group: "ssh",
      title: "SSH config",
      detail: hosts.length === 0 ? "No hosts" : `Hosts: ${hosts.join(", ")}`,
      action: same ? "same" : empty ? "add" : "replace",
      ...(same || empty ? {} : { warning: "Replaces the SSH config on this device." }),
    });
  }
  if (file.knownHosts.length > 0) {
    const known = new Set(device.knownHosts.map((host) => host.line));
    const names = new Set(device.knownHosts.flatMap((host) => host.names));
    const fresh = file.knownHosts.filter((host) => !known.has(host.line));
    const added = fresh.filter((host) => !host.names.some((name) => names.has(name)));
    const kept = fresh.length - added.length;
    items.push({
      id: "known-hosts",
      group: "ssh",
      title: "Trusted host keys",
      detail: [
        added.length > 0
          ? `${added.length} to add`
          : count(file.knownHosts.length, "host key", "host keys"),
        ...(added.length > 0 && file.knownHosts.length > fresh.length
          ? [`${file.knownHosts.length - fresh.length} already here`]
          : []),
        ...(kept > 0 ? [`${kept} kept as this device has them`] : []),
      ].join(", "),
      action: added.length > 0 ? "add" : "same",
    });
  }
  return items;
}

function machineItems(file: SettingsContent, device: SettingsContent): ImportItem[] {
  const tied = machinesTiedToThisDevice(file, device).map(
    (machine) => machine.registration.target.label,
  );
  return file.machines.map((machine): ImportItem => {
    const here = device.machines.find((entry) => connectionId(entry) === connectionId(machine));
    const same = here !== undefined && Equal.equals(here.registration, machine.registration);
    const costsPairings = usesPairingKey(machine) && tied.length > 0;
    const warnings = [
      ...(here === undefined || same
        ? []
        : ["Already on this device. Replaces its saved sign-in with the one in the file."]),
      ...(costsPairings
        ? [
            `Its sign-in is tied to the other install's pairing key. Importing it moves this app to that key, and these machines paired here need pairing again: ${tied.join(", ")}.`,
          ]
        : []),
    ];
    return {
      id: `${MACHINE}${connectionId(machine)}`,
      group: "machines",
      title: machine.registration.target.label,
      detail: machineAddress(machine),
      action: same ? "same" : warnings.length > 0 ? "replace" : "add",
      ...(warnings.length > 0 && !same ? { warning: warnings.join(" ") } : {}),
    };
  });
}

function certificateItems(file: SettingsContent, device: SettingsContent): ImportItem[] {
  return file.clientCertificates.map((choice): ImportItem => {
    const here = device.clientCertificates.find((entry) => entry.origin === choice.origin);
    return {
      id: `${CERTIFICATE}${choice.origin}`,
      group: "certificates",
      title: choice.origin.replace(/^https:\/\//u, "").replace(/\/$/u, ""),
      detail: `Certificate "${choice.alias}"`,
      action: here === undefined ? "add" : here.alias === choice.alias ? "same" : "replace",
      ...(here === undefined || here.alias === choice.alias
        ? {}
        : { warning: `This device uses "${here.alias}" for this address.` }),
    };
  });
}

function connectItems(file: SettingsContent, inUse: ConnectServiceInUse): ImportItem[] {
  const service = file.connectService;
  if (service === null) return [];
  const same =
    service.relayUrl === inUse.relayUrl &&
    service.clerkPublishableKey === inUse.clerkPublishableKey &&
    service.clerkJwtTemplate === inUse.clerkJwtTemplate;
  return [
    {
      id: "connect-service",
      group: "connect",
      title: "Connect service",
      detail: service.relayUrl.replace(/^https:\/\//u, ""),
      action: same ? "same" : inUse.relayUrl === null ? "add" : "replace",
      ...(same || inUse.relayUrl === null
        ? {}
        : {
            warning:
              "Signs you out of the Connect service this app uses now. Machines reached through it leave your list until you link them to the new one.",
          }),
    },
  ];
}

function preferenceKeys(file: SettingsContent, device: SettingsContent) {
  const here = device.preferences as Readonly<Record<string, unknown>>;
  const incoming = file.preferences as Readonly<Record<string, unknown>>;
  const fresh: PreferenceKey[] = [];
  const changed: PreferenceKey[] = [];
  for (const key of PREFERENCE_KEYS) {
    if (PREFERENCE_LABELS[key] === null || incoming[key] === undefined) continue;
    if (here[key] === undefined) fresh.push(key);
    else if (encodeJson(here[key]) !== encodeJson(incoming[key])) changed.push(key);
  }
  return { fresh, changed };
}

function preferenceItems(file: SettingsContent, device: SettingsContent): ImportItem[] {
  const { fresh, changed } = preferenceKeys(file, device);
  const names = (keys: ReadonlyArray<PreferenceKey>) =>
    keys.map((key) => PREFERENCE_LABELS[key]).join(", ");
  return [
    ...(fresh.length === 0
      ? []
      : [
          {
            id: "preferences-new",
            group: "preferences",
            title: "Preferences not set on this device",
            detail: names(fresh),
            action: "add",
          } as const,
        ]),
    ...(changed.length === 0
      ? []
      : [
          {
            id: "preferences-changed",
            group: "preferences",
            title: "Preferences this device has set differently",
            detail: names(changed),
            action: "replace",
            warning: "Replaces this device's choices with the file's.",
          } as const,
        ]),
  ];
}

/** Everything a file holds, each part compared with what this device already has. */
export function planImport(
  file: SettingsContent,
  device: SettingsContent,
  inUse: ConnectServiceInUse,
): ReadonlyArray<ImportItem> {
  return [
    ...sshItems(file, device),
    ...machineItems(file, device),
    ...certificateItems(file, device),
    ...connectItems(file, inUse),
    ...preferenceItems(file, device),
  ];
}

/** What is switched on before the person changes anything: only what replaces nothing. */
export function defaultImportSelection(items: ReadonlyArray<ImportItem>): ReadonlySet<string> {
  return new Set(items.filter((item) => item.action === "add").map((item) => item.id));
}

export interface ImportInstructions {
  readonly sshKey: "skip" | "add" | "replace";
  readonly sshConfig: "skip" | "add" | "replace";
  readonly knownHosts: "skip" | "add";
  readonly machines: ReadonlyArray<SavedMachine>;
  /** Stored before the machines are saved; null leaves this device's own key alone. */
  readonly pairingKey: PairingKey | null;
  readonly clientCertificates: ReadonlyArray<ClientCertificateChoice>;
  readonly connectService: ConnectServiceSettings | null;
  readonly preferences: Partial<Preferences>;
}

/**
 * What to write for the items the person left switched on. Only those are written: nothing on
 * this device is removed, and an item that is "same" or switched off is not touched.
 */
export function importInstructions(
  file: SettingsContent,
  device: SettingsContent,
  items: ReadonlyArray<ImportItem>,
  selected: ReadonlySet<string>,
): ImportInstructions {
  const chosen = new Map(
    items
      .filter((item) => item.action !== "same" && selected.has(item.id))
      .map((item) => [item.id, item]),
  );
  const mode = (id: string) => {
    const action = chosen.get(id)?.action;
    return action === "add" || action === "replace" ? action : "skip";
  };
  const machines = file.machines.filter((machine) =>
    chosen.has(`${MACHINE}${connectionId(machine)}`),
  );
  const { fresh, changed } = preferenceKeys(file, device);
  const preferences: Record<string, unknown> = {};
  const from = file.preferences as Readonly<Record<string, unknown>>;
  if (chosen.has("preferences-new")) for (const key of fresh) preferences[key] = from[key];
  if (chosen.has("preferences-changed")) for (const key of changed) preferences[key] = from[key];
  return {
    sshKey: mode("ssh-key"),
    sshConfig: mode("ssh-config"),
    knownHosts: chosen.has("known-hosts") ? "add" : "skip",
    machines,
    pairingKey:
      machines.some(usesPairingKey) && !samePairingKey(file.pairingKey, device.pairingKey)
        ? file.pairingKey
        : null,
    clientCertificates: file.clientCertificates.filter((choice) =>
      chosen.has(`${CERTIFICATE}${choice.origin}`),
    ),
    connectService: chosen.has("connect-service") ? file.connectService : null,
    preferences: preferences as Partial<Preferences>,
  };
}

/** The least a passphrase may be. The file holds a private key and may sit in shared storage. */
export const MIN_PASSPHRASE_LENGTH = 8;

export function passphraseProblem(passphrase: string, repeated: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  }
  return passphrase === repeated ? null : "The two passphrases are different.";
}

export function settingsFileName(now: Date): string {
  return `catgirl-code-settings-${now.toISOString().slice(0, 10)}.cgsettings`;
}

export interface SshImportResult {
  readonly keyImported: boolean;
  readonly configImported: boolean;
  readonly knownHostsAdded: number;
  readonly knownHostsKept: number;
}

/** The writes an import makes, so the order and the bookkeeping can be tested without a device. */
export interface ImportPorts {
  readonly importSsh: (
    key: ImportInstructions["sshKey"],
    config: ImportInstructions["sshConfig"],
    knownHosts: ImportInstructions["knownHosts"],
  ) => Promise<SshImportResult>;
  readonly storePairingKey: (key: PairingKey) => Promise<void>;
  readonly saveMachine: (machine: SavedMachine) => Promise<void>;
  /** False when Android must ask the person before this app may use the certificate. */
  readonly restoreCertificate: (choice: ClientCertificateChoice) => Promise<boolean>;
  readonly savePreferences: (preferences: Partial<Preferences>) => Promise<void>;
  readonly switchConnectService: (service: ConnectServiceSettings) => Promise<void>;
}

export interface ImportOutcome {
  readonly done: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<string>;
  /** Choices that are not saved yet: the person has to pick each certificate once. */
  readonly certificatesToAllow: ReadonlyArray<ClientCertificateChoice>;
  /** Something changed that the running app only reads when it starts. */
  readonly restart: boolean;
}

const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Writes what the instructions name, one part after another. A part that fails is reported and
 * the rest still runs, so one unreachable store does not lose the whole import.
 */
export async function applyImport(
  instructions: ImportInstructions,
  ports: ImportPorts,
): Promise<ImportOutcome> {
  const done: string[] = [];
  const failed: string[] = [];
  const certificatesToAllow: ClientCertificateChoice[] = [];
  let restart = false;
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (cause) {
      failed.push(`${what}: ${reason(cause)}`);
    }
  };

  if (
    instructions.sshKey !== "skip" ||
    instructions.sshConfig !== "skip" ||
    instructions.knownHosts !== "skip"
  ) {
    await attempt("SSH settings", async () => {
      const result = await ports.importSsh(
        instructions.sshKey,
        instructions.sshConfig,
        instructions.knownHosts,
      );
      if (result.keyImported) done.push("SSH key imported, and sealed with this app's own key.");
      if (result.configImported) done.push("SSH config imported.");
      if (result.knownHostsAdded > 0) {
        done.push(
          `${count(result.knownHostsAdded, "trusted host key", "trusted host keys")} added.`,
        );
      }
    });
  }

  let pairingKeyReady = true;
  const pairingKey = instructions.pairingKey;
  if (pairingKey !== null) {
    try {
      await ports.storePairingKey(pairingKey);
      restart = true;
    } catch (cause) {
      pairingKeyReady = false;
      failed.push(`Pairing key: ${reason(cause)}`);
    }
  }
  let saved = 0;
  for (const machine of instructions.machines) {
    const label = machine.registration.target.label;
    // Without its key the sign-in would be saved unusable, and would look imported.
    if (!pairingKeyReady && usesPairingKey(machine)) {
      failed.push(`${label}: not saved, because its pairing key could not be stored.`);
      continue;
    }
    const before = failed.length;
    await attempt(label, () => ports.saveMachine(machine));
    if (failed.length === before) saved += 1;
  }
  if (saved > 0) done.push(`${count(saved, "machine", "machines")} saved.`);

  for (const choice of instructions.clientCertificates) {
    await attempt(`Certificate "${choice.alias}"`, async () => {
      if (await ports.restoreCertificate(choice)) {
        done.push(`Certificate "${choice.alias}" selected again.`);
      } else {
        certificatesToAllow.push(choice);
      }
    });
  }

  const preferences = Object.keys(instructions.preferences).length;
  if (preferences > 0) {
    await attempt("Preferences", async () => {
      await ports.savePreferences(instructions.preferences);
      restart = true;
      done.push(`${count(preferences, "preference", "preferences")} imported.`);
    });
  }

  // Last: it signs out, and nothing after it should depend on the old sign-in.
  const service = instructions.connectService;
  if (service !== null) {
    await attempt("Connect service", async () => {
      await ports.switchConnectService(service);
      restart = true;
      done.push(`Connect service set to ${service.relayUrl.replace(/^https:\/\//u, "")}.`);
    });
  }

  return { done, failed, certificatesToAllow, restart };
}

const FAILURES: Readonly<Record<string, string>> = {
  ERR_SETTINGS_NOT_A_FILE: "This is not a settings file from this app.",
  ERR_SETTINGS_NEWER_VERSION:
    "This file was made by a newer version of the app. Update this app, then import it again.",
  ERR_SETTINGS_WRONG_PASSPHRASE: "That passphrase does not open this file.",
  ERR_SETTINGS_DAMAGED: "This settings file is damaged or incomplete. Export it again.",
  ERR_SETTINGS_MEMORY: "There is not enough free memory for this. Close other apps and try again.",
  ERR_SETTINGS_PASSPHRASE_MISSING: "Enter a passphrase.",
  ERR_SETTINGS_CLOSED: "Choose the settings file again.",
};

/** A failure of the native settings functions, in words for the person. */
export function settingsFailureMessage(cause: unknown): string {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
  const known = FAILURES[code];
  if (known !== undefined) return known;
  // The native bridge puts its own sentence in front of the reason.
  const message = cause instanceof Error ? cause.message : String(cause);
  const marker = "Caused by: ";
  const at = message.lastIndexOf(marker);
  return at === -1 ? message : message.slice(at + marker.length);
}

export const isWrongPassphrase = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "ERR_SETTINGS_WRONG_PASSPHRASE";
