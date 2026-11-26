/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Connect version 2, English only: upstream's catalogs stay untouched */
import type { ConnectServiceSettings } from "@t3tools/contracts";
import {
  connectDiagnosticsAllowed,
  connectDiagnosticsOffers,
  connectKeyFingerprint,
  connectServiceName,
  declineConnectIdentityChange,
  sameConnectFingerprint,
  setConnectDiagnosticsAnswer,
} from "@t3tools/shared/connectDocument";
import {
  CONNECT_DIAGNOSTICS_LABELS,
  connectChangeText,
  connectKeyChangeText,
  connectRefreshProblemText,
} from "@t3tools/shared/connectDocumentCopy";
import {
  connectServiceAfterRestart,
  connectServiceNeedsRestart,
} from "@t3tools/shared/connectService";
import Constants from "expo-constants";
import { Linking, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import {
  ConnectIdentityView,
  connectIdentityInline,
  connectIdentityText,
} from "./ConnectIdentityView";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

type Signed = ConnectServiceSettings & {
  readonly connect: NonNullable<ConnectServiceSettings["connect"]>;
};

const fingerprintOf = (key: string) => connectKeyFingerprint(key) ?? "unknown";
const hostOf = (url: string) => url.replace(/^https:\/\//u, "").replace(/\/.*$/u, "");

/** Added to the restart question when a new service is about to be pinned. */
export function connectFirstUseText(
  settings: ConnectServiceSettings,
  linkFingerprint: string | null,
): string {
  if (!settings.connect) return "";
  const fingerprint = fingerprintOf(settings.connect.key);
  return [
    "",
    `Service: ${connectServiceName(settings.connect.document, settings.relayUrl)}`,
    `Address: ${hostOf(settings.relayUrl)}`,
    `Identity: ${connectIdentityText(fingerprint)}`,
    linkFingerprint !== null && sameConnectFingerprint(linkFingerprint, fingerprint)
      ? "Matches the setup link. This phone will warn you if it changes."
      : "Check this matches what the service's operator gave you. This phone will warn you if it changes.",
  ].join("\n");
}

/** Where this build sends crash reports: fixed when the app was built, whatever a service offers. */
function compiledCrashReportHost(): string | null {
  const relay: unknown = Constants.expoConfig?.extra?.relay?.url;
  return typeof relay === "string" && relay.trim() !== "" ? hostOf(relay.trim()) : null;
}

export function ConnectServiceTrustSection({
  current,
  update,
  restartInto,
}: {
  readonly current: Signed;
  readonly update: (settings: ConnectServiceSettings) => boolean;
  readonly restartInto: (settings: ConnectServiceSettings) => void;
}) {
  const { document, key, refreshProblem, identityChange, pending } = current.connect;
  const name = connectServiceName(document, current.relayUrl);
  const offers = connectDiagnosticsOffers(document);
  const changes = current.connect.recentChanges ?? [];

  const trustNewIdentity = () => {
    const trusted = connectServiceAfterRestart(current, "trust-new-identity");
    if (trusted === null) {
      return Dialog.confirm({
        title: "This identity can no longer be used",
        message: "Its document may have expired. Nothing was changed.",
        confirmText: "OK",
        onConfirm: () => undefined,
      });
    }
    const newFingerprint = fingerprintOf(trusted.connect?.key ?? "");
    Dialog.confirm({
      title: `Trust the new identity of ${name}?`,
      message: [
        `Trusted until now: ${connectIdentityText(fingerprintOf(key))}`,
        "",
        `New identity: ${connectIdentityText(newFingerprint)}`,
        "",
        "Only do this if the service's operator told you its identity changed, ideally some other way than this app. Any diagnostics you allowed are turned off again.",
      ].join("\n"),
      confirmText: `Trust ${newFingerprint}`,
      destructive: true,
      onConfirm: () =>
        connectServiceNeedsRestart(current, trusted) ? restartInto(trusted) : void update(trusted),
    });
  };

  const crashHost = compiledCrashReportHost();
  return (
    <>
      <SettingsSection
        title={name}
        footer={
          refreshProblem
            ? connectRefreshProblemText(refreshProblem)
            : `Checked ${current.connect.checkedAt.slice(0, 10)}.`
        }
      >
        <View className="gap-2 p-4" testID="connect-service-identity">
          <Text className="text-sm text-foreground">{hostOf(current.relayUrl)}</Text>
          <ConnectIdentityView label="Signed by" fingerprint={fingerprintOf(key)} />
          <View className="flex-row flex-wrap gap-3">
            {document.service?.privacyPolicyUrl?.startsWith("https://") ? (
              <Button
                label="Privacy policy"
                tone="text"
                size="compact"
                onPress={() => void Linking.openURL(document.service?.privacyPolicyUrl ?? "")}
              />
            ) : null}
            {document.service?.operatorContact?.startsWith("https://") ? (
              <Button
                label="Contact the operator"
                tone="text"
                size="compact"
                onPress={() => void Linking.openURL(document.service?.operatorContact ?? "")}
              />
            ) : null}
          </View>
        </View>
      </SettingsSection>

      {identityChange && !identityChange.declined ? (
        <SettingsSection title="This Connect service's identity changed">
          <View className="gap-3 p-4" testID="connect-identity-changed">
            <Text accessibilityRole="alert" className="text-sm text-foreground">
              {`${name} now presents a new identity, and the one this phone trusts did not endorse it. Nothing from it is used: this phone keeps the settings it last trusted until you decide.`}
            </Text>
            <ConnectIdentityView label="Trusted until now" fingerprint={fingerprintOf(key)} />
            <ConnectIdentityView
              label="New identity"
              fingerprint={fingerprintOf(identityChange.envelope.key)}
            />
            <View className="flex-row flex-wrap gap-3">
              <Button
                label="Keep using the old settings"
                tone="primary"
                onPress={() =>
                  void update({
                    ...current,
                    connect: declineConnectIdentityChange(current.connect),
                  })
                }
              />
              <Button label="Trust the new identity…" onPress={trustNewIdentity} />
            </View>
          </View>
        </SettingsSection>
      ) : null}
      {identityChange?.declined ? (
        <Text className="px-1 text-sm text-foreground-muted">
          {`Keeping the old settings. ${name} now presents another identity (${connectIdentityInline(fingerprintOf(identityChange.envelope.key))}).`}
        </Text>
      ) : null}

      {pending ? (
        <SettingsSection
          title="New sign-in values"
          footer={`${name} changed how devices sign in. This phone keeps the old ones until the app restarts.`}
        >
          <View className="p-4">
            <Button
              label="Restart to apply"
              onPress={() => {
                const next = connectServiceAfterRestart(current, "pending");
                if (next !== null) restartInto(next);
              }}
            />
          </View>
        </SettingsSection>
      ) : null}

      {offers.traces || offers.crashReports || offers.analytics ? (
        <SettingsSection
          title={`What ${name} offers to receive`}
          footer="Offers only: nothing is sent unless you turn it on, and a service cannot turn anything on."
        >
          {offers.traces ? (
            <SettingsSwitchRow
              label={CONNECT_DIAGNOSTICS_LABELS.traces.verb(name)}
              subtitle={`Timings of Connect operations, to ${hostOf(offers.traces.url)}, with a token from your sign-in. Takes effect when the app next starts if it was off then.`}
              value={connectDiagnosticsAllowed(current.connect, "traces")}
              onValueChange={(allowed) =>
                void update({
                  ...current,
                  connect: setConnectDiagnosticsAnswer(current.connect, "traces", allowed),
                })
              }
            />
          ) : null}
          {offers.crashReports ? (
            <View className="p-4">
              <Text className="text-sm text-foreground">
                {CONNECT_DIAGNOSTICS_LABELS.crashReports.verb(name)}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {crashHost
                  ? `This app can only send crash reports to the address it was built with (${crashHost}), switched in Settings › About › Diagnostics. Following ${name}'s address needs an app built for it.`
                  : `This app was built without a crash report address, so it sends none. Following ${name}'s address needs an app built for it.`}
              </Text>
            </View>
          ) : null}
          {offers.analytics ? (
            <View className="p-4">
              <Text className="text-sm text-foreground">
                {CONNECT_DIAGNOSTICS_LABELS.analytics.verb(name)}
              </Text>
              <Text className="text-sm text-foreground-muted">
                Sent by a machine's T3 server, not by this phone. Each machine decides for itself in
                its Settings › Diagnostics.
              </Text>
            </View>
          ) : null}
        </SettingsSection>
      ) : null}

      {changes.length > 0 ? (
        <SettingsSection title="Recent changes">
          <View className="gap-1.5 p-4" testID="connect-recent-changes">
            {changes.slice(0, 5).map((change) => {
              const keyChange = connectKeyChangeText(change);
              const rowKey = `${change.at}-${change.kind}-${change.diagnostics ?? ""}`;
              if (keyChange === null || !change.from || !change.to) {
                return (
                  <Text key={rowKey} className="text-sm text-foreground">
                    {`${change.at.slice(0, 10)}  ${connectChangeText(change)}`}
                  </Text>
                );
              }
              return (
                <View key={rowKey} className="gap-2" testID="connect-key-change">
                  <Text className="text-sm text-foreground">
                    {`${change.at.slice(0, 10)}  ${keyChange}`}
                  </Text>
                  <ConnectIdentityView label="From" fingerprint={change.from} compact />
                  <ConnectIdentityView label="To" fingerprint={change.to} compact />
                </View>
              );
            })}
          </View>
        </SettingsSection>
      ) : null}
    </>
  );
}
