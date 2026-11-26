import { describe, expect, it } from "vite-plus/test";

import {
  CATGIRL_INSTALL_COMMAND,
  CATGIRL_RELEASE_REPOSITORY,
  CATGIRL_RELEASES_PAGE_URL,
} from "./catgirlRelease.ts";
import {
  CLI_RELEASES_PAGE_URL,
  cliArchiveFileName,
  cliReleaseAssetUrl,
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
} from "./cliRelease.ts";

const VERSION = "1.12.1";

describe("where Catgirl Code builds come from", () => {
  const archive = cliArchiveFileName(VERSION, "linux-x64");
  const urls = [
    CLI_RELEASES_PAGE_URL,
    CATGIRL_RELEASES_PAGE_URL,
    CATGIRL_INSTALL_COMMAND,
    cliReleaseDownloadBaseUrl(VERSION),
    cliReleaseAssetUrl(VERSION, archive),
    cliReleaseAssetUrl(VERSION, "SHA256SUMS"),
    cliReleaseIndexPageUrl(1),
  ];

  it("fetches archives, checksums and the release list from the fork's repository", () => {
    const base = `https://github.com/${CATGIRL_RELEASE_REPOSITORY}/releases`;
    expect(CLI_RELEASES_PAGE_URL).toBe(base);
    expect(cliReleaseDownloadBaseUrl(VERSION)).toBe(`${base}/download/v${VERSION}`);
    expect(cliReleaseAssetUrl(VERSION, archive)).toBe(
      `${base}/download/v${VERSION}/t3-${VERSION}-linux-x64.tar.gz`,
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
