// @effect-diagnostics nodeBuiltinImport:off - Reads the real installer and checks it with sh.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import * as HostProcess from "@t3tools/shared/HostProcess";

import {
  CATGIRL_INSTALL_COMMAND,
  CATGIRL_RELEASE_REPOSITORY,
  CATGIRL_RELEASES_PAGE_URL,
  CATGIRL_VERSION,
} from "@t3tools/shared/catgirlRelease";
import {
  catgirlInstallScript,
  releaseRepositoryProblem,
  releaseTagProblem,
} from "./catgirl-release.ts";

const upstream = NodeFS.readFileSync(
  NodeURL.fileURLToPath(new URL("./install.sh", import.meta.url)),
  "utf8",
);

describe("the fork's server installer", () => {
  const script = catgirlInstallScript(upstream);

  // Fails when upstream rewords a line this replaces: update INSTALL_SCRIPT_EDITS.
  it("installs from the fork's releases and names T3 Code only to say it is a fork of it", () => {
    expect(script).toContain(`repo="${CATGIRL_RELEASE_REPOSITORY}"`);
    expect(script).toContain("https://github.com/${repo}/releases/download");
    expect(script).toContain("an unofficial fork of T3 Code");
    for (const upstreamOnly of ["pingdotgg", "t3.codes", "npm install", "█"]) {
      expect(script).not.toContain(upstreamOnly);
    }
    expect(script.match(/T3 Code/g)).toHaveLength(2);
    expect(script.startsWith("#!/bin/sh\n# Catgirl Code's installer")).toBe(true);
  });

  it("is still a script sh accepts", () => {
    const check = NodeChildProcess.spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  });

  it("installs the fork's command and archives, never the t3 command", () => {
    expect(script).toContain('stem="catcode-${version}-${platform}-${arch}"');
    expect(script).toContain('"${bin_dir}/catcode"');
    expect(script).toContain('[ "$existing" = "${t3_home}/bin/catcode" ]');
    // A word t3 left in the script would name, write or look for T3 Code's command.
    expect(script.match(/(?:(?<![\w$.])|(?<=\\n|%s))t3(?![\w.])/g)).toBeNull();
    expect(script).toContain('t3_home="${T3CODE_HOME:-$(catgirl_home)}"');
  });

  it("refuses an installer it no longer recognises", () => {
    expect(() => catgirlInstallScript(upstream.replace('repo="pingdotgg/t3code"', ""))).toThrow(
      "no longer contains exactly one",
    );
  });
});

describe("the release tag", () => {
  it("is the version this source builds", () => {
    expect(releaseTagProblem(`v${CATGIRL_VERSION}`)).toBeUndefined();
    expect(releaseTagProblem("v0.1.12")).toContain(`v${CATGIRL_VERSION}`);
    expect(releaseTagProblem(CATGIRL_VERSION)).toContain("CATGIRL_BUILD");
  });
});

describe("the release repository", () => {
  it("is the one the apps fetch from", () => {
    expect(releaseRepositoryProblem(CATGIRL_RELEASE_REPOSITORY)).toBeUndefined();
    expect(releaseRepositoryProblem("pingdotgg/t3code")).toContain("CATGIRL_RELEASE_REPOSITORY");
  });
});

// The README and the repository's pages are the places outside the code that spell the repository out.
describe("the README", () => {
  it("gives the install command and the release address the code uses", () => {
    const readme = NodeFS.readFileSync(
      NodeURL.fileURLToPath(new URL("../README.md", import.meta.url)),
      "utf8",
    );
    expect(readme).toContain(CATGIRL_INSTALL_COMMAND);
    expect(readme).toContain(`T3CODE_RELEASE_BASE_URL=${CATGIRL_RELEASES_PAGE_URL}/download`);
    expect(readme).toContain("unofficial fork");
  });
});

describe("the repository's own pages", () => {
  it("name the repository the code uses, and no other", () => {
    for (const file of ["README.md", ".github/SECURITY.md", ".github/CONTRIBUTING.md"]) {
      const text = NodeFS.readFileSync(
        NodeURL.fileURLToPath(new URL(`../${file}`, import.meta.url)),
        "utf8",
      );
      const named = [...text.matchAll(/github\.com\/([\w.-]+\/catgirl-code)\b/g)].map(
        (match) => match[1],
      );
      expect(named.length, file).toBeGreaterThan(0);
      expect(new Set(named), file).toEqual(new Set([CATGIRL_RELEASE_REPOSITORY]));
    }
  });
});

/** Runs the fork's installer for a version already unpacked in an older ~/.t3, as a person would. */
const installInOldHome = () => {
  const home = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cg-install-")),
  );
  const version = NodePath.join(home, ".t3/runtime/versions/1.2.3");
  NodeFS.mkdirSync(version, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(version, ".install-complete"), "1.2.3\n");
  NodeFS.writeFileSync(NodePath.join(version, "catcode"), "#!/bin/sh\necho 'catcode v1.2.3'\n", {
    mode: 0o755,
  });
  NodeFS.mkdirSync(NodePath.join(home, ".t3/userdata"));
  NodeFS.writeFileSync(NodePath.join(home, ".t3/userdata/state.sqlite"), "threads");
  // An older install's command, which may be T3 Code's own: it stays as it is.
  NodeFS.mkdirSync(NodePath.join(home, ".local/bin"), { recursive: true });
  const oldLauncher = `#!/bin/sh\nexec '${home}/.t3/runtime/versions/1.2.3/t3' "$@"\n`;
  NodeFS.writeFileSync(NodePath.join(home, ".local/bin/t3"), oldLauncher, { mode: 0o755 });
  const installer = NodePath.join(home, "install.sh");
  NodeFS.writeFileSync(installer, catgirlInstallScript(upstream));
  const run = (binDir = NodePath.join(home, ".local/bin"), env: NodeJS.ProcessEnv = {}) =>
    new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = NodeChildProcess.spawn("sh", [installer], {
        env: {
          HOME: home,
          PATH: "/usr/bin:/bin",
          T3CODE_VERSION: "1.2.3",
          T3CODE_INSTALL_BIN_DIR: binDir,
          T3CODE_RELEASE_BASE_URL: "http://127.0.0.1:9",
          ...env,
        },
      });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    });
  return { home, oldLauncher, run };
};

describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")(
  "the fork's installer in an older home",
  () => {
    it("moves ~/.t3 to ~/.catcode, installs catcode there and leaves the old t3", async () => {
      const { home, oldLauncher, run } = installInOldHome();
      try {
        const result = await run();
        expect(result.code, result.output).toBe(0);
        expect(NodeFS.readlinkSync(NodePath.join(home, ".t3"))).toBe(".catcode");
        expect(NodeFS.lstatSync(NodePath.join(home, ".catcode")).isDirectory()).toBe(true);
        expect(NodeFS.readFileSync(NodePath.join(home, ".t3/userdata/state.sqlite"), "utf8")).toBe(
          "threads",
        );
        expect(NodeFS.readFileSync(NodePath.join(home, ".local/bin/catcode"), "utf8")).toBe(
          `#!/bin/sh\nexec '${home}/.catcode/runtime/versions/1.2.3/catcode' "$@"\n`,
        );
        expect(NodeFS.readFileSync(NodePath.join(home, ".local/bin/t3"), "utf8")).toBe(oldLauncher);
        expect(
          NodeChildProcess.execFileSync(NodePath.join(home, ".local/bin/catcode"), ["--version"], {
            encoding: "utf8",
          }),
        ).toBe("catcode v1.2.3\n");
        expect(result.output).toContain("catcode");
      } finally {
        NodeFS.rmSync(home, { recursive: true, force: true });
      }
    });

    it("moves the home once when installers start together", async () => {
      for (let round = 0; round < 4; round++) {
        const { home, run } = installInOldHome();
        try {
          const results = await Promise.all(
            ["a", "b", "c"].map((id) => run(NodePath.join(home, `bin-${id}`))),
          );
          for (const result of results) expect(result.code, result.output).toBe(0);
          expect(NodeFS.readlinkSync(NodePath.join(home, ".t3"))).toBe(".catcode");
          expect(NodeFS.readdirSync(NodePath.join(home, ".catcode")).sort()).toEqual([
            "runtime",
            "userdata",
          ]);
        } finally {
          NodeFS.rmSync(home, { recursive: true, force: true });
        }
      }
    });
  },
);
