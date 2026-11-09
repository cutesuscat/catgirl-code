import { useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { relayCertificateOrigin } from "../../lib/certificateScope";
import {
  chooseClientCertificate,
  clientCertificatesAvailable,
  onClientCertificateChange,
  removeClientCertificate,
  selectedClientCertificate,
} from "../../lib/clientCertificates";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";

function subscribe(listener: () => void) {
  const subscription = onClientCertificateChange(listener);
  return () => subscription.remove();
}

export function SettingsClientCertificateRouteScreen() {
  const insets = useSafeAreaInsets();
  const origin = relayCertificateOrigin();
  return (
    <SettingsScreen title="Client certificate">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {!clientCertificatesAvailable ? (
          <Text className="px-4 text-foreground-muted">
            Client certificates need the Android custom build.
          </Text>
        ) : origin === null ? (
          <Text className="px-4 text-foreground-muted">
            This build has no T3 Connect relay configured.
          </Text>
        ) : (
          <DefaultCertificate origin={origin} />
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function DefaultCertificate({ origin }: { readonly origin: string }) {
  const domain = origin.slice("https://".length, -1);
  const alias = useSyncExternalStore(
    subscribe,
    () => selectedClientCertificate(origin),
    () => null,
  );
  const [busy, setBusy] = useState(false);
  const act = (remove: boolean) => {
    setBusy(true);
    void (remove ? removeClientCertificate(origin) : chooseClientCertificate(origin))
      .catch((error: unknown) => {
        Dialog.alert(
          "Client certificate",
          error instanceof Error ? error.message : "Could not select certificate.",
        );
      })
      .finally(() => setBusy(false));
  };
  return (
    <SettingsSection
      title="Default for T3 Connect machines"
      footer={`Sent to every machine under ${domain} that asks for one, including machines added later. A certificate chosen for one environment's own address takes priority.`}
    >
      <View className="gap-3 px-4 py-4">
        <View className="gap-1">
          <Text className="text-sm text-foreground-muted">Selected certificate</Text>
          <Text className="text-base text-foreground">{alias ?? "None"}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => act(false)}
          className="rounded-xl bg-input px-4 py-3"
        >
          <Text className="text-foreground">
            {busy ? "Please wait…" : alias ? "Change certificate" : "Select certificate"}
          </Text>
        </Pressable>
        {alias ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => act(true)}
            className="px-4 py-2"
          >
            <Text className="text-danger-foreground">Remove certificate</Text>
          </Pressable>
        ) : null}
      </View>
    </SettingsSection>
  );
}
