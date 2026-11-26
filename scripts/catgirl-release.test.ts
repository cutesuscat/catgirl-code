// @effect-diagnostics nodeBuiltinImport:off - Reads the real installer and checks it with sh.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { CATGIRL_RELEASE_REPOSITORY, CATGIRL_VERSION } from "@t3tools/shared/catgirlRelease";
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
