#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - A release helper the workflow runs before any build.

// Catgirl Code's release helper: prints the version this source builds and the T3 Code release
// it is based on, refuses a tag or a repository that does not match the source, and writes the
// fork's server installer.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import {
  CATGIRL_INSTALL_SCRIPT_URL,
  CATGIRL_RELEASE_REPOSITORY,
  CATGIRL_RELEASES_PAGE_URL,
  CATGIRL_UPSTREAM_VERSION,
  CATGIRL_VERSION,
} from "@t3tools/shared/catgirlRelease";
import { renameProduct } from "./lib/catgirl-branding.ts";

const LOGO_LINES = `  printf '  %s\\n' '██████████ ████████ ' >&2
  printf '  %s\\n' '    ███       ▄██▀       T3 Code' >&2
  printf '  %s%s     %sCLI installer%s\\n' '    ███       ████▄ ' "$reset" "$muted" "$reset$bold" >&2
  printf '  %s\\n' '    ███    ▄     ███' >&2
  printf '  %s\\n' '    ███    ███████▀ ' >&2
`;
const NAME_LINE = `  printf '  Catgirl Code %s%sserver installer%s\\n' "$reset" "$muted" "$reset$bold" >&2
`;

// Each is text of T3 Code's scripts/install.sh that must not reach a fork's installer: its
// repository, its site, its logo, and its npm package, which has no Catgirl Code builds.
const INSTALL_SCRIPT_EDITS: ReadonlyArray<readonly [from: string, to: string]> = [
  ['repo="pingdotgg/t3code"', `repo="${CATGIRL_RELEASE_REPOSITORY}"`],
  ["https://t3.codes/install.sh", CATGIRL_INSTALL_SCRIPT_URL],
  ["https://t3.codes/download", CATGIRL_RELEASES_PAGE_URL],
  [LOGO_LINES, NAME_LINE],
  [
    "; releases before the self-contained CLI can only be installed with \\`npm install -g t3@${version}\\`",
    "",
  ],
];
const INSTALL_SCRIPT_NOTE = `# Catgirl Code's installer: an unofficial fork of T3 Code, not affiliated with T3 Tools, Inc.
# Generated from T3 Code's scripts/install.sh (MIT) by scripts/catgirl-release.ts.
`;

/** The fork's installer, made from T3 Code's. Throws when upstream reworded a line it replaces. */
export function catgirlInstallScript(upstreamScript: string): string {
  let script = upstreamScript;
  for (const [from, to] of INSTALL_SCRIPT_EDITS) {
    if (script.split(from).length !== 2) {
      throw new RangeError(`scripts/install.sh no longer contains exactly one: ${from}`);
    }
    script = script.replace(from, () => to);
  }
  const [shebang = "", ...rest] = renameProduct(script).split("\n");
  return [shebang, INSTALL_SCRIPT_NOTE.trimEnd(), ...rest].join("\n");
}

/** Why `tag` cannot be released from this source, or `undefined` when it can. */
export function releaseTagProblem(tag: string): string | undefined {
  return tag === `v${CATGIRL_VERSION}`
    ? undefined
    : `This source builds Catgirl Code ${CATGIRL_VERSION}, so its release tag is v${CATGIRL_VERSION}, not ${tag}. Change CATGIRL_UPSTREAM_VERSION or CATGIRL_BUILD in packages/shared/src/catgirlRelease.ts, commit, and tag that commit.`;
}

/** Why releases published in `repository` would not reach the apps, or `undefined` when they do. */
export function releaseRepositoryProblem(repository: string): string | undefined {
  return repository === CATGIRL_RELEASE_REPOSITORY
    ? undefined
    : `Apps built from this source fetch their server from ${CATGIRL_RELEASE_REPOSITORY}, not from ${repository}. Change CATGIRL_RELEASE_REPOSITORY in packages/shared/src/catgirlRelease.ts, commit, and release that commit.`;
}

function main(args: ReadonlyArray<string>): number {
  const [command, argument] = args;
  const facts: Readonly<Record<string, string>> = {
    version: CATGIRL_VERSION,
    "upstream-version": CATGIRL_UPSTREAM_VERSION,
    repository: CATGIRL_RELEASE_REPOSITORY,
  };
  const fact = command === undefined ? undefined : facts[command];
  if (fact !== undefined) {
    process.stdout.write(`${fact}\n`);
    return 0;
  }
  if ((command === "check-tag" || command === "check-repository") && argument !== undefined) {
    const problem =
      command === "check-tag" ? releaseTagProblem(argument) : releaseRepositoryProblem(argument);
    if (problem !== undefined) process.stderr.write(`${problem}\n`);
    return problem === undefined ? 0 : 1;
  }
  if (command === "install-script" && argument !== undefined) {
    const source = NodeURL.fileURLToPath(new URL("./install.sh", import.meta.url));
    NodeFS.writeFileSync(argument, catgirlInstallScript(NodeFS.readFileSync(source, "utf8")), {
      mode: 0o755,
    });
    return 0;
  }
  process.stderr.write(
    "Usage: catgirl-release.ts version | upstream-version | repository | check-tag <tag> | check-repository <owner/name> | install-script <file>\n",
  );
  return 2;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
