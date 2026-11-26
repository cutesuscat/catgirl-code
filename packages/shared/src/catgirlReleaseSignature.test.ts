// @effect-diagnostics nodeBuiltinImport:off - runs the shell check with ssh-keygen on real files.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { sha256 } from "@noble/hashes/sha2";
import { describe, expect, it } from "vite-plus/test";

import {
  CATGIRL_RELEASE_SIGNING_KEY,
  CATGIRL_RELEASE_SIGNING_KEY_FINGERPRINT,
  catgirlReleaseAllowedSigners,
  catgirlReleaseSignatureShellFunction,
  verifyCatgirlReleaseSignature,
} from "./catgirlReleaseSignature.ts";

// Made with `ssh-keygen -Y sign` and throwaway keys whose private halves were deleted.
const TEST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAADmK10U8P43RxFFr3RwvA4YlK1oXGniphqsXCr46PB";
const MESSAGE = new TextEncoder().encode("abc123  catcode-1.12.4-linux-x64.tar.gz\n");
const SIGNATURES = {
  good: `-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgAAOYrXRTw/jdHEUWvdHC8DhiUr
WhcaeKmGqxcKvjo8EAAAAUY2F0Z2lybC1jb2RlLXJlbGVhc2UAAAAAAAAABnNoYTUxMgAA
AFMAAAALc3NoLWVkMjU1MTkAAABASujjauSIaM28dYIV+DBY8pIZxRasBHyAixsddStcEg
35qYS/oV2PTmz621XRzP8Z+9s3t497N617qwO6IxifDQ==
-----END SSH SIGNATURE-----
`,
  sha256: `-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgAAOYrXRTw/jdHEUWvdHC8DhiUr
WhcaeKmGqxcKvjo8EAAAAUY2F0Z2lybC1jb2RlLXJlbGVhc2UAAAAAAAAABnNoYTI1NgAA
AFMAAAALc3NoLWVkMjU1MTkAAABAXm+hi3Q5Vv2ATmZoVNNuh/wCkGB4jKq87SaSxobX3J
hVUdv2SiOAHD/0ewZszCJHw4mP25RGFCn6ZOdgyA6iCA==
-----END SSH SIGNATURE-----
`,
  otherNamespace: `-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgAAOYrXRTw/jdHEUWvdHC8DhiUr
WhcaeKmGqxcKvjo8EAAAAEZmlsZQAAAAAAAAAGc2hhNTEyAAAAUwAAAAtzc2gtZWQyNTUx
OQAAAEDBNoFwmEvmZLelBqRMk5zySQS6CZdYtrX9ZyT9ZfCPKSql8iD4085YwbZPMtBjQk
kI7yu5OHVQludty7HLJygP
-----END SSH SIGNATURE-----
`,
  otherKey: `-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgN987ztHAc3mQpUjUmnCfXCbdGH
90VDEWTYAqKlF1OswAAAAUY2F0Z2lybC1jb2RlLXJlbGVhc2UAAAAAAAAABnNoYTUxMgAA
AFMAAAALc3NoLWVkMjU1MTkAAABAfcgbvvEIponnOCA8SZfBBE2TyUx58tUUwh62UmPA1q
quA8YNHzZ3Q+g3kT5NASU+H5+mtbbMlOSkCKgjFTJWBw==
-----END SSH SIGNATURE-----
`,
};

describe("verifyCatgirlReleaseSignature", () => {
  it("accepts the key's signature of the message, with either hash", () => {
    expect(verifyCatgirlReleaseSignature(MESSAGE, SIGNATURES.good, TEST_KEY)).toBe(true);
    expect(verifyCatgirlReleaseSignature(MESSAGE, SIGNATURES.sha256, TEST_KEY)).toBe(true);
  });

  it("refuses a changed message, another key, another namespace and the release key", () => {
    const changed = new TextEncoder().encode("abc124  catcode-1.12.4-linux-x64.tar.gz\n");
    expect(verifyCatgirlReleaseSignature(changed, SIGNATURES.good, TEST_KEY)).toBe(false);
    expect(verifyCatgirlReleaseSignature(MESSAGE, SIGNATURES.otherKey, TEST_KEY)).toBe(false);
    expect(verifyCatgirlReleaseSignature(MESSAGE, SIGNATURES.otherNamespace, TEST_KEY)).toBe(false);
    expect(verifyCatgirlReleaseSignature(MESSAGE, SIGNATURES.good)).toBe(false);
  });

  it("treats anything malformed as a failed check", () => {
    const body = SIGNATURES.good.split("\n").slice(1, -2).join("");
    const cut = `-----BEGIN SSH SIGNATURE-----\n${body.slice(0, 60)}\n-----END SSH SIGNATURE-----\n`;
    for (const signature of ["", "not a signature", cut, SIGNATURES.good.replace("U1NI", "U1NJ")]) {
      expect(verifyCatgirlReleaseSignature(MESSAGE, signature, TEST_KEY)).toBe(false);
    }
    expect(verifyCatgirlReleaseSignature(MESSAGE, SIGNATURES.good, "ssh-rsa AAAA")).toBe(false);
  });
});

describe("the release key", () => {
  it("is the key whose fingerprint people are given", () => {
    const blob = Uint8Array.from(atob(CATGIRL_RELEASE_SIGNING_KEY.split(" ")[1] ?? ""), (c) =>
      c.charCodeAt(0),
    );
    const fingerprint = btoa(String.fromCharCode(...sha256(blob))).replace(/=+$/, "");
    expect(`SHA256:${fingerprint}`).toBe(CATGIRL_RELEASE_SIGNING_KEY_FINGERPRINT);
    expect(catgirlReleaseAllowedSigners()).toBe(
      `catgirl-code-releases ${CATGIRL_RELEASE_SIGNING_KEY}\n`,
    );
  });
});

const hasSshKeygenY = (() => {
  const result = NodeChildProcess.spawnSync("ssh-keygen", ["-Y", "verify"], { encoding: "utf8" });
  return result.error === undefined && !`${result.stderr}`.includes("option -- ");
})();

describe.runIf(hasSshKeygenY)("the shell check", () => {
  const run = (signature: string, message: Uint8Array = MESSAGE): number => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "catgirl-signature-"));
    NodeFS.writeFileSync(NodePath.join(dir, "SHA256SUMS"), message);
    NodeFS.writeFileSync(NodePath.join(dir, "SHA256SUMS.sig"), signature);
    const script = `${catgirlReleaseSignatureShellFunction(TEST_KEY)}
catgirl_release_signature "$1/SHA256SUMS" "$1/SHA256SUMS.sig" "$1/allowed_signers"`;
    return NodeChildProcess.spawnSync("sh", ["-c", script, "sh", dir]).status ?? -1;
  };

  it("agrees with the TypeScript check", () => {
    expect(run(SIGNATURES.good)).toBe(0);
    expect(run(SIGNATURES.sha256)).toBe(0);
    expect(run(SIGNATURES.otherKey)).toBe(1);
    expect(run(SIGNATURES.otherNamespace)).toBe(1);
    expect(run(SIGNATURES.good, new TextEncoder().encode("changed\n"))).toBe(1);
    expect(run("")).toBe(1);
  });

  it("says it cannot check when ssh-keygen is missing", () => {
    const script = `PATH=/nonexistent
${catgirlReleaseSignatureShellFunction(TEST_KEY)}
catgirl_release_signature /dev/null /dev/null /dev/null`;
    expect(NodeChildProcess.spawnSync("/bin/sh", ["-c", script]).status).toBe(2);
  });

  it("is valid sh", () => {
    expect(() =>
      NodeChildProcess.execFileSync("sh", ["-n", "-c", catgirlReleaseSignatureShellFunction()]),
    ).not.toThrow();
  });
});
