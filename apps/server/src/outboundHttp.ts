// @effect-diagnostics-next-line nodeBuiltinImport:off - runs before the Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - runs before the Effect runtime exists.
import * as NodePath from "node:path";

import type * as Undici from "undici";

// undici is external to the CLI bundle; Node single-executables can load it from disk only with require.
const requireUndici = NodeModule.createRequire(import.meta.url);

/** Node 26 bundles h2-capable undici 8; Node 22/24 and Electron stay on HTTP/1.1 with 6/7. */
export const builtinFetchUsesHttp2 = (bundledUndiciVersion: string | undefined) =>
  Number.parseInt(bundledUndiciVersion ?? "", 10) >= 8;

/** Preserves the EnvHttpProxyAgent installed by --use-env-proxy / NODE_USE_ENV_PROXY. */
export function installHttp1FetchDispatcher(): void {
  const undici = requireUndici("undici") as typeof Undici;
  // Node's agent comes from its internal undici copy, so `instanceof` against the npm class is false.
  const usesEnvProxy = undici.getGlobalDispatcher().constructor.name === "EnvHttpProxyAgent";
  undici.setGlobalDispatcher(
    usesEnvProxy
      ? new undici.EnvHttpProxyAgent({
          allowH2: false,
          // ProxyAgent's connector forces h2 and ignores allowH2; replace it for HTTPS proxies.
          clientFactory: (origin) => new undici.Pool(origin, { allowH2: false }),
        })
      : new undici.Agent({ allowH2: false }),
  );
}

/** Avoids uncaught idle-timeout errors on h2 streams (https://github.com/nodejs/undici/issues/5936). */
export function keepOutboundFetchOnHttp1(): void {
  if (builtinFetchUsesHttp2(process.versions.undici)) installHttp1FetchDispatcher();
}

export interface TlsClientCertificate {
  readonly cert: Buffer;
  readonly key: Buffer;
}

/** PEM files from T3CODE_TLS_CLIENT_CERT/KEY, else <T3 home>/client-cert/client.{crt,key}. */
export function readTlsClientCertificate(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = NodeOS.homedir(),
): TlsClientCertificate | undefined {
  const t3Home = env.T3CODE_HOME?.trim() || NodePath.join(homeDir, ".t3");
  const certPath =
    env.T3CODE_TLS_CLIENT_CERT?.trim() || NodePath.join(t3Home, "client-cert", "client.crt");
  const keyPath =
    env.T3CODE_TLS_CLIENT_KEY?.trim() || NodePath.join(t3Home, "client-cert", "client.key");
  try {
    return { cert: NodeFS.readFileSync(certPath), key: NodeFS.readFileSync(keyPath) };
  } catch {
    return undefined;
  }
}

/**
 * Machines behind a client-certificate gate (self-hosted T3 Connect) refuse peer links without
 * one. TLS sends it only to servers that request it. Built-in fetch on Node 24 (Electron) and 26
 * both use this npm Agent through undici's global dispatcher symbol.
 */
export function presentTlsClientCertificate(
  ...args: [] | [certificate: TlsClientCertificate | undefined]
): boolean {
  // An explicit `undefined` means "no certificate"; only a bare call reads the files.
  const certificate = args.length === 0 ? readTlsClientCertificate() : args[0];
  if (!certificate) return false;
  const undici = requireUndici("undici") as typeof Undici;
  if (undici.getGlobalDispatcher()?.constructor.name === "EnvHttpProxyAgent") return false;
  undici.setGlobalDispatcher(
    new undici.Agent({
      allowH2: false,
      connect: { cert: certificate.cert, key: certificate.key },
    }),
  );
  return true;
}

// @types/node does not declare setTypeOfService yet.
type TypeOfServiceSocket = {
  setTypeOfService?: (this: NodeNet.Socket, typeOfService: number) => NodeNet.Socket;
};

// Bundled undici calls this from a socket callback without catching. On macOS,
// EINVAL after a peer reset must not exit the server over an optional QoS hint.
export function ignoreMacosTypeOfServiceEinval(
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Runs before ACP dispatch without loading the Effect graph.
  platform = process.platform,
  socketPrototype: TypeOfServiceSocket = NodeNet.Socket.prototype as TypeOfServiceSocket,
): void {
  if (platform !== "darwin") return;
  const setTypeOfService = socketPrototype.setTypeOfService;
  if (typeof setTypeOfService !== "function") return;
  socketPrototype.setTypeOfService = function (...args) {
    try {
      return setTypeOfService.apply(this, args);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EINVAL") return this;
      throw error;
    }
  };
}

/**
 * Node's 250 ms Happy Eyeballs attempt timeout abandons a working-but-slow IPv4
 * connect when IPv6 is advertised but unroutable, which broke the ACP registry
 * fetch. A larger `--network-family-autoselection-attempt-timeout` still wins.
 */
export function extendConnectionAttemptTimeout(): void {
  NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(
    Math.max(NodeNet.getDefaultAutoSelectFamilyAttemptTimeout(), 1_000),
  );
}
