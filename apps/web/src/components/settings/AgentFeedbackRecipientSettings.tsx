/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import { T3_TEAM_LABEL } from "@t3tools/client-runtime/catgirl-feedback";
import type { AgentFeedbackMode, AgentFeedbackRecipient } from "@t3tools/contracts";
import { T3_CODE } from "@t3tools/shared/agentFeedbackRecipient";
import type { ReactNode } from "react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

type Choice = "off" | AgentFeedbackRecipient;

const CHOICES: ReadonlyArray<{ readonly value: Choice; readonly label: string }> = [
  { value: "off", label: "Off" },
  { value: "t3code", label: T3_TEAM_LABEL },
  { value: "catgirl-code", label: "Catgirl Code" },
];

const DESCRIPTIONS: Record<Choice, string> = {
  off: "Agents send no feedback. Choose who should get reports about this app and its agent tools.",
  t3code: `Reports go to the ${T3_CODE} team. They did not make Catgirl Code, so keep reports to ${T3_CODE} itself. Each is anonymous; one you ask for is shown to you first.`,
  "catgirl-code":
    "A report you ask for opens a new issue on Catgirl Code's GitHub, filled in for you to check and submit. Issues are public and show your GitHub name.",
};

const WHEN: ReadonlyArray<{
  readonly mode: Exclude<AgentFeedbackMode, "off">;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "on-request",
    label: "When I ask",
    description: "Agents send a report only when you ask for one, after you approve it in a card.",
  },
  {
    mode: "auto",
    label: "Automatic",
    description: `Agents also report ${T3_CODE} problems they hit on their own, such as a T3 tool that failed. These carry no text the agent wrote.`,
  },
];

/**
 * Catgirl Code's Agent feedback rows: who gets reports, then, for T3 Code's team, when. Machines
 * that run T3 Code's own server send only to its team, so with only those in scope the row is
 * upstream's, passed in as `upstream`.
 */
export function AgentFeedbackRecipientRows({ upstream }: { readonly upstream: ReactNode }) {
  const searchableSetting = useSearchableSetting();
  const { scope, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["agentFeedback"]);
  if (
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    connectedEnvironments.length === 0 ||
    connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.agentFeedback !== true,
    )
  )
    return null;
  const choosing = connectedEnvironments.filter(
    (environment) =>
      environment.serverConfig?.environment.capabilities.agentFeedbackRecipient === true,
  );
  if (choosing.length === 0) return upstream;
  const someUpstream = choosing.length < connectedEnvironments.length;

  const { mode, recipient } = settings.agentFeedback;
  const choice: Choice = mode === "off" ? "off" : recipient;
  const choose = (next: Choice) =>
    updateSettings({
      agentFeedback:
        next === "off"
          ? { mode: "off", recipient }
          : next === "catgirl-code"
            ? { mode: "on-request", recipient: next }
            : { mode: mode === "off" ? "on-request" : mode, recipient: next },
    });
  const keptHere = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.observability.agentFeedbackT3Sends === false,
  );
  const status =
    !mixed && choice === "t3code" && keptHere.length > 0
      ? `Usage data is turned off on ${keptHere.map((environment) => environment.label).join(", ")} (T3CODE_TELEMETRY_ENABLED=false, DO_NOT_TRACK or a policy), so reports stay there and are not sent.`
      : undefined;

  return (
    <>
      <SettingsRow
        serverScoped
        {...searchableSetting("agent-feedback")}
        settingKeys={["agentFeedback"]}
        description={
          someUpstream
            ? `Some of these machines run ${T3_CODE}'s own server, which sends feedback only to its team. Choose one machine to change where its reports go.`
            : mixed
              ? "The selected machines send agent feedback to different places."
              : DESCRIPTIONS[choice]
        }
        status={status}
        control={
          <Select
            value={mixed ? null : choice}
            disabled={someUpstream}
            onValueChange={(next) => {
              if (next !== null) choose(next);
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Agent feedback">
              <SelectValue>
                {(value: Choice | null) =>
                  value === null
                    ? "Mixed"
                    : CHOICES.find((candidate) => candidate.value === value)?.label
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {CHOICES.map((candidate) => (
                <SelectItem key={candidate.value} hideIndicator value={candidate.value}>
                  {candidate.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {!mixed && !someUpstream && choice === "t3code" ? (
        <SettingsRow
          serverScoped
          title="When agents report"
          settingKeys={["agentFeedback"]}
          description={WHEN.find((candidate) => candidate.mode === mode)?.description}
          control={
            <Select
              value={mode === "off" ? null : mode}
              onValueChange={(next) => {
                if (next !== null) updateSettings({ agentFeedback: { mode: next, recipient } });
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="When agents report">
                <SelectValue>
                  {(value: Exclude<AgentFeedbackMode, "off"> | null) =>
                    WHEN.find((candidate) => candidate.mode === value)?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {WHEN.map((candidate) => (
                  <SelectItem key={candidate.mode} hideIndicator value={candidate.mode}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
    </>
  );
}
