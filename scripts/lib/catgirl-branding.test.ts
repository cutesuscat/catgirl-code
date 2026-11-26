// @effect-diagnostics nodeBuiltinImport:off - reads the committed catalogs and sources from disk.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { CATGIRL_FORK_NOTICE } from "@t3tools/shared/catgirlRelease";

import {
  KEPT_TEXT,
  REPLACED_TEXT,
  loadHashSource,
  rebrandCatalog,
  renameProduct,
} from "./catgirl-branding.ts";

const repoFile = (path: string) => NodeURL.fileURLToPath(new URL(`../../${path}`, import.meta.url));
const readCatalog = (app: string, locale: string): Record<string, unknown> =>
  JSON.parse(
    NodeFS.readFileSync(repoFile(`apps/${app}/src/i18n/translations/${locale}.json`), "utf8"),
  );
const UPSTREAM_NAME = /T3[\s-]+(?:Code|Connect)(?! for GitHub| SnapShots| · …)/;

describe("renameProduct", () => {
  it("renames the product and its tunnel, and leaves other T3 names", () => {
    expect(renameProduct('gt("Restart T3 Code to use T3 Connect")')).toBe(
      'gt("Restart Catgirl Code to use Catgirl Connect")',
    );
    expect(renameProduct("<T>Open T3\n  Code</T>")).toBe("<T>Open Catgirl\n  Code</T>");
    expect(renameProduct('"T3 Chat" "T3 Codex" "t3code"')).toBe('"T3 Chat" "T3 Codex" "t3code"');
  });

  it("names the catcode command where text names the t3 command", () => {
    expect(renameProduct('message: "Run `t3 up`, then `t3`."')).toBe(
      'message: "Run `catcode up`, then `catcode`."',
    );
    expect(renameProduct("`Same as \\`t3\\`. Run \\`t3 service status\\`.`")).toBe(
      "`Same as \\`catcode\\`. Run \\`catcode service status\\`.`",
    );
    expect(renameProduct('{ command: "t3 up --lan", label: "t3 pair" }')).toBe(
      '{ command: "catcode up --lan", label: "catcode pair" }',
    );
    // A string's own text, as the phone's Babel plugin and the catalogs pass it.
    expect(renameProduct("t3 auth pairing create")).toBe("catcode auth pairing create");
    expect(renameProduct('<code className="font-mono">t3</code>')).toBe(
      '<code className="font-mono">catcode</code>',
    );
    expect(renameProduct("<code>t3 auth pairing create</code>")).toBe(
      "<code>catcode auth pairing create</code>",
    );
    expect(renameProduct("set it in userdata/settings.json in its home (~/.t3).")).toBe(
      "set it in userdata/settings.json in its home (~/.catcode).",
    );
  });

  it("names the command in a file that has listed text, and as a plain word in the CLI's own", () => {
    const install = "/repo/apps/server/src/cli/install.ts";
    expect(
      renameProduct('withDescription("Install this version as the `t3` command.")', install),
    ).toBe('withDescription("Install this version as the `catcode` command.")');
    expect(renameProduct("`Installed t3 ${version} at ${link}. Keep using npx t3.`", install)).toBe(
      "`Installed catcode ${version} at ${link}. Keep using npx t3.`",
    );
    const uninstall = "/repo/apps/server/src/cli/uninstall.ts";
    expect(
      renameProduct(
        '"Remove t3 from this machine?" "@t3tools/x" t3code `npm uninstall -g t3`',
        uninstall,
      ),
    ).toBe('"Remove catcode from this machine?" "@t3tools/x" t3code `npm uninstall -g t3`');
    expect(
      renameProduct('"Remove t3 from this machine?"', "/repo/apps/server/src/cli/other.ts"),
    ).toBe('"Remove t3 from this machine?"');
  });

  it("leaves code that names t3 for another reason", () => {
    const code =
      'owner: "t3"; prefix = "t3"; `${HOME}/.t3`; "$HOME/.t3/x"; t3.json; "t3code"; run-t3.sh; { t3, spec }; "T3 thread"';
    expect(renameProduct(code)).toBe(code);
    const checkpoint = "const message = `t3 checkpoint ref=${ref}`;";
    expect(renameProduct(checkpoint, "/repo/apps/server/src/vcs/GitVcsDriver.ts")).toBe(checkpoint);
  });

  it("leaves the names of upstream's own things", () => {
    const text = 'appName: "T3 Code for GitHub"; "Check T3 Code SnapShots"; "Revoke T3 Code · …"';
    expect(renameProduct(text)).toBe(text);
  });

  it("leaves a file's kept text, and renames the rest of that file", () => {
    const source = 'MARKER = "Written by T3 Code: runs it."; MOVED = "T3 Code has moved.";';
    expect(renameProduct(source, "/repo/apps/desktop/src/app/DesktopCliShim.ts")).toBe(
      'MARKER = "Written by T3 Code: runs it."; MOVED = "Catgirl Code has moved.";',
    );
    expect(renameProduct(source, "C:\\repo\\apps\\desktop\\src\\app\\DesktopCliShim.ts")).toContain(
      "Written by T3 Code:",
    );
    expect(renameProduct(source, "/repo/apps/desktop/src/app/Other.ts")).not.toContain("T3 Code");
  });

  // Fails when upstream rewords or moves a marker: update KEPT_TEXT to its new text.
  it("keeps text that every listed file still contains", () => {
    for (const [file, ...kept] of KEPT_TEXT) {
      const source = NodeFS.readFileSync(repoFile(file), "utf8");
      const renamed = renameProduct(source, repoFile(file));
      for (const text of kept) {
        expect(source, `${file} no longer contains ${text}`).toContain(text);
        expect(renamed).toContain(text);
      }
    }
  });

  // Fails when upstream rewords a link or a line this build replaces: update REPLACED_TEXT.
  it("replaces text that every listed file still contains", () => {
    for (const [file, from, to] of REPLACED_TEXT) {
      const source = NodeFS.readFileSync(repoFile(file), "utf8");
      const renamed = renameProduct(source, repoFile(file));
      expect(source, `${file} no longer contains ${from}`).toContain(from);
      expect(renamed).toContain(to);
      expect(renamed).not.toContain(from);
    }
  });

  it("leaves the notice that this is a fork saying whose fork it is", () => {
    const file = repoFile("packages/shared/src/catgirlRelease.ts");
    expect(renameProduct(NodeFS.readFileSync(file, "utf8"), file)).toContain(
      '["T3", "Code"].join(" ")',
    );
    expect(CATGIRL_FORK_NOTICE).toContain("an unofficial fork of T3 Code, based on T3 Code 0.");
    expect(CATGIRL_FORK_NOTICE).toContain("not affiliated with");
  });

  it("tells a triage agent that this is a fork, in words the rename leaves alone", () => {
    const file = repoFile("apps/server/src/triage/triagePrompt.ts");
    const renamed = renameProduct(NodeFS.readFileSync(file, "utf8"), file);
    expect(renamed).toContain("This install is Catgirl Code, an unofficial fork of T3 Code.");
    expect(renamed).toContain("A Catgirl Code user is having a problem with their install");
  });
});

describe("rebrandCatalog", () => {
  const hashSource = loadHashSource(repoFile("apps/web/package.json"));
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

  it("moves a translation that names the command, and renames the command in it", () => {
    const english = "Run `t3 connect link` on the host.";
    const german = { [key(english, "ICU")]: "Führe `t3 connect link` auf dem Host aus." };
    expect(rebrandCatalog(german, { [key(english, "ICU")]: english }, hashSource)).toEqual({
      [key("Run `catcode connect link` on the host.", "ICU")]:
        "Führe `catcode connect link` auf dem Host aus.",
    });
  });

  it("renames the command in a code element, and every t3 a translator wrote", () => {
    const english = ["Use ", { t: "code", i: 1, c: "t3" }, " from any terminal."];
    const japanese = {
      [key(english, "JSX")]: [{ t: "code", i: 1, c: "t3" }, " を使う。t3 pair も。"],
    };
    const renamedEnglish = ["Use ", { t: "code", i: 1, c: "catcode" }, " from any terminal."];
    expect(rebrandCatalog(japanese, { [key(english, "JSX")]: english }, hashSource)).toEqual({
      [key(renamedEnglish, "JSX")]: [
        { t: "code", i: 1, c: "catcode" },
        " を使う。catcode pair も。",
      ],
    });
  });

  it("leaves an entry that only names upstream's own things", () => {
    const english = { abc: "Enable T3 Code SnapShots to start capturing windows." };
    const german = { abc: "Aktiviere T3 Code SnapShots, um Fenster aufzunehmen." };
    expect(rebrandCatalog(german, english, hashSource)).toEqual(german);
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
  it.each(["web", "mobile", "desktop"])(
    "re-keys every committed %s translation that names the product",
    (app) => {
      const appHashSource = loadHashSource(repoFile(`apps/${app}/package.json`));
      const english = readCatalog(app, "en");
      // The entries whose English the rename changes: the product, the command, a `t3` element.
      const named = Object.keys(english).filter(
        (key) =>
          !Object.hasOwn(rebrandCatalog({ [key]: english[key] }, english, appHashSource), key),
      );
      expect(named.length).toBeGreaterThan(0);
      for (const locale of ["en", "de", "ja", "sv"]) {
        const unknown: string[] = [];
        const catalog = readCatalog(app, locale);
        const rebranded = rebrandCatalog(catalog, english, appHashSource, (entry) =>
          unknown.push(entry),
        );
        expect(unknown).toEqual([]);
        expect(Object.keys(rebranded)).toHaveLength(Object.keys(catalog).length);
        expect(JSON.stringify(rebranded)).not.toMatch(UPSTREAM_NAME);
        const moved = Object.keys(rebranded).filter((entry) => !Object.hasOwn(catalog, entry));
        expect(moved).toHaveLength(named.length);
      }
    },
  );
});
