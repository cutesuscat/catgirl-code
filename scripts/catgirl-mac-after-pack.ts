// @effect-diagnostics nodeBuiltinImport:off
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { sign } from "@electron/osx-sign";

const prepareServerCompileCache: (context: AfterPackContext) => Promise<void> =
  NodeModule.createRequire(import.meta.url)("./prepare-server-compile-cache.cjs");

interface AfterPackContext {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
  readonly packager: { readonly appInfo: { readonly productFilename: string } };
}

// Catgirl Code has no Apple certificate. Signing every release with one fixed certificate of its
// own is what lets an installed copy take the next release as an update: macOS installs an update
// only if it meets the running app's designated requirement, which names that certificate.
export default async function afterPack(context: AfterPackContext): Promise<void> {
  await prepareServerCompileCache(context);
  const identity = process.env.CATGIRL_MAC_SIGNING_IDENTITY?.trim();
  if (!identity || context.electronPlatformName !== "darwin") return;
  const keychain = process.env.CATGIRL_MAC_SIGNING_KEYCHAIN?.trim();
  await sign({
    app: NodePath.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
    identity,
    // Apple does not vouch for this certificate, so it is named by its SHA-1 and not looked up.
    identityValidation: false,
    ...(keychain ? { keychain } : {}),
    platform: "darwin",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    // As the builds before it: no hardened runtime, so no entitlements are needed for the
    // microphone, camera or native modules. Apple's timestamp service is for Apple's certificates.
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
  });
}
