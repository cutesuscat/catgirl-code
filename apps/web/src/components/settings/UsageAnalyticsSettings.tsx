/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code setting, English only: upstream's catalogs stay untouched */
import { useAtomValue } from "@effect/atom-react";
import type { ServerObservability } from "@t3tools/contracts";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { usageDataFor } from "../../state/usageData";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { useScopedSettings } from "./useScopedSettings";

const TITLE = "Usage analytics";

const FIELDS = [
  {
    key: "analyticsUrl",
    sourceKey: "analyticsUrlSource",
    variable: "T3CODE_POSTHOG_HOST",
    label: "Address",
    placeholder: "https://analytics.example.com",
  },
  {
    key: "analyticsKey",
    sourceKey: "analyticsKeySource",
    variable: "T3CODE_POSTHOG_KEY",
    label: "Project key",
    placeholder: "phc_…",
  },
] as const;

const OFF_DOT = "bg-muted-foreground/40";

/** What the running server does with usage analytics, as opposed to what is saved. */
function runningStatus(running: ServerObservability | undefined) {
  const { host } = usageDataFor(running);
  if (running?.analyticsEnabled === true) {
    return { label: `Sending to ${host}`, dot: "bg-success" };
  }
  if (running?.analyticsUrl !== undefined && running.analyticsKeySource !== undefined) {
    return { label: "Turned off on this machine", dot: OFF_DOT };
  }
  return { label: "Off", dot: OFF_DOT };
}

const withoutTrailingSlashes = (url: string) => url.replace(/\/+$/, "");

/** Where usage analytics go, beside the OpenTelemetry export fields and saved the same way. */
export function UsageAnalyticsSettings() {
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment) {
    return (
      <SettingsSection title={TITLE} id="usage-analytics">
        <SettingsScopeNotice target="environment">
          Choose one environment to configure where its usage analytics go.
        </SettingsScopeNotice>
      </SettingsSection>
    );
  }
  return <UsageAnalyticsForm key={environment.environmentId} />;
}

function UsageAnalyticsForm() {
  const { environment } = useSettingsScope();
  const saved = useScopedSettings((settings) => settings.observability);
  const [draft, setDraft] = useState<Partial<typeof saved>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canEdit = useAtomValue(
    serverEnvironment.checkOtlpEndpoint.permissionAtom(environment?.environmentId ?? null),
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  const running = environment?.serverConfig?.observability;
  // A server without the setting cannot keep it, so say so instead of offering it.
  const unsupported = running !== undefined && running.analyticsEnabled === undefined;
  const values = { ...saved, ...draft };
  const changedFields = FIELDS.filter(({ key }) => values[key].trim() !== saved[key]);
  const changed = changedFields.length > 0;
  const status = runningStatus(running);
  const halfFilled = (values.analyticsUrl.trim() === "") !== (values.analyticsKey.trim() === "");

  return (
    <SettingsSection title={TITLE} id="usage-analytics">
      <form
        className="grid gap-4 px-4 py-4 sm:px-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!environment || saving) return;
          setSaving(true);
          setMessage(null);
          const result = await updateSettings({
            environmentId: environment.environmentId,
            input: {
              patch: {
                observability: Object.fromEntries(
                  changedFields.map(({ key }) => [key, values[key]]),
                ),
              },
            },
          });
          setSaving(false);
          if (result._tag === "Success") {
            setDraft({});
            setMessage("Saved. Restart the server to apply.");
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Send anonymous usage events to a PostHog-compatible address that you choose. Nothing is
            built in: while either field is empty, nothing is sent. Restart the server to apply.
            Environment variables override these settings.
          </p>
          {!unsupported && (
            <div className="flex shrink-0 items-center gap-1.5">
              <ConnectionStatusDot dotClassName={status.dot} />
              <span className="text-xs text-muted-foreground">{status.label}</span>
            </div>
          )}
        </div>
        {unsupported && (
          <p className="text-xs text-muted-foreground">
            The server on {environment?.label ?? "this machine"} does not have this setting, so
            nothing can be saved here. An official T3 Code server reports usage to T3 Code unless{" "}
            <code className="font-mono">T3CODE_TELEMETRY_ENABLED=false</code> is set in its
            environment.
          </p>
        )}
        {!unsupported && !canEdit && (
          <p className="text-xs text-muted-foreground">
            This connection lacks permission to change settings on{" "}
            {environment?.label ?? "the selected environment"}.
          </p>
        )}
        {!unsupported &&
          FIELDS.map(({ key, sourceKey, variable, label, placeholder }) => {
            const fromEnvironment = running?.[sourceKey] === "environment";
            const runningUrl = running?.analyticsUrl;
            const savedDiffers =
              key === "analyticsUrl" && withoutTrailingSlashes(saved[key]) !== (runningUrl ?? "");
            return (
              <div key={key} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={key}>{label}</Label>
                  {fromEnvironment && (
                    <span className="text-xs text-muted-foreground">Set by environment</span>
                  )}
                </div>
                <Input
                  id={key}
                  size="sm"
                  {...(key === "analyticsUrl"
                    ? {
                        type: "url",
                        pattern: "[Hh][Tt][Tt][Pp][Ss]?://.*",
                        title: "Enter an HTTP or HTTPS address, or leave empty to send nothing.",
                      }
                    : { type: "text", autoComplete: "off", spellCheck: false })}
                  placeholder={placeholder}
                  value={values[key]}
                  disabled={saving || !canEdit}
                  onChange={(event) => {
                    const value = event.target.value;
                    // Clear restored drafts so later saves cannot overwrite another client's changes.
                    setDraft((previous) => {
                      const next = { ...previous, [key]: value };
                      if (value.trim() === saved[key]) delete next[key];
                      return next;
                    });
                    setMessage(null);
                  }}
                />
                {(fromEnvironment || savedDiffers) && (
                  <p className="break-all text-xs text-muted-foreground">
                    Running: {key === "analyticsUrl" ? (runningUrl ?? "None") : "A key"}
                    {fromEnvironment && (
                      <>
                        {" "}
                        from <code className="font-mono">{variable}</code>
                      </>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        {!unsupported && halfFilled && (
          <p className="text-xs text-muted-foreground">
            Nothing is sent until both the address and the project key are filled in.
          </p>
        )}
        {!unsupported && status.label === "Turned off on this machine" && (
          <p className="text-xs text-muted-foreground">
            An address and key are set, but this machine says no:{" "}
            <code className="font-mono">T3CODE_TELEMETRY_ENABLED=false</code>,{" "}
            <code className="font-mono">DO_NOT_TRACK</code>, a managed policy, or a CI runner.
          </p>
        )}
        {!unsupported && (
          <div className="flex items-center justify-between gap-3">
            <p role="status" className="text-xs text-muted-foreground">
              {message}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={!changed || saving || !canEdit}
                onClick={() => {
                  setDraft({});
                  setMessage(null);
                }}
              >
                Discard
              </Button>
              <Button type="submit" size="xs" disabled={!changed || saving || !canEdit}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </form>
    </SettingsSection>
  );
}
