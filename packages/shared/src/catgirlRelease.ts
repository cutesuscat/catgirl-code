// Catgirl Code: the one place that says where this fork's builds come from and how they are
// numbered. Apps and servers fetch, offer and compare builds through here, never through T3 Code's
// releases or its npm package. Plain TypeScript with no imports: build scripts load it directly.

/** The GitHub repository whose releases hold this fork's builds. Rename it here and nowhere else. */
export const CATGIRL_RELEASE_REPOSITORY = "nickypro/catgirl-code";

/** The T3 Code release this source is based on. Move it when the fork moves to a newer one. */
export const CATGIRL_UPSTREAM_VERSION = "0.1.12";
/** Which Catgirl Code build of that release this is. Starts at 1; raise it for every release. */
export const CATGIRL_BUILD = 1;

export const CATGIRL_RELEASES_PAGE_URL = `https://github.com/${CATGIRL_RELEASE_REPOSITORY}/releases`;
/** Each release carries its own installer, so `latest` always installs the newest server. */
export const CATGIRL_INSTALL_SCRIPT_URL = `${CATGIRL_RELEASES_PAGE_URL}/latest/download/install.sh`;
export const CATGIRL_INSTALL_COMMAND = `curl -fsSL ${CATGIRL_INSTALL_SCRIPT_URL} | sh`;

const UPSTREAM_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const UPSTREAM_MINOR_LIMIT = 100;

/**
 * Build `build` of the fork on T3 Code `major.minor.patch` is `(major*100+minor).patch.build`:
 * 0.1.12 build 3 is 1.12.3. Plain numbers, so every comparison in this codebase orders it above
 * T3 Code's own build of the same release and above every earlier Catgirl Code build.
 */
export function catgirlVersion(upstreamVersion: string, build: number): string {
  const match = UPSTREAM_VERSION.exec(upstreamVersion);
  if (match === null) {
    throw new RangeError(`'${upstreamVersion}' is not a T3 Code release version.`);
  }
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const generation = major * UPSTREAM_MINOR_LIMIT + minor;
  if (minor >= UPSTREAM_MINOR_LIMIT || generation === 0) {
    throw new RangeError(`T3 Code ${upstreamVersion} has no Catgirl Code version.`);
  }
  if (!Number.isInteger(build) || build < 1) {
    throw new RangeError(`A Catgirl Code build number starts at 1, not ${build}.`);
  }
  return `${generation}.${patch}.${build}`;
}

/** The version of this source: what a release is tagged, and what its apps and server report. */
export const CATGIRL_VERSION = catgirlVersion(CATGIRL_UPSTREAM_VERSION, CATGIRL_BUILD);

/** A Catgirl Code version's parts, or `undefined` for anything else, such as a T3 Code version. */
export function parseCatgirlVersion(
  version: string,
): { readonly upstreamVersion: string; readonly build: number } | undefined {
  const match = UPSTREAM_VERSION.exec(version.trim());
  if (match === null) return undefined;
  const [generation, patch, build] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (generation === 0 || build === 0) return undefined;
  const major = Math.floor(generation / UPSTREAM_MINOR_LIMIT);
  return { upstreamVersion: `${major}.${generation % UPSTREAM_MINOR_LIMIT}.${patch}`, build };
}

/**
 * The T3 Code release a build's code is, for rules written against T3 Code's numbers, such as
 * which provider versions a release supports. A T3 Code version is returned as it is.
 */
export function upstreamVersionOf(version: string): string {
  return parseCatgirlVersion(version)?.upstreamVersion ?? version;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const LETTER_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)([a-z]{1,3})$/;
// Counted as spreadsheet columns are: 1 is a, 26 is z, 27 is aa.
const buildLetters = (build: number): string =>
  build === 0 ? "" : buildLetters(Math.floor((build - 1) / 26)) + LETTERS[(build - 1) % 26];

/**
 * A Catgirl Code version in both forms, given either: the plain number every comparison uses
 * (`1.12.1`) and the letter version people see (`0.1.12a`: the T3 Code release, then the build
 * as letters, so build 2 is `0.1.12b`). `undefined` for anything else, such as T3 Code's own.
 */
export function catgirlVersionForms(
  version: string,
): { readonly version: string; readonly letterVersion: string } | undefined {
  const text = version.trim().replace(/^v/, "");
  const lettered = LETTER_VERSION.exec(text);
  if (lettered === null) {
    const parts = parseCatgirlVersion(text);
    if (parts === undefined) return undefined;
    return { version: text, letterVersion: `${parts.upstreamVersion}${buildLetters(parts.build)}` };
  }
  const [, major = "", minor = "", patch = "", letters = ""] = lettered;
  const build = [...letters].reduce((total, letter) => total * 26 + LETTERS.indexOf(letter) + 1, 0);
  const plain = `${Number(major) * UPSTREAM_MINOR_LIMIT + Number(minor)}.${patch}.${build}`;
  const upstreamVersion = `${major}.${minor}.${patch}`;
  return parseCatgirlVersion(plain)?.upstreamVersion === upstreamVersion
    ? { version: plain, letterVersion: `${upstreamVersion}${letters}` }
    : undefined;
}

/** What a person is shown for `version`: a Catgirl Code build's letter version, anything else as it is. */
export function displayVersion(version: string): string;
export function displayVersion(version: string | null | undefined): string | null | undefined;
export function displayVersion(version: string | null | undefined): string | null | undefined {
  if (version === null || version === undefined) return version;
  return catgirlVersionForms(version)?.letterVersion ?? version;
}

/** This source's version as people see it, such as 0.1.12a: release titles, file names, About. */
export const CATGIRL_LETTER_VERSION = displayVersion(CATGIRL_VERSION);

// Written in two parts: the builds rename T3 Code's name wherever it appears whole, and this
// sentence has to keep saying whose fork this is.
const UPSTREAM_NAME = ["T3", "Code"].join(" ");
/** What tells a person this is not T3 Code. Its trademark policy asks a published fork to say so. */
export const CATGIRL_FORK_NOTICE = `Catgirl Code is an unofficial fork of ${UPSTREAM_NAME}, based on ${UPSTREAM_NAME} ${CATGIRL_UPSTREAM_VERSION}. It is not affiliated with, endorsed by or supported by T3 Tools, Inc.`;
