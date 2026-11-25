import { getClerkInstance } from "@clerk/expo";
import { runAtomCommand, settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { ConnectServiceSettings } from "@t3tools/contracts";
import { type ConnectServiceCheck, resolveConnectService } from "@t3tools/shared/connectService";
import {
  connectServiceCheckProblem,
  connectServiceSourceLabel,
} from "@t3tools/shared/connectServiceCopy";
import * as Updates from "expo-updates";
import { T, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { DevSettings, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { runtime } from "../../lib/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { unregisterAgentAwarenessDeviceForCurrentUser } from "../agent-awareness/remoteRegistration";
import { removeCloudEnvironments } from "../cloud/cloud-drafts";
import {
  builtInConnectService,
  checkConnectServiceDraft,
  savedConnectService,
  storeConnectService,
} from "../cloud/connectService";
import {
  resolveBuiltInCloudPublicConfig,
  resolveCloudPublicConfig,
  resolveRelayClerkTokenOptions,
} from "../cloud/publicConfig";
import { ConnectionFormField } from "../connection/ConnectionFormField";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";

type CheckProblem = Exclude<ConnectServiceCheck, { readonly _tag: "Ready" }>;

/**
 * Signs out of the service in use and forgets what belongs to it. The account service repeats
 * this after a sign-out, but the restart that follows would cut it short, so it runs here first.
 */
async function leaveConnectService(): Promise<void> {
  const { clerk, relay } = resolveCloudPublicConfig();
  if (!clerk.publishableKey || !relay.url) return;
  const instance = getClerkInstance({ publishableKey: clerk.publishableKey });
  await runAtomCommand(appAtomRegistry, removeCloudEnvironments, instance.user?.id ?? null, {
    reportFailure: false,
    reportDefect: false,
  });
  const session = instance.session;
  if (!session) return;
  await settlePromise(() =>
    runtime.runPromiseExit(
      unregisterAgentAwarenessDeviceForCurrentUser(() =>
        session.getToken(resolveRelayClerkTokenOptions()),
      ),
    ),
  );
  await instance.signOut();
}

async function restartApp(): Promise<void> {
  // Development builds have no update runtime to reload through.
  if (__DEV__) return DevSettings.reload();
  await Updates.reloadAsync();
}

export function SettingsConnectServiceRouteScreen() {
  const gt = useGT();
  const messages = useMessages();
  const insets = useSafeAreaInsets();
  const builtIn = builtInConnectService(resolveBuiltInCloudPublicConfig());
  const applied = resolveConnectService(savedConnectService(), builtIn);
  const saved = applied.source === "discovered" || applied.source === "manual";
  const typed = applied.source === "manual";
  const [relayUrl, setRelayUrl] = useState(applied.relayUrl ?? "");
  const [clerkPublishableKey, setClerkPublishableKey] = useState(
    typed ? (applied.clerkPublishableKey ?? "") : "",
  );
  const [clerkJwtTemplate, setClerkJwtTemplate] = useState(
    typed ? (applied.clerkJwtTemplate ?? "") : "",
  );
  const [advancedOpen, setAdvancedOpen] = useState(typed);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<CheckProblem | "check-failed" | "unchanged" | null>(null);
  const [applying, setApplying] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setProblem(null);
  };

  const apply = async (settings: ConnectServiceSettings | null) => {
    setApplying(true);
    // Leaving can fail when the old service is the broken thing being replaced.
    await settlePromise(leaveConnectService);
    storeConnectService(settings);
    const restarted = await settlePromise(restartApp);
    if (restarted._tag === "Success") return;
    setApplying(false);
    setRestartNeeded(true);
  };

  const confirm = (settings: ConnectServiceSettings | null) =>
    Dialog.confirm({
      title:
        settings === null
          ? gt("Go back to the built-in service?")
          : gt("Use {host} for T3 Connect?", { host: settings.relayUrl.replace("https://", "") }),
      message: gt(
        "The app will restart. You will be signed out of the current service, and machines reached through it leave your list until you link them to the new one.",
      ),
      confirmText: gt("Restart and switch"),
      onConfirm: () => void apply(settings),
    });

  const submit = async () => {
    setProblem(null);
    setChecking(true);
    const result = await settlePromise(() =>
      checkConnectServiceDraft({
        relayUrl,
        clerkPublishableKey,
        clerkJwtTemplate,
        clerkCliOAuthClientId: "",
      }),
    );
    setChecking(false);
    if (result._tag !== "Success") return setProblem("check-failed");
    const check = result.value;
    if (check._tag !== "Ready") {
      if (check._tag === "NotPublished" || check._tag === "UnreadableDocument") {
        setAdvancedOpen(true);
      }
      return setProblem(check);
    }
    const next = check.settings;
    if (
      next.source === applied.source &&
      next.relayUrl === applied.relayUrl &&
      next.clerkPublishableKey === applied.clerkPublishableKey &&
      next.clerkJwtTemplate === applied.clerkJwtTemplate
    ) {
      return setProblem("unchanged");
    }
    confirm(next);
  };

  const problemText =
    problem === null
      ? null
      : problem === "check-failed"
        ? gt("Could not check this address. Try again.")
        : problem === "unchanged"
          ? gt("This device already uses this service.")
          : connectServiceCheckProblem(problem, messages);
  const busy = checking || applying;

  return (
    <SettingsScreen title={gt("T3 Connect service")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection
          title={gt("Connect address")}
          footer={
            applied.relayUrl === null
              ? gt(
                  "T3 Connect is not set up on this device. Enter the address of a Connect service to turn it on.",
                )
              : gt("Using {host}. {source}.", {
                  host: applied.relayUrl.replace("https://", ""),
                  source: connectServiceSourceLabel(applied.source, messages),
                })
          }
        >
          <View className="gap-3 p-4">
            <ConnectionFormField
              label={gt("Connect address")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://relay.example.com"
              value={relayUrl}
              editable={!busy}
              onChangeText={edit(setRelayUrl)}
            />
            {advancedOpen ? (
              <>
                <ConnectionFormField
                  label={gt("Sign-in key")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="pk_live_…"
                  value={clerkPublishableKey}
                  editable={!busy}
                  onChangeText={edit(setClerkPublishableKey)}
                />
                <ConnectionFormField
                  label={gt("Token template")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="t3-relay"
                  value={clerkJwtTemplate}
                  editable={!busy}
                  onChangeText={edit(setClerkJwtTemplate)}
                />
                <Text className="text-sm text-foreground-muted">
                  <T>Leave both empty to use the values the service publishes.</T>
                </Text>
              </>
            ) : null}
            {problemText ? (
              <Text
                accessibilityRole={problem === "unchanged" ? "text" : "alert"}
                className={
                  problem === "unchanged"
                    ? "text-sm text-foreground-muted"
                    : "text-sm text-danger-foreground"
                }
              >
                {problemText}
              </Text>
            ) : null}
            {restartNeeded ? (
              <Text accessibilityRole="alert" className="text-sm text-foreground">
                <T>Saved. Close the app and open it again to finish switching.</T>
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-3">
              <Button
                label={gt("Save")}
                tone="primary"
                loading={busy}
                disabled={relayUrl.trim() === ""}
                onPress={() => void submit()}
              />
              {advancedOpen ? null : (
                <Button
                  label={gt("Advanced")}
                  tone="text"
                  disabled={busy}
                  onPress={() => setAdvancedOpen(true)}
                />
              )}
              {saved ? (
                <Button
                  label={builtIn.relayUrl ? gt("Reset to built-in") : gt("Remove")}
                  disabled={busy}
                  onPress={() => confirm(null)}
                />
              ) : null}
            </View>
          </View>
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
