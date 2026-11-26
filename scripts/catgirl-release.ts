#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - A release helper the workflow runs before any build.

// Catgirl Code's release helper: prints the version this source builds (plain, and as people see
// it), the T3 Code release it is based on, refuses a tag or a repository that does not match the source, and writes the
// fork's server installer.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { CATGIRL_HOME_SHELL_FUNCTION } from "@t3tools/shared/catgirlHomeScript";
import {
  CATGIRL_COMMAND,
  CATGIRL_COMMAND_ALIASES,
  CATGIRL_COMMAND_ALIASES_ENV,
  CATGIRL_HOME_DIR,
  CATGIRL_INSTALL_SCRIPT_URL,
  CATGIRL_LETTER_VERSION,
  CATGIRL_RELEASE_REPOSITORY,
  CATGIRL_RELEASES_PAGE_URL,
  CATGIRL_UPSTREAM_VERSION,
  CATGIRL_VERSION,
} from "@t3tools/shared/catgirlRelease";
import {
  CATGIRL_RELEASE_SIGNATURE_FILE,
  CATGIRL_RELEASE_SIGNING_KEY,
  CATGIRL_RELEASE_SIGNING_KEY_FINGERPRINT,
  catgirlReleaseSignatureShellFunction,
} from "@t3tools/shared/catgirlReleaseSignature";
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
// repository, its site, its logo, its npm package, which has no Catgirl Code builds, and its home,
// which the fork's installer moves before it writes anything there.
const INSTALL_SCRIPT_EDITS: ReadonlyArray<readonly [from: string, to: string]> = [
  ['repo="pingdotgg/t3code"', `repo="${CATGIRL_RELEASE_REPOSITORY}"`],
  ["T3 home directory (default: ~/.t3)", `home directory (default: ~/${CATGIRL_HOME_DIR})`],
  [
    't3_home="${T3CODE_HOME:-$HOME/.t3}"',
    `${CATGIRL_HOME_SHELL_FUNCTION}\nt3_home="\${T3CODE_HOME:-$(catgirl_home)}"`,
  ],
  ["https://t3.codes/install.sh", CATGIRL_INSTALL_SCRIPT_URL],
  ["https://t3.codes/download", CATGIRL_RELEASES_PAGE_URL],
  [LOGO_LINES, NAME_LINE],
  [
    "; releases before the self-contained CLI can only be installed with \\`npm install -g t3@${version}\\`",
    "",
  ],
];
// Every word `t3` names the command, which is the fork's own: not the home `.t3`, the variables
// that contain the word (`t3_home`), or T3 Code's site. `%s` or `\n` stands before it in printf.
const COMMAND_WORD = /(?<=^|[^\w$.]|%s|\\n)t3(?!\w|\.codes)/gm;

// The aliases are links to the launcher beside them. A file in their place that is another link
// or no link at all is someone else's, so it stays and the install goes on.
const LAUNCHER_STEP_END = `grep -qxF "$launcher" "$launchers" 2>/dev/null || printf '%s\\n' "$launcher" >> "$launchers"\n`;
const BIN_DIR_DOC =
  "#   T3CODE_INSTALL_BIN_DIR   where the `catcode` command goes (default: ~/.local/bin)\n";
const ALIASES_STEP = `if [ "\${${CATGIRL_COMMAND_ALIASES_ENV}:-1}" != 0 ]; then
  for cg_alias in ${CATGIRL_COMMAND_ALIASES.join(" ")}; do
    if [ -L "\${bin_dir}/\${cg_alias}" ] && [ "$(readlink "\${bin_dir}/\${cg_alias}")" = ${CATGIRL_COMMAND} ]; then continue; fi
    if [ -e "\${bin_dir}/\${cg_alias}" ] || [ -L "\${bin_dir}/\${cg_alias}" ]; then
      printf '  Left %s, which is not ours.\\n' "\${bin_dir}/\${cg_alias}" >&2
    else
      ln -s ${CATGIRL_COMMAND} "\${bin_dir}/\${cg_alias}" || printf '  Could not link %s.\\n' "\${bin_dir}/\${cg_alias}" >&2
    fi
  done
fi
`;

function withCommandAliases(script: string): string {
  for (const text of [LAUNCHER_STEP_END, BIN_DIR_DOC]) {
    if (script.split(text).length !== 2) {
      throw new RangeError(`scripts/install.sh no longer contains exactly one: ${text}`);
    }
  }
  const doc = `${BIN_DIR_DOC}#   ${CATGIRL_COMMAND_ALIASES_ENV}   0 makes no ${CATGIRL_COMMAND_ALIASES.join(" or ")} beside it (default: 1)\n`;
  return script
    .replace(LAUNCHER_STEP_END, () => LAUNCHER_STEP_END + ALIASES_STEP)
    .replace(BIN_DIR_DOC, () => doc);
}

// SHA256SUMS counts only when the release key signed it: a release changed after it was signed,
// or one with no signature, is refused. A machine without OpenSSH 8.1 cannot check, and says so.
const CHECKSUMS_FETCHED = `    fail "could not download the release checksums"\n  fi\n`;
const STAGING_CLEANUP = `  rm -f "\${staging}/\${archive}" "\${staging}/SHA256SUMS"\n`;
const signatureStep = (publicKey: string) => `${catgirlReleaseSignatureShellFunction(publicKey)
  .split("\n")
  .map((line) => (line === "" ? line : `  ${line}`))
  .join(
    "\n",
  )}  fetch "\${base_url}/v\${version}/${CATGIRL_RELEASE_SIGNATURE_FILE}" "\${staging}/${CATGIRL_RELEASE_SIGNATURE_FILE}" ||
    fail "release \${version} is not signed (it has no ${CATGIRL_RELEASE_SIGNATURE_FILE}), so it is not installed"
  signature_status=0
  catgirl_release_signature "\${staging}/SHA256SUMS" "\${staging}/${CATGIRL_RELEASE_SIGNATURE_FILE}" "\${staging}/allowed_signers" ||
    signature_status=$?
  case "$signature_status" in
    0) ;;
    2) printf '\\n  This machine cannot check the release signature (it needs OpenSSH 8.1 or newer); checking the checksum only.\\n' >&2 ;;
    *) fail "release \${version} is not signed by the Catgirl Code release key (${CATGIRL_RELEASE_SIGNING_KEY_FINGERPRINT}), so it is not installed" ;;
  esac
`;

function withSignatureCheck(script: string, publicKey: string): string {
  for (const text of [CHECKSUMS_FETCHED, STAGING_CLEANUP]) {
    if (script.split(text).length !== 2) {
      throw new RangeError(`scripts/install.sh no longer contains exactly one: ${text}`);
    }
  }
  return script
    .replace(CHECKSUMS_FETCHED, () => CHECKSUMS_FETCHED + signatureStep(publicKey))
    .replace(
      STAGING_CLEANUP,
      () =>
        `  rm -f "\${staging}/\${archive}" "\${staging}/SHA256SUMS" "\${staging}/${CATGIRL_RELEASE_SIGNATURE_FILE}" "\${staging}/allowed_signers"\n`,
    );
}

const INSTALL_SCRIPT_NOTE = `# Catgirl Code's installer: an unofficial fork of T3 Code, not affiliated with T3 Tools, Inc.
# Generated from T3 Code's scripts/install.sh (MIT) by scripts/catgirl-release.ts.
`;

/**
 * The fork's installer, made from T3 Code's. Throws when upstream reworded a line it replaces.
 * `publicKey` is the release key it trusts; tests pass their own.
 */
export function catgirlInstallScript(
  upstreamScript: string,
  publicKey: string = CATGIRL_RELEASE_SIGNING_KEY,
): string {
  let script = upstreamScript;
  for (const [from, to] of INSTALL_SCRIPT_EDITS) {
    if (script.split(from).length !== 2) {
      throw new RangeError(`scripts/install.sh no longer contains exactly one: ${from}`);
    }
    script = script.replace(from, () => to);
  }
  script = withCommandAliases(script.replace(COMMAND_WORD, CATGIRL_COMMAND));
  script = withSignatureCheck(script, publicKey);
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
    "letter-version": CATGIRL_LETTER_VERSION,
    "upstream-version": CATGIRL_UPSTREAM_VERSION,
    repository: CATGIRL_RELEASE_REPOSITORY,
    "signing-key": CATGIRL_RELEASE_SIGNING_KEY,
    "signing-key-fingerprint": CATGIRL_RELEASE_SIGNING_KEY_FINGERPRINT,
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
    "Usage: catgirl-release.ts version | letter-version | upstream-version | repository | signing-key | signing-key-fingerprint | check-tag <tag> | check-repository <owner/name> | install-script <file>\n",
  );
  return 2;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
