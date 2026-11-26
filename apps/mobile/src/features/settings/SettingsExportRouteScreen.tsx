/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Notice } from "../../components/ui/Notice";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SecretTextInput } from "../../components/ui/SecretTextInput";
import { type SshNative, sshNative } from "../../connection/ssh/native";
import { parseSshConfig } from "../../connection/ssh/sshConfig";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { readDeviceSettings, settingsFileSource } from "./transfer/deviceSettings";
import {
  type SettingsContent,
  encodeAppSettings,
  passphraseProblem,
  settingsFailureMessage,
  settingsFileName,
} from "./transfer/settingsFile";

export function SettingsExportRouteScreen() {
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="Export settings">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {sshNative === null ? (
          <Text className="px-4 text-foreground-muted">
            Exporting settings needs the Android app.
          </Text>
        ) : (
          <ExportSettings native={sshNative} />
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line per kind of setting: what the file will hold of it. */
function contents(content: SettingsContent) {
  const hosts = parseSshConfig(content.sshConfig).hosts.length;
  const machines = content.machines.map((machine) => machine.registration.target.label);
  return [
    {
      label: "SSH key",
      description:
        content.sshKey === null
          ? "None on this device"
          : content.sshKey.keychainAlias
            ? `${content.sshKey.fingerprint}, kept in this phone's keychain as "${content.sshKey.keychainAlias}": only that name goes in the file`
            : content.sshKey.fingerprint,
    },
    {
      label: "SSH config and trusted host keys",
      description: `${plural(hosts, "host", "hosts")} in the config, ${plural(content.knownHosts.length, "trusted host key", "trusted host keys")}`,
    },
    {
      label: "Machines saved on this device",
      description:
        machines.length === 0 ? "None" : `${machines.join(", ")}, with the sign-in for each`,
    },
    {
      label: "Client certificate choices",
      description:
        content.clientCertificates.length === 0
          ? "None"
          : content.clientCertificates
              .map(
                (choice) =>
                  `"${choice.alias}" for ${choice.origin.replace(/^https:\/\//u, "").replace(/\/$/u, "")}`,
              )
              .join(", "),
    },
    {
      label: "T3 Connect service",
      description:
        content.connectService?.relayUrl.replace(/^https:\/\//u, "") ??
        "The one built into the app, so there is nothing to carry",
    },
    {
      label: "Preferences",
      description: plural(Object.keys(content.preferences).length, "setting", "settings"),
    },
  ];
}

type Result =
  | { readonly kind: "saved"; readonly name: string; readonly keyMissing: boolean }
  | { readonly kind: "failed"; readonly message: string };

/** Null when the person closed the system's "Save to" screen without saving. */
async function saveSettingsFile(native: SshNative, passphrase: string): Promise<Result | null> {
  try {
    // Read again: the list on screen may be minutes old, and the file must hold what is here now.
    const now = new Date();
    const current = await readDeviceSettings(native);
    const saved = await native.exportSettings(
      passphrase,
      encodeAppSettings(current, settingsFileSource(now)),
      settingsFileName(now),
    );
    if (saved.status === "cancelled") return null;
    return {
      kind: "saved",
      name: saved.name,
      keyMissing: current.sshKey !== null && !saved.sshKey,
    };
  } catch (error) {
    return { kind: "failed", message: settingsFailureMessage(error) };
  }
}

function ExportSettings({ native }: { readonly native: SshNative }) {
  const [content, setContent] = useState<SettingsContent | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [repeated, setRepeated] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const problem = passphraseProblem(passphrase, repeated);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads what the secure store and the native SSH module hold, to list it
  useEffect(() => {
    let live = true;
    readDeviceSettings(native).then(
      (next) => {
        if (live) setContent(next);
      },
      (error: unknown) => {
        if (live) setResult({ kind: "failed", message: settingsFailureMessage(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [native]);

  const save = async () => {
    setBusy(true);
    setResult(null);
    const outcome = await saveSettingsFile(native, passphrase);
    setResult(outcome);
    if (outcome?.kind === "saved") {
      setPassphrase("");
      setRepeated("");
    }
    setBusy(false);
  };

  return (
    <>
      <SettingsSection
        title="What goes in the file"
        footer="Not in the file: your T3 Connect sign-in, machines you reach through T3 Connect (they come back when you sign in), and the client certificate itself, which stays in Android's certificate store."
      >
        {content === null ? (
          <ListRowLayout label="Reading this device's settings…" />
        ) : (
          contents(content).map((row) => (
            <ListRowLayout key={row.label} label={row.label} description={row.description} />
          ))
        )}
      </SettingsSection>

      <SettingsSection
        title="Passphrase"
        footer="The file holds your SSH private key and the sign-ins for your machines, encrypted with this passphrase. You type it again to import. A forgotten passphrase cannot be recovered."
      >
        <View className="gap-3 p-4">
          <SecretTextInput
            accessibilityLabel="Passphrase"
            placeholder="Passphrase"
            value={passphrase}
            editable={!busy}
            returnKeyType="next"
            onChangeText={setPassphrase}
            onSubmitEditing={() => undefined}
          />
          <SecretTextInput
            accessibilityLabel="Passphrase again"
            placeholder="Passphrase again"
            value={repeated}
            editable={!busy}
            onChangeText={setRepeated}
            onSubmitEditing={() => undefined}
          />
          {problem !== null && passphrase !== "" ? (
            <Text className="text-sm text-foreground-muted">{problem}</Text>
          ) : null}
          <View className="flex-row">
            <Button
              label="Save to…"
              tone="primary"
              loading={busy}
              disabled={problem !== null || content === null}
              onPress={() => void save()}
            />
          </View>
        </View>
      </SettingsSection>

      {result?.kind === "saved" ? (
        <Notice
          message={`Saved as ${result.name}. Import it from Settings in the other app, then delete the file.${
            result.keyMissing
              ? " The SSH key on this device could not be read, so it is NOT in the file."
              : ""
          }`}
          tone={result.keyMissing ? "danger" : "default"}
        />
      ) : null}
      {result?.kind === "failed" ? <Notice message={result.message} tone="danger" /> : null}
    </>
  );
}
