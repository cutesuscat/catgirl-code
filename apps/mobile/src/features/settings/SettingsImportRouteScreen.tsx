/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { Notice } from "../../components/ui/Notice";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SecretTextInput } from "../../components/ui/SecretTextInput";
import { type SshNative, sshNative } from "../../connection/ssh/native";
import { chooseClientCertificate } from "../../lib/clientCertificates";
import type { ClientCertificateChoice } from "../../lib/clientCertificates.types";
import { restartApp } from "../cloud/connectServiceSwitch";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { connectServiceInUse, importPorts, readDeviceSettings } from "./transfer/deviceSettings";
import {
  type ImportGroup,
  type ImportItem,
  type ImportOutcome,
  type OpenedSettingsFile,
  type SettingsContent,
  applyImport,
  defaultImportSelection,
  importInstructions,
  isWrongPassphrase,
  planImport,
  readSettingsFile,
  settingsFailureMessage,
} from "./transfer/settingsFile";

export function SettingsImportRouteScreen() {
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="Import settings">
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
            Importing settings needs the Android app.
          </Text>
        ) : (
          <ImportSettings native={sshNative} />
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

interface PickedFile {
  readonly id: string;
  readonly name: string;
}

/** An opened file beside what this device has, and the plan that compares the two. */
interface Preview {
  readonly file: OpenedSettingsFile;
  readonly device: SettingsContent;
  readonly items: ReadonlyArray<ImportItem>;
}

const GROUPS: ReadonlyArray<{
  readonly group: ImportGroup;
  readonly title: string;
  readonly footer?: string;
}> = [
  { group: "ssh", title: "SSH" },
  {
    group: "machines",
    title: "Machines",
    footer:
      "Machines you reach through T3 Connect are not in the file. They come back when you sign in.",
  },
  {
    group: "certificates",
    title: "Client certificates",
    footer:
      "The file holds only which certificate you chose. The certificate stays in Android's certificate store, and this app has to be allowed to use it: after importing you pick it once.",
  },
  { group: "connect", title: "T3 Connect service" },
  { group: "preferences", title: "Preferences" },
];

async function openPreview(native: SshNative, id: string, passphrase: string): Promise<Preview> {
  const file = readSettingsFile(await native.openSettingsFile(id, passphrase));
  const device = await readDeviceSettings(native);
  return { file, device, items: planImport(file.content, device, connectServiceInUse()) };
}

async function runImport(
  native: SshNative,
  id: string,
  preview: Preview,
  selected: ReadonlySet<string>,
): Promise<ImportOutcome> {
  const instructions = importInstructions(
    preview.file.content,
    preview.device,
    preview.items,
    selected,
  );
  const outcome = await applyImport(instructions, importPorts(native, id));
  await native.closeSettingsFile(id).catch(() => undefined);
  return outcome;
}

function madeBy(file: OpenedSettingsFile): string | null {
  const source = file.source;
  if (source === null) return null;
  const from = [source.app, source.device].filter(Boolean).join(" on ");
  return `Made ${source.createdAt.slice(0, 10)}${from === "" ? "" : ` by ${from}`}.`;
}

function ImportSettings({ native }: { readonly native: SshNative }) {
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pickedId = picked?.id ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops the decrypted file the native module holds once this screen stops using it
  useEffect(() => {
    if (pickedId === null) return undefined;
    return () => void native.closeSettingsFile(pickedId).catch(() => undefined);
  }, [native, pickedId]);

  const start = () => {
    setPicked(null);
    setPassphrase("");
    setPreview(null);
    setOutcome(null);
    setProblem(null);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    await action().catch((error: unknown) => setProblem(settingsFailureMessage(error)));
    setBusy(false);
  };

  const choose = () =>
    void run(async () => {
      const result = await native.pickSettingsFile();
      if (result.status === "picked") setPicked({ id: result.id, name: result.name });
    });

  const open = (file: PickedFile, typed: string) =>
    void run(async () => {
      const next = await openPreview(native, file.id, typed).catch((error: unknown) => {
        // A wrong passphrase keeps the file, so it can be typed again.
        if (!isWrongPassphrase(error)) setPicked(null);
        throw error;
      });
      setPassphrase("");
      setSelected(defaultImportSelection(next.items));
      setPreview(next);
    });

  const apply = (file: PickedFile, current: Preview) =>
    void run(async () => {
      setOutcome(await runImport(native, file.id, current, selected));
      setPreview(null);
      setPicked(null);
    });

  if (outcome !== null) return <ImportResult outcome={outcome} onDone={start} />;

  if (picked === null) {
    return (
      <>
        <SettingsSection footer="Choose a file made with Export settings, in this app or in another install of it. You will see what it holds before anything is changed, and nothing on this device is removed.">
          <ListActionRow
            icon="folder"
            label="Choose a settings file…"
            loading={busy}
            onPress={choose}
          />
        </SettingsSection>
        {problem === null ? null : <Notice message={problem} tone="danger" />}
      </>
    );
  }

  if (preview === null) {
    return (
      <SettingsSection
        title={picked.name === "" ? "Settings file" : picked.name}
        footer="The passphrase that was typed when this file was exported."
      >
        <View className="gap-3 p-4">
          <SecretTextInput
            accessibilityLabel="Passphrase"
            placeholder="Passphrase"
            value={passphrase}
            editable={!busy}
            onChangeText={setPassphrase}
            onSubmitEditing={(typed) => {
              if (typed !== "") open(picked, typed);
            }}
          />
          {problem === null ? null : (
            <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
              {problem}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-3">
            <Button
              label="Open"
              tone="primary"
              loading={busy}
              disabled={passphrase === ""}
              onPress={() => open(picked, passphrase)}
            />
            <Button label="Cancel" tone="text" disabled={busy} onPress={start} />
          </View>
        </View>
      </SettingsSection>
    );
  }

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const chosen = preview.items.filter((item) => item.action !== "same" && selected.has(item.id));
  const replaced = chosen.filter((item) => item.action === "replace");
  const confirm = () => {
    if (replaced.length === 0) return apply(picked, preview);
    return Dialog.confirm({
      title: "Replace what this device has?",
      message: replaced.map((item) => `${item.title}: ${item.warning ?? ""}`).join("\n\n"),
      confirmText: "Import and replace",
      destructive: true,
      onConfirm: () => apply(picked, preview),
    });
  };
  const source = madeBy(preview.file);

  return (
    <>
      <Text className="px-4 text-foreground-muted">
        {`${picked.name === "" ? "This file" : picked.name} holds the settings below.${source === null ? "" : ` ${source}`} Switch off what you do not want. Anything that would replace something on this device starts switched off.`}
      </Text>
      {preview.file.unreadable.map((part) => (
        <Notice
          key={part}
          tone="danger"
          message={`This version of the app could not read ${part}. It is left out.`}
        />
      ))}
      {preview.items.length === 0 ? (
        <Notice message="This file holds nothing this app can import." />
      ) : null}
      {GROUPS.map(({ group, title, footer }) => {
        const items = preview.items.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <SettingsSection key={group} title={title} footer={footer}>
            {items.map((item) =>
              item.action === "same" ? (
                <ListRowLayout
                  key={item.id}
                  label={item.title}
                  description={`${item.detail}\nAlready on this device.`}
                  disabled
                />
              ) : (
                <ListToggleRow
                  key={item.id}
                  label={item.title}
                  description={
                    item.warning === undefined ? item.detail : `${item.detail}\n${item.warning}`
                  }
                  disabled={busy}
                  value={selected.has(item.id)}
                  onValueChange={(on) => toggle(item.id, on)}
                />
              ),
            )}
          </SettingsSection>
        );
      })}
      {problem === null ? null : <Notice message={problem} tone="danger" />}
      <View className="flex-row flex-wrap gap-3 px-4">
        <Button
          label={chosen.length === 0 ? "Nothing to import" : "Import"}
          tone="primary"
          loading={busy}
          disabled={chosen.length === 0}
          onPress={confirm}
        />
        <Button label="Cancel" tone="text" disabled={busy} onPress={start} />
      </View>
    </>
  );
}

function ImportResult(props: { readonly outcome: ImportOutcome; readonly onDone: () => void }) {
  const { outcome } = props;
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);

  const allow = (choice: ClientCertificateChoice) =>
    void chooseClientCertificate(choice.origin, choice.alias).then(
      (alias) => {
        setProblem(null);
        if (alias !== null) setAllowed(new Set([...allowed, choice.origin]));
      },
      (error: unknown) => setProblem(settingsFailureMessage(error)),
    );

  const restart = () => {
    setRestarting(true);
    void restartApp().catch(() => {
      setRestarting(false);
      setRestartFailed(true);
    });
  };

  return (
    <>
      {outcome.done.length > 0 ? (
        <SettingsSection title="Imported">
          {outcome.done.map((line) => (
            <ListRowLayout key={line} icon="checkmark" label={line} />
          ))}
        </SettingsSection>
      ) : outcome.failed.length === 0 &&
        outcome.certificatesToAllow.length === 0 &&
        outcome.sshKeyToChoose === null ? (
        <Notice message="Nothing was changed." />
      ) : null}
      {outcome.failed.map((line) => (
        <Notice key={line} tone="danger" message={`Not imported. ${line}`} />
      ))}
      {outcome.certificatesToAllow.length === 0 ? null : (
        <SettingsSection
          title="Allow this app to use your certificate"
          footer="The certificate is already on this phone, in Android's certificate store, but Android gives it to an app only when you pick it for that app. Tap each one and pick the certificate named on it."
        >
          {outcome.certificatesToAllow.map((choice) => (
            <ListActionRow
              key={choice.origin}
              icon={allowed.has(choice.origin) ? "checkmark" : { ios: "lock", android: "lock" }}
              label={`Pick "${choice.alias}"`}
              description={`For ${choice.origin.replace(/^https:\/\//u, "").replace(/\/$/u, "")}${
                allowed.has(choice.origin) ? ". Allowed." : ""
              }`}
              onPress={() => allow(choice)}
            />
          ))}
        </SettingsSection>
      )}
      {outcome.sshKeyToChoose === null ? null : (
        <Notice
          message={`The SSH key in the file is "${outcome.sshKeyToChoose}" in this phone's keychain. Open Settings > SSH and choose it there, so Android lets this app use it.`}
        />
      )}
      {problem === null ? null : <Notice message={problem} tone="danger" />}
      {outcome.restart ? (
        <Notice
          message={
            restartFailed
              ? "Close the app and open it again to finish."
              : "Restart the app to finish: the pairing key, preferences and the Connect service are read when the app starts."
          }
        />
      ) : null}
      <View className="flex-row flex-wrap gap-3 px-4">
        {outcome.restart && !restartFailed ? (
          <Button label="Restart now" tone="primary" loading={restarting} onPress={restart} />
        ) : null}
        <Button label="Import another file" tone="text" onPress={props.onDone} />
      </View>
    </>
  );
}
