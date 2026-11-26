import { requireOptionalNativeModule } from "expo";
import { msg } from "gt-react-native";

import { m } from "../../i18n/messages";

export interface SshPublicKey {
  readonly line: string;
  readonly fingerprint: string;
}

export interface SshKnownHost {
  readonly line: string;
  readonly names: ReadonlyArray<string>;
  readonly keyType: string;
  readonly fingerprint: string;
}

export interface SshHop {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly hostKeyAlias: string | null;
}

export interface SshHostKeyRejection {
  readonly status: "host-key-rejected";
  readonly host: string;
  readonly port: number;
  readonly knownHostsName: string;
  readonly keyType: string;
  readonly fingerprint: string;
  readonly knownHostsLine: string;
  /** known_hosts already holds a different key under this name. */
  readonly changed: boolean;
}

export type SshConnectResult =
  | { readonly status: "connected"; readonly sessionId: string }
  | SshHostKeyRejection;

export interface SshExecResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type SettingsExportResult =
  | { readonly status: "cancelled" }
  /** `sshKey` is false when no SSH key went into the file. */
  | { readonly status: "saved"; readonly name: string; readonly sshKey: boolean };

export type SettingsPickResult =
  | { readonly status: "cancelled" }
  | { readonly status: "picked"; readonly id: string; readonly name: string };

/** A settings file after its passphrase opened it. `app` is the app's own JSON part. */
export interface OpenedSettingsFile {
  readonly key: SshPublicKey | null;
  readonly config: string | null;
  readonly knownHosts: ReadonlyArray<SshKnownHost>;
  readonly app: string | null;
}

/** `modules/t3-ssh`. The private key stays native; failures reject with an `ERR_SSH_*` code. */
export interface SshNative {
  getPublicKey(): Promise<SshPublicKey | null>;
  createKey(comment: string): Promise<SshPublicKey>;
  deleteKey(): Promise<void>;
  readConfig(): Promise<string>;
  writeConfig(text: string): Promise<void>;
  listKnownHosts(): Promise<ReadonlyArray<SshKnownHost>>;
  trustHostKey(line: string): Promise<void>;
  forgetHostKey(line: string): Promise<void>;
  connect(hops: ReadonlyArray<SshHop>): Promise<SshConnectResult>;
  exec(
    sessionId: string,
    command: string,
    stdin: string,
    timeoutMs: number,
  ): Promise<SshExecResult>;
  forward(sessionId: string, remotePort: number): Promise<number>;
  isOpen(sessionId: string): boolean;
  close(sessionId: string): Promise<void>;
  /** Encrypts the SSH state and `app` with `passphrase`, then asks the system where to save. */
  exportSettings(passphrase: string, app: string, fileName: string): Promise<SettingsExportResult>;
  /** Asks the system for a file. Rejects with an `ERR_SETTINGS_*` code when it is not ours. */
  pickSettingsFile(): Promise<SettingsPickResult>;
  openSettingsFile(id: string, passphrase: string): Promise<OpenedSettingsFile>;
  /** `add` keeps what this device has; only `replace` overwrites a key or a config. */
  importSshSettings(
    id: string,
    key: "skip" | "add" | "replace",
    config: "skip" | "add" | "replace",
    knownHosts: "skip" | "add",
  ): Promise<{
    readonly keyImported: boolean;
    readonly configImported: boolean;
    readonly knownHostsAdded: number;
    readonly knownHostsKept: number;
  }>;
  closeSettingsFile(id: string): Promise<void>;
}

/** Null where the platform has no SSH module (iOS). */
export const sshNative = requireOptionalNativeModule<SshNative>("T3Ssh");

export function sshErrorCode(cause: unknown): string | null {
  return typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
    ? cause.code
    : null;
}

/** What a person can act on, for the errors the native module names. */
export function sshFailureMessage(cause: unknown): string {
  switch (sshErrorCode(cause)) {
    case "ERR_SSH_AUTH":
      return m(
        msg(
          "The host did not accept this device's SSH key. Add the key from Settings > SSH to its {file}.",
          { file: "authorized_keys" },
        ),
      );
    case "ERR_SSH_NO_KEY":
      return m(msg("Create an SSH key in Settings > SSH first."));
    default:
      return cause instanceof Error ? cause.message : String(cause);
  }
}
