import { useGT } from "gt-react-native";
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
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const origin = relayCertificateOrigin();
  return (
    <SettingsScreen title={gt("Client certificate")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {!clientCertificatesAvailable ? (
          <Text className="px-4 text-foreground-muted">
            {gt("Client certificates need the Android custom build.")}
          </Text>
        ) : origin === null ? (
          <Text className="px-4 text-foreground-muted">
            {gt("This build has no {product} relay configured.", { product: "T3 Connect" })}
          </Text>
        ) : (
          <DefaultCertificate origin={origin} />
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function DefaultCertificate({ origin }: { readonly origin: string }) {
  const gt = useGT();
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
          gt("Client certificate"),
          error instanceof Error ? error.message : gt("Could not select certificate."),
        );
      })
      .finally(() => setBusy(false));
  };
  return (
    <SettingsSection
      title={gt("Default for {product} machines", { product: "T3 Connect" })}
      footer={gt(
        "Sent to every machine under {domain} that asks for one, including machines added later. A certificate chosen for one environment's own address takes priority.",
        { domain },
      )}
    >
      <View className="gap-3 px-4 py-4">
        <View className="gap-1">
          <Text className="text-sm text-foreground-muted">{gt("Selected certificate")}</Text>
          <Text className="text-base text-foreground">
            {alias ?? gt("None", { $context: "no client certificate is selected" })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => act(false)}
          className="rounded-xl bg-input px-4 py-3"
        >
          <Text className="text-foreground">
            {busy
              ? gt("Please wait…")
              : alias
                ? gt("Change certificate")
                : gt("Select certificate")}
          </Text>
        </Pressable>
        {alias ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => act(true)}
            className="px-4 py-2"
          >
            <Text className="text-danger-foreground">{gt("Remove certificate")}</Text>
          </Pressable>
        ) : null}
      </View>
    </SettingsSection>
  );
}
