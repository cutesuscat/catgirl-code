import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { resolveConnectService } from "@t3tools/shared/connectService";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import * as Application from "expo-application";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";

import { environmentCatalog } from "../../../connection/catalog";
import { CONNECTION_CATALOG_KEY } from "../../../connection/catalog-store";
import type { SshNative } from "../../../connection/ssh/native";
import {
  clientCertificateChoices,
  restoreClientCertificate,
} from "../../../lib/clientCertificates";
import { loadPreferences, updatePreferences } from "../../../persistence/imperative";
import { appAtomRegistry } from "../../../state/atom-registry";
import {
  builtInConnectService,
  savedConnectService,
  storeConnectService,
} from "../../cloud/connectService";
import { leaveConnectService } from "../../cloud/connectServiceSwitch";
import { resolveBuiltInCloudPublicConfig } from "../../cloud/publicConfig";
import {
  type ConnectServiceInUse,
  type ImportPorts,
  PairingKey,
  type SettingsContent,
  type SettingsFileSource,
  savedMachines,
  settingsPreferences,
} from "./settingsFile";

// Where features/cloud/dpop.ts keeps this install's pairing key. Sign-ins made with a pairing
// link are tied to it, so it travels with them and nothing else reads it here.
const PAIRING_KEY_STORAGE_KEY = "t3code.cloud.dpop-proof-key";

const decodeCatalog = Schema.decodeUnknownOption(Schema.fromJsonString(ConnectionCatalogDocument));
const PairingKeyJson = Schema.fromJsonString(PairingKey);
const decodePairingKey = Schema.decodeUnknownOption(PairingKeyJson);
const encodePairingKey = Schema.encodeSync(PairingKeyJson);

/** What this device holds of the things a settings file carries. Read fresh each time. */
export async function readDeviceSettings(native: SshNative): Promise<SettingsContent> {
  const [sshKey, sshConfig, knownHosts, catalog, pairingKey, preferences] = await Promise.all([
    native.getPublicKey(),
    native.readConfig(),
    native.listKnownHosts(),
    SecureStore.getItemAsync(CONNECTION_CATALOG_KEY),
    SecureStore.getItemAsync(PAIRING_KEY_STORAGE_KEY),
    loadPreferences(),
  ]);
  return {
    sshKey,
    sshConfig,
    knownHosts,
    machines: Option.match(decodeCatalog(catalog ?? ""), {
      onNone: () => [],
      onSome: savedMachines,
    }),
    pairingKey: Option.getOrNull(decodePairingKey(pairingKey ?? "")),
    clientCertificates: clientCertificateChoices(),
    connectService: savedConnectService(),
    preferences: settingsPreferences(preferences as Readonly<Record<string, unknown>>),
  };
}

export function connectServiceInUse(): ConnectServiceInUse {
  return resolveConnectService(
    savedConnectService(),
    builtInConnectService(resolveBuiltInCloudPublicConfig()),
  );
}

export function settingsFileSource(now: Date): SettingsFileSource {
  const version = Application.nativeApplicationVersion;
  return {
    createdAt: now.toISOString(),
    app:
      Application.applicationId === null
        ? null
        : `${Application.applicationId} ${version ?? ""}`.trim(),
    device: Device.modelName,
  };
}

/** The real writes of an import, for the settings file `id` the native module holds open. */
export function importPorts(native: SshNative, id: string): ImportPorts {
  // Read before anything is saved: a machine new to this device may arrive switched off, but
  // importing must not switch off one that is already in use here.
  const known = new Set(
    appAtomRegistry.get(environmentCatalog.savedCatalogValueAtom).entries.keys(),
  );
  const run = async <W, A, E>(command: Parameters<typeof runAtomCommand<W, A, E>>[1], input: W) => {
    const result = await runAtomCommand(appAtomRegistry, command, input, { reportFailure: false });
    if (!AsyncResult.isSuccess(result)) throw Cause.squash(result.cause);
    return result.value;
  };
  return {
    importSsh: (key, config, knownHosts) => native.importSshSettings(id, key, config, knownHosts),
    storePairingKey: (key) =>
      SecureStore.setItemAsync(PAIRING_KEY_STORAGE_KEY, encodePairingKey(key)),
    saveMachine: async (machine) => {
      const environmentId = machine.registration.target.environmentId;
      const saved = await run(environmentCatalog.register, machine.registration);
      if (!saved) throw new Error("This machine is managed by the app and was left as it is.");
      if (!machine.enabled && !known.has(environmentId)) {
        await run(environmentCatalog.setEnabled, { environmentId, enabled: false });
      }
    },
    restoreCertificate: (choice) => restoreClientCertificate(choice.origin, choice.alias),
    savePreferences: async (preferences) => {
      await updatePreferences(() => preferences);
    },
    switchConnectService: async (service) => {
      // Leaving can fail when the old service is the broken thing being replaced.
      await leaveConnectService().catch(() => undefined);
      storeConnectService(service);
    },
  };
}
