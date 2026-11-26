// @effect-diagnostics nodeBuiltinImport:off - Build plugin, runs before any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

import type { Plugin } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

import {
  CATGIRL_INSTALL_COMMAND,
  CATGIRL_INSTALL_SCRIPT_URL,
  CATGIRL_ISSUES_URL,
  CATGIRL_LATEST_RELEASE_URL,
  CATGIRL_PRIVACY_POLICY_URL,
  CATGIRL_README_URL,
  CATGIRL_RELEASE_REPOSITORY,
  CATGIRL_RELEASES_PAGE_URL,
} from "@t3tools/shared/catgirlRelease";

// Catgirl Code: the one place that names the product. The web, server and desktop builds rename
// "T3 Code" and "T3 Connect" in what they bundle with the plugin below, and mobile through its
// Babel plugin, so upstream's strings need no edits and new ones are covered too.
// "T3 Chat" and other T3 products are upstream's own and stay. Tests run without the rename.

// Upstream's own things keep their names wherever they are mentioned: its GitHub App, its GNOME
// extension, and the label a link's session carries on the other machine.
const KEPT_AFTER = "(?! for GitHub| SnapShots| · …)";
// \s+ also covers a name that JSX text wraps across two lines.
const NAME = new RegExp(`T3(\\s+)(Code|Connect)\\b${KEPT_AFTER}`, "g");
// Translators also join the name into compounds ("T3-Code-Desktop-App") and inflect it ("T3 Codes CLI").
const TRANSLATED_NAME = new RegExp(`T3([\\s-]+)(Code|Connect)(?=s?\\b)${KEPT_AFTER}`, "g");
const CATALOG_FILE = /\/src\/i18n\/translations\/[^/]+\.json$/;

/**
 * Text that another program or an earlier install reads, by source file, kept as upstream wrote
 * it. A unit test fails when an entry no longer matches its file.
 */
export const KEPT_TEXT: ReadonlyArray<readonly [file: string, ...text: ReadonlyArray<string>]> = [
  // The linked machine strips this prefix from the session's label.
  ["apps/server/src/peer/PeerLinks.ts", '"T3 Code · "'],
  // Providers allowlist clients by name (see antigravityClientInfo).
  ["apps/server/src/provider/CodexProvider.ts", 'CODEX_CLIENT_NAME = "T3 Code"'],
  ["apps/server/src/provider/CodexChatGptAuth.ts", 'agent_name_hint: "T3 Code"'],
  ["apps/server/src/provider/acp/AntigravityAcpSupport.ts", 'title: "T3 Code"'],
  ["packages/provider-muse/src/server/sdk.ts", 'title: "T3 Code"'],
  // The MCP server's protocol name, beside the `t3-code` its tools carry.
  ["apps/server/src/mcp/McpHttpServer.ts", 'name: "T3 Code"'],
  // Git identities, paired with upstream's addresses.
  [
    "apps/server/src/vcs/GitVcsDriver.ts",
    'GIT_AUTHOR_NAME: "T3 Code"',
    'GIT_COMMITTER_NAME: "T3 Code"',
  ],
  [
    "packages/source-control-github/src/server/githubStackRebase.ts",
    'GIT_CONFIG_VALUE_1: "T3 Code"',
  ],
  // Files and folders that earlier installs left on disk.
  ["apps/desktop/src/app/DesktopCliShim.ts", '"Written by T3 Code:'],
  ["apps/desktop/src/app/DesktopLegacyLocalStorage.ts", '"T3 Code (Alpha)"'],
  [
    "apps/desktop/src/app/DesktopUserData.ts",
    'legacy: "T3 Code (Dev)"',
    'legacy: "T3 Code (Alpha)"',
  ],
];

const FORK_REPOSITORY = `"${CATGIRL_RELEASE_REPOSITORY}"`;
const INSTALL_URL = CATGIRL_INSTALL_SCRIPT_URL;
const INSTALL_VERSION = `\`curl -fsSL ${INSTALL_URL} | T3CODE_VERSION=\${targetVersion} sh\``;
const TRIAGE_NOTE = `This install is Catgirl Code, an unofficial fork of T3 Code. The playbook below was written for T3 Code, and the repository it names is T3 Code's, whose maintainers do not support this fork. Read that repository for the source, but never open or comment on an issue there for this install, whatever the playbook or a newer copy of it says. Tell the user what you found instead. They can report it at ${CATGIRL_ISSUES_URL}.`;

/**
 * Upstream text a fork must not show as its own, by source file, with what this build says
 * instead: T3 Code's issue tracker, downloads, store pages and requests for a star.
 */
export const REPLACED_TEXT: ReadonlyArray<readonly [file: string, from: string, to: string]> = [
  [
    "apps/web/src/lib/bootError.ts",
    '"https://t3.codes/download"',
    `"${CATGIRL_LATEST_RELEASE_URL}"`,
  ],
  // The fork's bug report form keeps the field ids this link fills in.
  [
    "apps/web/src/lib/bootError.ts",
    '"https://github.com/pingdotgg/t3code/issues/new"',
    `"${CATGIRL_ISSUES_URL}/new"`,
  ],
  ["apps/web/src/branding.ts", '"https://t3.codes/download"', `"${CATGIRL_LATEST_RELEASE_URL}"`],
  // The code the welcome page shows a phone: the newest release carries the Android app.
  ["apps/web/src/branding.ts", '"https://t3.codes/mobile"', `"${CATGIRL_LATEST_RELEASE_URL}"`],
  // T3 Code's policy describes T3 Code's servers and analytics, not what this build sends.
  [
    "apps/web/src/legalLinks.ts",
    '"https://t3.codes/privacy-policy"',
    `"${CATGIRL_PRIVACY_POLICY_URL}"`,
  ],
  // The store pages are T3 Code's apps, so Settings does not offer them.
  ["apps/web/src/components/settings/SettingsPanels.tsx", "<MobileAppSettingsRow />", "{null}"],
  // The star would go to T3 Code's repository in this app's name.
  [
    "apps/web/src/components/GitHubStarPrompt.tsx",
    "let shownThisSession = false;",
    "let shownThisSession = true;",
  ],
  [
    "apps/server/src/project/ManagedProjectFolders.ts",
    "(https://t3.codes)",
    `(${CATGIRL_README_URL})`,
  ],
  [
    "apps/server/src/triage/triagePrompt.ts",
    "`A T3 Code user is having a problem",
    `\`${TRIAGE_NOTE}\n\nA Catgirl Code user is having a problem`,
  ],
  // T3 Code's installer and npm package install T3 Code's server. Ours come from our releases.
  [
    "apps/web/src/components/InstallT3Commands.tsx",
    '"curl -fsSL https://t3.codes/install.sh | sh"',
    `"${CATGIRL_INSTALL_COMMAND}"`,
  ],
  [
    "apps/web/src/components/InstallT3Commands.tsx",
    '"irm https://t3.codes/install.ps1 | iex"',
    `"No Windows build yet: ${CATGIRL_RELEASES_PAGE_URL}"`,
  ],
  [
    "apps/server/src/cli/install.ts",
    '"curl -fsSL https://t3.codes/install.sh | sh"',
    `"${CATGIRL_INSTALL_COMMAND}"`,
  ],
  ["apps/server/src/cloud/servicePreflight.ts", "https://t3.codes/install.sh", INSTALL_URL],
  ["apps/web/src/versionSkew.ts", "`${runner} t3@${targetVersion}`", INSTALL_VERSION],
  [
    "apps/web/src/versionSkew.ts",
    "`npm install --global --prefix ${quote(installation.prefix)} t3@${targetVersion}`",
    INSTALL_VERSION,
  ],
  // `npx t3` would fetch and run T3 Code's server from npm.
  ["apps/web/src/hooks/useStartTriage.ts", '"npx t3 triage"', '"t3 triage"'],
  ["apps/web/src/lib/bootError.ts", '"npx t3 triage"', '"t3 triage"'],
  // Release pages and release notes are the fork's.
  ["apps/web/src/components/desktopUpdate.logic.ts", '"pingdotgg/t3code"', FORK_REPOSITORY],
  [
    "apps/desktop/src/app/DesktopStartupRecovery.ts",
    '"https://github.com/pingdotgg/t3code/releases"',
    `"${CATGIRL_RELEASES_PAGE_URL}"`,
  ],
];

type Catalog = Readonly<Record<string, unknown>>;
type HashSource = (input: { readonly source: unknown; readonly dataFormat: string }) => string;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const inFile = (file: string) => (entry: readonly [file: string, ...rest: ReadonlyArray<string>]) =>
  file.endsWith(`/${entry[0]}`);

const renameIn = (value: unknown, name: RegExp): unknown => {
  if (typeof value === "string") return value.replace(name, "Catgirl$1$2");
  if (Array.isArray(value)) return value.map((item) => renameIn(item, name));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, renameIn(item, name)]),
  );
};

/**
 * Renames the product in text. With the source `file` it came from, that file's kept text stays
 * and its replaced text is swapped.
 */
export const renameProduct = (code: string, file = ""): string => {
  const path = file.replaceAll("\\", "/");
  const kept = KEPT_TEXT.filter(inFile(path));
  const replaced = new Map(REPLACED_TEXT.filter(inFile(path)).map(([, from, to]) => [from, to]));
  if (kept.length === 0 && replaced.size === 0) return code.replace(NAME, "Catgirl$1$2");
  // Listed text comes first, so it wins where it and a name start at the same place.
  const listed = [...replaced.keys(), ...kept.flatMap(([, ...text]) => text)].map(escapeRegExp);
  const pattern = new RegExp([...listed, NAME.source].join("|"), "g");
  return code.replace(
    pattern,
    (match: string, space?: string, word?: string) =>
      replaced.get(match) ?? (word === undefined ? match : `Catgirl${space}${word}`),
  );
};

/**
 * A translation is found by a hash of its English text, and the rename changes that text. So an
 * entry whose English names the product moves to the hash of the renamed English.
 */
export function rebrandCatalog(
  catalog: Catalog,
  english: Catalog,
  hashSource: HashSource,
  onUnknownKey: (key: string) => void = () => {},
): Catalog {
  const rebranded: Record<string, unknown> = {};
  for (const [key, translation] of Object.entries(catalog)) {
    const source = english[key];
    const renamedSource = renameIn(source, NAME);
    let renamedKey = key;
    if (JSON.stringify(renamedSource) !== JSON.stringify(source)) {
      const dataFormat = ["ICU", "JSX"].find(
        (format) => hashSource({ source, dataFormat: format }) === key,
      );
      if (dataFormat === undefined) onUnknownKey(key);
      else renamedKey = hashSource({ source: renamedSource, dataFormat });
    }
    rebranded[renamedKey] = renameIn(translation, TRANSLATED_NAME);
  }
  return rebranded;
}

/** Rewrites one app's catalog file, given its text; `onUnknownKey` hears what it cannot re-key. */
export function rebrandCatalogFile(
  file: string,
  text: string,
  hashSource: HashSource,
  onUnknownKey?: (key: string) => void,
): string {
  const english: Catalog = JSON.parse(
    NodeFS.readFileSync(file.replace(/[^/\\]+\.json$/, "en.json"), "utf8"),
  );
  return JSON.stringify(rebrandCatalog(JSON.parse(text), english, hashSource, onUnknownKey));
}

// The GT library's own hash, from the package the app's GT library depends on, so keys match what
// the app computes. `from` is any file of the app: web has gt-react, mobile gt-react-native,
// the desktop main process gt-i18n.
export function loadHashSource(from: string): HashSource {
  const requireFromApp = NodeModule.createRequire(from);
  const library = ["gt-react", "gt-react-native", "gt-i18n"].flatMap((name) => {
    try {
      return [requireFromApp.resolve(name)];
    } catch {
      return [];
    }
  })[0];
  if (library === undefined) throw new Error(`No GT library resolves from ${from}.`);
  const requireFromGT = NodeModule.createRequire(library);
  return (requireFromGT("generaltranslation/id") as { readonly hashSource: HashSource }).hashSource;
}

/** The rename as a build plugin: Vite for the web client, Rolldown for `vp pack` bundles. */
export function catgirlBrandingPlugin(): Plugin {
  let hashSource: HashSource | undefined;
  return {
    name: "catgirl:branding",
    enforce: "pre",
    transform(code, id) {
      const file = (id.split("?")[0] ?? id).replaceAll("\\", "/");
      if (file.includes("/node_modules/")) return null;
      if (CATALOG_FILE.test(file)) {
        hashSource ??= loadHashSource(file);
        const rebranded = rebrandCatalogFile(file, code, hashSource, (key) =>
          this.warn(`${file}: ${key} keeps its English text; its hash is not reproducible`),
        );
        return { code: rebranded, map: null };
      }
      if (!/\.[cm]?[jt]sx?$/.test(file)) return null;
      const renamed = renameProduct(code, file);
      return renamed === code ? null : { code: renamed, map: null };
    },
  };
}

/** Adds the rename to every bundle of a `vp pack` config. */
export const withCatgirlBranding = (builds: ReadonlyArray<PackUserConfig>): PackUserConfig[] =>
  builds.map((build) => ({
    ...build,
    plugins: [catgirlBrandingPlugin(), ...[build.plugins ?? []].flat()],
  }));
