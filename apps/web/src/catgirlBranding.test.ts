// @effect-diagnostics nodeBuiltinImport:off - reads the committed catalogs from disk.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { loadHashSource, rebrandCatalog, renameProduct } from "../vite/catgirlBranding";

const readCatalog = (locale: string): Record<string, unknown> =>
  JSON.parse(
    NodeFS.readFileSync(new URL(`./i18n/translations/${locale}.json`, import.meta.url), "utf8"),
  );

describe("renameProduct", () => {
  it("renames the product and its tunnel, and leaves other T3 names", () => {
    expect(renameProduct('gt("Restart T3 Code to use T3 Connect")')).toBe(
      'gt("Restart Catgirl Code to use Catgirl Connect")',
    );
    expect(renameProduct("<T>Open T3\n  Code</T>")).toBe("<T>Open Catgirl\n  Code</T>");
    expect(renameProduct('"T3 Chat" "T3 Codex" "t3 code"')).toBe('"T3 Chat" "T3 Codex" "t3 code"');
  });
});

describe("rebrandCatalog", () => {
  const hashSource = loadHashSource();
  const key = (source: unknown, dataFormat: string) => hashSource({ source, dataFormat });

  it("moves a translation to the hash of the renamed English, and renames its text", () => {
    const plain = "Restart T3 Code";
    const tree = ["Link ", { t: "b", i: 1, c: "T3 Connect" }];
    const english = { [key(plain, "ICU")]: plain, [key(tree, "JSX")]: tree, same: "Settings" };
    const german = {
      [key(plain, "ICU")]: "T3 Code neu starten (T3 Codes CLI)",
      [key(tree, "JSX")]: ["Verknüpfe ", { t: "b", i: 1, c: "T3-Connect-Konto" }],
      same: "Einstellungen",
    };

    expect(rebrandCatalog(german, english, hashSource)).toEqual({
      [key("Restart Catgirl Code", "ICU")]: "Catgirl Code neu starten (Catgirl Codes CLI)",
      [key(["Link ", { t: "b", i: 1, c: "Catgirl Connect" }], "JSX")]: [
        "Verknüpfe ",
        { t: "b", i: 1, c: "Catgirl-Connect-Konto" },
      ],
      same: "Einstellungen",
    });
  });

  it("reports an entry whose hash it cannot reproduce, and leaves its key", () => {
    const unknown: string[] = [];
    const rebranded = rebrandCatalog(
      { abc: "T3 Code öffnen" },
      { abc: "Open T3 Code" },
      hashSource,
      (entry) => unknown.push(entry),
    );
    expect(unknown).toEqual(["abc"]);
    expect(rebranded).toEqual({ abc: "Catgirl Code öffnen" });
  });

  // Fails when upstream adds product copy this cannot re-key, such as one with a $context.
  it("re-keys every committed translation that names the product", () => {
    const english = readCatalog("en");
    const named = Object.values(english).filter(
      (source) => renameProduct(JSON.stringify(source)) !== JSON.stringify(source),
    );
    expect(named.length).toBeGreaterThan(0);
    for (const locale of ["en", "de", "ja", "sv"]) {
      const unknown: string[] = [];
      const catalog = readCatalog(locale);
      const rebranded = rebrandCatalog(catalog, english, hashSource, (entry) =>
        unknown.push(entry),
      );
      expect(unknown).toEqual([]);
      expect(Object.keys(rebranded)).toHaveLength(Object.keys(catalog).length);
      expect(JSON.stringify(rebranded)).not.toMatch(/T3[\s-]+(?:Code|Connect)/);
      const moved = Object.keys(rebranded).filter((entry) => !Object.hasOwn(catalog, entry));
      expect(moved).toHaveLength(named.length);
    }
  });
});
