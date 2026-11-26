// @effect-diagnostics globalDate:off globalConsole:off - Runs in bin.ts before the CLI and its Effect runtime load.
// Catgirl Connect on a machine: `t3 connect --relay`, and the service a machine saved, read at start.
import type { ConnectServiceSettings } from "@t3tools/contracts";
import { resolveCatgirlHome } from "@t3tools/shared/catgirlHome";
import {
  connectDiagnosticsOffers,
  connectHostedAppUrl,
  connectKeyFingerprint,
  connectServiceName,
  declineConnectIdentityChange,
  parseConnectSetupLink,
  sameConnectFingerprint,
} from "@t3tools/shared/connectDocument";
import { CONNECT_DIAGNOSTICS_LABELS } from "@t3tools/shared/connectDocumentCopy";
import {
  connectFingerprintEmoji,
  connectFingerprintEmojiLines,
} from "@t3tools/shared/connectFingerprintEmoji";
import {
  type ConnectServiceFetch,
  checkConnectService,
  connectServiceAfterRestart,
  connectServiceEnvironment,
  parseConnectServiceSettings,
  readConnectServiceSettings,
  refreshConnectService,
} from "@t3tools/shared/connectService";
import { connectServiceCheckProblem } from "@t3tools/shared/connectServiceCopy";

const CONNECT_SERVICE_FILE = "connect-service.json";
const SERVER_START_TIMEOUT_MS = 3_000;
const SERVER_COMMANDS = new Set([undefined, "serve", "start", "__service-launcher"]);

export interface ConnectServiceStartupIo {
  readonly argv: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
  readonly homeDirectory: string;
  readonly readFile: (path: string) => string | null;
  readonly writeFile: (path: string, contents: string | null) => void;
  readonly fetch: ConnectServiceFetch;
  readonly now: () => Date;
  readonly interactive: boolean;
  readonly ask: (question: string) => Promise<boolean>;
  readonly print: (line: string) => void;
  readonly warn: (line: string) => void;
}

export type ConnectServiceStartup =
  | { readonly _tag: "Continue"; readonly argv: ReadonlyArray<string> }
  | { readonly _tag: "Exit"; readonly code: number };

function flagValue(argv: ReadonlyArray<string>, name: string) {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === `--${name}`) return { value: argv[index + 1], at: index, width: 2 };
    if (arg.startsWith(`--${name}=`)) {
      return { value: arg.slice(name.length + 3), at: index, width: 1 };
    }
  }
  return null;
}

/** Where the server keeps its state: `--base-dir`, else `T3CODE_HOME`, else `~/.catcode`; then `userdata`. */
export function connectServiceFilePath(
  io: Pick<ConnectServiceStartupIo, "argv" | "env" | "homeDirectory">,
) {
  const explicit = flagValue(io.argv, "base-dir")?.value?.trim() || io.env.T3CODE_HOME?.trim();
  const base = explicit
    ? explicit.replace(/^~(?=$|\/)/u, io.homeDirectory)
    : resolveCatgirlHome(io.homeDirectory);
  return `${base.replace(/\/+$/u, "")}/userdata/${CONNECT_SERVICE_FILE}`;
}

/** The emoji, each name under its emoji, then the hex, all lined up after `label`. */
function identityLines(label: string, fingerprint: string): ReadonlyArray<string> {
  const lines = connectFingerprintEmojiLines(fingerprint);
  if (lines === null) return [`${label}${fingerprint}`];
  const indent = " ".repeat(label.length);
  return [`${label}${lines.emoji}`, `${indent}${lines.names}`, `${indent}${fingerprint}`];
}

/** For a one-line warning: the emoji, then the hex. */
function identityInline(fingerprint: string): string {
  const row = connectFingerprintEmoji(fingerprint);
  return row === null ? fingerprint : `${row.map(({ emoji }) => emoji).join(" ")}  ${fingerprint}`;
}

const describe = (settings: ConnectServiceSettings, linkFingerprint: string | null) => {
  if (!settings.connect) {
    return [
      `Catgirl Connect service at ${settings.relayUrl}`,
      "  It publishes no signed identity (an older service), so there is nothing to check it against.",
    ];
  }
  const fingerprint = connectKeyFingerprint(settings.connect.key) ?? "unknown";
  const offers = connectDiagnosticsOffers(settings.connect.document);
  const name = connectServiceName(settings.connect.document, settings.relayUrl);
  return [
    `Catgirl Connect service: ${name}`,
    `  Address:  ${settings.relayUrl}`,
    ...identityLines("  Identity: ", fingerprint),
    linkFingerprint !== null && sameConnectFingerprint(linkFingerprint, fingerprint)
      ? "  Matches the setup link."
      : "  Check this matches what the service's operator gave you.",
    ...Object.keys(offers).map(
      (kind) =>
        `  Offers to receive ${CONNECT_DIAGNOSTICS_LABELS[kind as keyof typeof offers].noun.toLowerCase()}: off unless you turn it on.`,
    ),
  ];
};

const fingerprintOf = (key: string) => connectKeyFingerprint(key) ?? key;

async function setUpRelay(
  io: ConnectServiceStartupIo,
  path: string,
  saved: ConnectServiceSettings | null,
  address: string,
): Promise<ConnectServiceSettings | null | "failed"> {
  if (address === "none" || address === "built-in") {
    io.writeFile(path, null);
    io.print(
      "Removed the saved Catgirl Connect service. This machine uses its build's service again.",
    );
    return null;
  }
  const link = parseConnectSetupLink(address);
  const draft = {
    relayUrl: address,
    clerkPublishableKey: "",
    clerkJwtTemplate: "",
    clerkCliOAuthClientId: "",
  };
  const check = await checkConnectService(draft, { fetch: io.fetch, saved, now: io.now() });
  if (check._tag === "IdentityChanged") {
    const change = check.settings.connect?.identityChange;
    io.writeFile(path, JSON.stringify(check.settings));
    io.warn(
      [
        "This Connect service's identity changed.",
        ...identityLines("  Trusted until now: ", fingerprintOf(check.settings.connect?.key ?? "")),
        ...identityLines("  New identity:      ", fingerprintOf(change?.envelope.key ?? "")),
        "  Nothing from it is used. Only trust it if the service's operator told you it changed.",
      ].join("\n"),
    );
    if (
      !io.interactive ||
      !(await io.ask(`Trust ${fingerprintOf(change?.envelope.key ?? "")}? [y/N] `))
    ) {
      const connect = check.settings.connect;
      if (connect) {
        io.writeFile(
          path,
          JSON.stringify({ ...check.settings, connect: declineConnectIdentityChange(connect) }),
        );
      }
      return "failed";
    }
    const trusted = connectServiceAfterRestart(check.settings, "trust-new-identity", io.now());
    if (trusted === null) {
      io.warn("That identity's document can no longer be used. Nothing was changed.");
      return "failed";
    }
    io.writeFile(path, JSON.stringify(trusted));
    return trusted;
  }
  if (check._tag !== "Ready") {
    io.warn(connectServiceCheckProblem(check));
    return "failed";
  }
  for (const line of describe(check.settings, link.fingerprint)) io.print(line);
  const confirmedByLink = link.fingerprint !== null && check.settings.connect !== undefined;
  if (!confirmedByLink) {
    if (!io.interactive) {
      if (check.settings.connect) {
        io.warn(
          "Without a terminal, give the setup link with its #fp= so the identity can be checked.",
        );
        return "failed";
      }
    } else if (!(await io.ask("Use this service on this machine? [y/N] "))) {
      return "failed";
    }
  }
  io.writeFile(path, JSON.stringify(check.settings));
  return check.settings;
}

async function refreshAtServerStart(
  io: ConnectServiceStartupIo,
  path: string,
  saved: ConnectServiceSettings,
): Promise<ConnectServiceSettings> {
  const refreshed = await refreshConnectService(saved, {
    fetch: io.fetch,
    now: io.now(),
    timeoutMs: SERVER_START_TIMEOUT_MS,
  }).catch(() => null);
  if (refreshed === null) return saved;
  let next = refreshed.settings;
  // Starting is this server's restart, so a waiting sign-in change applies now.
  if (refreshed.outcome === "restart-needed") {
    next = connectServiceAfterRestart(next, "pending", io.now()) ?? saved;
  }
  if (refreshed.outcome === "identity-changed" && !next.connect?.identityChange?.declined) {
    io.warn(
      `Catgirl Connect: the service at ${saved.relayUrl} changed its identity to ${identityInline(fingerprintOf(next.connect?.identityChange?.envelope.key ?? ""))}. Keeping the settings it last trusted. To review, run: t3 connect --relay ${saved.relayUrl}`,
    );
  }
  io.writeFile(path, JSON.stringify(next));
  return next;
}

/**
 * Before the CLI loads: handles `--relay`, re-checks a saved signed service when a server starts,
 * and fills the configuration the CLI reads. A variable already set always wins.
 */
export async function prepareConnectService(
  io: ConnectServiceStartupIo,
): Promise<ConnectServiceStartup> {
  const path = connectServiceFilePath(io);
  let saved = readConnectServiceSettings(parseConnectServiceSettings(io.readFile(path)));
  let argv = [...io.argv];
  const command = argv[2]?.startsWith("-") ? undefined : argv[2];
  const relay = command === "connect" ? flagValue(argv, "relay") : null;
  if (relay !== null) {
    if (!relay.value) {
      io.warn("Give the Connect address or setup link after --relay, or `none` to remove it.");
      return { _tag: "Exit", code: 2 };
    }
    const result = await setUpRelay(io, path, saved, relay.value);
    if (result === "failed") return { _tag: "Exit", code: 1 };
    if (result === null) return { _tag: "Exit", code: 0 };
    saved = result;
    argv.splice(relay.at, relay.width);
  } else if (saved?.connect && SERVER_COMMANDS.has(command)) {
    saved = await refreshAtServerStart(io, path, saved);
  }
  if (saved === null) return { _tag: "Continue", argv };

  for (const [name, value] of Object.entries(connectServiceEnvironment(saved))) {
    if (!io.env[name]?.trim()) io.env[name] = value;
  }
  // Only an offer: the server sends to it after this machine's own yes in its settings.
  const analytics = connectDiagnosticsOffers(saved.connect?.document).analytics;
  if (analytics && !io.env.T3CODE_CONNECT_ANALYTICS_URL?.trim()) {
    io.env.T3CODE_CONNECT_ANALYTICS_URL = analytics.url;
    io.env.T3CODE_CONNECT_SERVICE_NAME = connectServiceName(
      saved.connect?.document,
      saved.relayUrl,
    );
  }
  const hostedAppUrl = connectHostedAppUrl(saved.connect?.document);
  if (hostedAppUrl !== null && !io.env.T3CODE_HOSTED_APP_URL?.trim()) {
    io.env.T3CODE_HOSTED_APP_URL = hostedAppUrl;
  }
  // A service without a hosted app has no page to approve a browser sign-in on.
  if (
    saved.connect &&
    hostedAppUrl === null &&
    !io.env.T3CODE_HOSTED_APP_URL?.trim() &&
    (command === "connect" || command === "up") &&
    (argv[3] === undefined || argv[3].startsWith("-")) &&
    !argv.includes("--headless")
  ) {
    argv = [...argv, "--headless"];
  }
  return { _tag: "Continue", argv };
}
