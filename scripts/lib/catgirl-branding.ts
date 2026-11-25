// @effect-diagnostics nodeBuiltinImport:off - Build plugin, runs before any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

import type { Plugin } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

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

type Catalog = Readonly<Record<string, unknown>>;
type HashSource = (input: { readonly source: unknown; readonly dataFormat: string }) => string;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const keptIn = (file: string): ReadonlyArray<string> =>
  KEPT_TEXT.filter(([suffix]) => file.endsWith(`/${suffix}`)).flatMap(([, ...text]) => text);

const renameIn = (value: unknown, name: RegExp): unknown => {
  if (typeof value === "string") return value.replace(name, "Catgirl$1$2");
  if (Array.isArray(value)) return value.map((item) => renameIn(item, name));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, renameIn(item, name)]),
  );
};

/** Renames the product in text. With the source `file` it came from, that file's kept text stays. */
export const renameProduct = (code: string, file = ""): string => {
  const kept = keptIn(file.replaceAll("\\", "/"));
  if (kept.length === 0) return code.replace(NAME, "Catgirl$1$2");
  // Kept text comes first, so it wins where both start at the same place.
  const pattern = new RegExp(`${kept.map(escapeRegExp).join("|")}|${NAME.source}`, "g");
  return code.replace(pattern, (match: string, space?: string, word?: string) =>
    word === undefined ? match : `Catgirl${space}${word}`,
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
