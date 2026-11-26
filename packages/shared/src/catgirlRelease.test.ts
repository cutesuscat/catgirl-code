import { describe, expect, it } from "vite-plus/test";

import {
  CATGIRL_BUILD,
  CATGIRL_INSTALL_COMMAND,
  CATGIRL_LETTER_VERSION,
  CATGIRL_RELEASE_REPOSITORY,
  CATGIRL_RELEASES_PAGE_URL,
  CATGIRL_UPSTREAM_VERSION,
  CATGIRL_VERSION,
  catgirlVersion,
  catgirlVersionForms,
  displayVersion,
  parseCatgirlVersion,
  upstreamVersionOf,
} from "./catgirlRelease.ts";
import {
  acceptsTrackSwitchRelease,
  CLI_RELEASES_PAGE_URL,
  cliArchiveFileName,
  cliReleaseAssetUrl,
  cliReleaseChannelOf,
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
  crossesReleaseTrack,
  desktopUpdateChannelOf,
  newestCliReleaseVersion,
} from "./cliRelease.ts";
import { releaseChannelOf } from "./releaseResource.ts";
import { compareSemverVersions, parseSemver, satisfiesSemverRange } from "./semver.ts";

const newer = (left: string, right: string) => compareSemverVersions(left, right) > 0;

describe("where Catgirl Code builds come from", () => {
  const archive = cliArchiveFileName(CATGIRL_VERSION, "linux-x64");
  const urls = [
    CLI_RELEASES_PAGE_URL,
    CATGIRL_RELEASES_PAGE_URL,
    CATGIRL_INSTALL_COMMAND,
    cliReleaseDownloadBaseUrl(CATGIRL_VERSION),
    cliReleaseAssetUrl(CATGIRL_VERSION, archive),
    cliReleaseAssetUrl(CATGIRL_VERSION, "SHA256SUMS"),
    cliReleaseIndexPageUrl(1),
  ];

  it("fetches archives, checksums and the release list from the fork's repository", () => {
    const base = `https://github.com/${CATGIRL_RELEASE_REPOSITORY}/releases`;
    expect(CLI_RELEASES_PAGE_URL).toBe(base);
    expect(cliReleaseDownloadBaseUrl(CATGIRL_VERSION)).toBe(`${base}/download/v${CATGIRL_VERSION}`);
    expect(cliReleaseAssetUrl(CATGIRL_VERSION, archive)).toBe(
      `${base}/download/v${CATGIRL_VERSION}/catcode-${CATGIRL_VERSION}-linux-x64.tar.gz`,
    );
    expect(cliReleaseIndexPageUrl(2)).toBe(
      `https://api.github.com/repos/${CATGIRL_RELEASE_REPOSITORY}/releases?per_page=100&page=2`,
    );
  });

  it("names T3 Code's repository in none of them", () => {
    for (const url of urls) expect(url).not.toContain("pingdotgg");
  });

  it("still follows a mirror given by T3CODE_RELEASE_BASE_URL or a managed policy", () => {
    const mirror = "https://mirror.example.com/builds/";
    expect(cliReleaseDownloadBaseUrl("1.12.1", mirror)).toBe(
      "https://mirror.example.com/builds/v1.12.1",
    );
    expect(cliReleaseAssetUrl("1.12.1", "SHA256SUMS", `${mirror}?token=secret`)).toBe(
      "https://mirror.example.com/builds/v1.12.1/SHA256SUMS?token=secret",
    );
  });
});

describe("how Catgirl Code builds are numbered", () => {
  it("writes the T3 Code release and the build number into plain numbers", () => {
    expect(catgirlVersion("0.1.12", 1)).toBe("1.12.1");
    expect(catgirlVersion("0.1.12", 3)).toBe("1.12.3");
    expect(catgirlVersion("0.1.13", 1)).toBe("1.13.1");
    expect(catgirlVersion("0.2.0", 1)).toBe("2.0.1");
    expect(catgirlVersion("1.0.0", 4)).toBe("100.0.4");
    expect(CATGIRL_VERSION).toBe(catgirlVersion(CATGIRL_UPSTREAM_VERSION, CATGIRL_BUILD));
    expect(parseSemver(CATGIRL_VERSION)?.prerelease).toEqual([]);
  });

  it("reads both parts back", () => {
    expect(parseCatgirlVersion("1.12.3")).toEqual({ upstreamVersion: "0.1.12", build: 3 });
    expect(parseCatgirlVersion("100.0.4")).toEqual({ upstreamVersion: "1.0.0", build: 4 });
    expect(upstreamVersionOf(CATGIRL_VERSION)).toBe(CATGIRL_UPSTREAM_VERSION);
    for (const upstream of ["0.1.12", "0.1.10", "0.0.44", "0.1.13-nightly.20261126.1", "dev"]) {
      expect(parseCatgirlVersion(upstream)).toBeUndefined();
      expect(upstreamVersionOf(upstream)).toBe(upstream);
    }
  });

  it("refuses what it cannot number", () => {
    expect(() => catgirlVersion("0.1.12", 0)).toThrow("starts at 1");
    expect(() => catgirlVersion("0.1.12", 1.5)).toThrow("starts at 1");
    expect(() => catgirlVersion("0.1.12-nightly.20261126.1", 1)).toThrow("not a T3 Code release");
    expect(() => catgirlVersion("0.0.44", 1)).toThrow("no Catgirl Code version");
    expect(() => catgirlVersion("0.100.0", 1)).toThrow("no Catgirl Code version");
  });

  it("orders a newer build above an older one on the same T3 Code release", () => {
    expect(newer(catgirlVersion("0.1.12", 2), catgirlVersion("0.1.12", 1))).toBe(true);
    expect(newer(catgirlVersion("0.1.12", 10), catgirlVersion("0.1.12", 9))).toBe(true);
    expect(compareSemverVersions(CATGIRL_VERSION, CATGIRL_VERSION)).toBe(0);
  });

  it("never reads T3 Code's own build as up to date, whichever release it is", () => {
    for (const official of ["0.1.10", "0.1.12", "0.1.13", "0.9.0", "0.1.13-nightly.20261126.1"]) {
      expect(newer(catgirlVersion("0.1.12", 1), official)).toBe(true);
    }
  });

  it("keeps the order when the fork moves to the next T3 Code release", () => {
    expect(newer(catgirlVersion("0.1.13", 1), catgirlVersion("0.1.12", 99))).toBe(true);
    expect(newer(catgirlVersion("0.2.0", 1), catgirlVersion("0.1.99", 99))).toBe(true);
    expect(newer(catgirlVersion("1.0.0", 1), catgirlVersion("0.99.99", 99))).toBe(true);
  });

  it("is a stable release to every channel rule, so no track is crossed", () => {
    expect(cliReleaseChannelOf(CATGIRL_VERSION)).toBe("stable");
    expect(releaseChannelOf(CATGIRL_VERSION)).toBe("stable");
    expect(desktopUpdateChannelOf(CATGIRL_VERSION)).toBe("latest");
    expect(crossesReleaseTrack("0.1.12", CATGIRL_VERSION)).toBe(false);
    expect(crossesReleaseTrack(catgirlVersion("0.1.12", 1), catgirlVersion("0.1.13", 1))).toBe(
      false,
    );
    expect(acceptsTrackSwitchRelease(catgirlVersion("0.1.12", 2), "latest", "1.12.1")).toBe(true);
  });

  it("is found as the newest release by its tag", () => {
    const releases = [
      { tag_name: "v1.12.3", draft: true },
      { tag_name: "android-2.0.0-selfhost.11" },
      { tag_name: "v1.12.2" },
      { tag_name: "v1.12.1" },
    ];
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.12.2");
    expect(newestCliReleaseVersion(releases, "nightly")).toBeUndefined();
  });

  it("answers rules written against T3 Code's numbers with the release it is based on", () => {
    const basedOn = upstreamVersionOf(catgirlVersion("0.1.12", 3));
    expect(satisfiesSemverRange(basedOn, ">=0.1.10")).toBe(true);
    expect(satisfiesSemverRange(basedOn, ">=0.0.42 <0.1.10")).toBe(false);
    expect(satisfiesSemverRange(basedOn, ">=0.1.13")).toBe(false);
    // The raw number would claim every future T3 Code release.
    expect(satisfiesSemverRange(catgirlVersion("0.1.12", 3), ">=0.1.13")).toBe(true);
  });
});

describe("the letter version people see", () => {
  const forms = (version: string, letterVersion: string) => ({ version, letterVersion });

  it("is the T3 Code release with the build as letters", () => {
    expect(displayVersion(catgirlVersion("0.1.12", 1))).toBe("0.1.12a");
    expect(displayVersion(catgirlVersion("0.1.12", 2))).toBe("0.1.12b");
    expect(displayVersion(catgirlVersion("0.1.12", 26))).toBe("0.1.12z");
    expect(displayVersion(catgirlVersion("0.1.12", 27))).toBe("0.1.12aa");
    expect(displayVersion(catgirlVersion("0.1.13", 1))).toBe("0.1.13a");
    expect(displayVersion(catgirlVersion("1.0.0", 3))).toBe("1.0.0c");
    expect(CATGIRL_LETTER_VERSION).toBe(displayVersion(CATGIRL_VERSION));
    expect(CATGIRL_LETTER_VERSION.startsWith(CATGIRL_UPSTREAM_VERSION)).toBe(true);
  });

  it("maps both ways, and each form back to the same pair", () => {
    expect(catgirlVersionForms("1.12.1")).toEqual(forms("1.12.1", "0.1.12a"));
    expect(catgirlVersionForms("0.1.12a")).toEqual(forms("1.12.1", "0.1.12a"));
    expect(catgirlVersionForms("v0.1.12b")).toEqual(forms("1.12.2", "0.1.12b"));
    expect(catgirlVersionForms(" v1.12.28 ")).toEqual(forms("1.12.28", "0.1.12ab"));
    for (let build = 1; build <= 800; build += 1) {
      const version = catgirlVersion("0.1.12", build);
      const letterVersion = catgirlVersionForms(version)?.letterVersion ?? "";
      expect(catgirlVersionForms(letterVersion)).toEqual(forms(version, letterVersion));
    }
  });

  it("leaves every other version as it is", () => {
    for (const other of ["0.1.12", "0.1.10", "0.1.13-nightly.20261126.1", "0.0.0", "dev", ""]) {
      expect(catgirlVersionForms(other)).toBeUndefined();
      expect(displayVersion(other)).toBe(other);
    }
    for (const notOurs of ["0.0.44a", "0.100.0a", "0.1.12A", "0.1.12-a", "0.1.12abcd"]) {
      expect(catgirlVersionForms(notOurs)).toBeUndefined();
    }
    expect(displayVersion(null)).toBeNull();
    expect(displayVersion(undefined)).toBeUndefined();
  });

  it("runs past z as spreadsheet columns do", () => {
    const builds = [1, 2, 25, 26, 27, 52, 53, 702, 703];
    expect(builds.map((build) => displayVersion(catgirlVersion("0.1.12", build)))).toEqual(
      ["a", "b", "y", "z", "aa", "az", "ba", "zz", "aaa"].map((letters) => `0.1.12${letters}`),
    );
  });
});
