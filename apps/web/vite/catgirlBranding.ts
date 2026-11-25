// @effect-diagnostics nodeBuiltinImport:off -- Vite plugin, runs before any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import type { Plugin } from "vite-plus";

// \s+ also covers a name that JSX text wraps across two lines.
const NAME = /T3(\s+)(Code|Connect)\b/g;
// Translators also join the name into compounds ("T3-Code-Desktop-App") and inflect it ("T3 Codes CLI").
const TRANSLATED_NAME = /T3([\s-]+)(Code|Connect)(?=s?\b)/g;
const CATALOG_FILE = /\/src\/i18n\/translations\/[^/]+\.json$/;

type Catalog = Readonly<Record<string, unknown>>;
type HashSource = (input: { readonly source: unknown; readonly dataFormat: string }) => string;

const renameIn = (value: unknown, name: RegExp): unknown => {
  if (typeof value === "string") return value.replace(name, "Catgirl$1$2");
  if (Array.isArray(value)) return value.map((item) => renameIn(item, name));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, renameIn(item, name)]),
  );
};

/** Renames the product in source text the way the bundle's strings are renamed. */
export const renameProduct = (code: string): string => code.replace(NAME, "Catgirl$1$2");

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

// gt-react's own hash, from the package it depends on, so keys match what the app computes.
export function loadHashSource(): HashSource {
  const requireFromApp = NodeModule.createRequire(import.meta.url);
  const requireFromGT = NodeModule.createRequire(requireFromApp.resolve("gt-react"));
  return (requireFromGT("generaltranslation/id") as { readonly hashSource: HashSource }).hashSource;
}

// Catgirl Code: renames the product in display text at build time, so upstream's strings need no
// patching one by one and new ones are covered too. "T3 Chat" is a separate product and stays.
// Tests run without it, so they still assert upstream's wording.
export function catgirlBrandingPlugin(): Plugin {
  let hashSource: HashSource | undefined;
  return {
    name: "catgirl:branding",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (file.includes("/node_modules/")) return null;
      if (CATALOG_FILE.test(file)) {
        hashSource ??= loadHashSource();
        const english: Catalog = JSON.parse(
          NodeFS.readFileSync(NodePath.join(NodePath.dirname(file), "en.json"), "utf8"),
        );
        const rebranded = rebrandCatalog(JSON.parse(code), english, hashSource, (key) =>
          this.warn(
            `${NodePath.basename(file)}: ${key} keeps its English text; its hash is not reproducible`,
          ),
        );
        return { code: JSON.stringify(rebranded), map: null };
      }
      if (!/\.[cm]?[jt]sx?$/.test(file)) return null;
      const renamed = renameProduct(code);
      return renamed === code ? null : { code: renamed, map: null };
    },
  };
}
