import { useClerk } from "@clerk/react";
import { runAtomCommand, settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { ConnectServiceSettings as SavedConnectService } from "@t3tools/contracts";
import type {
  ConnectServiceCheck,
  ConnectServiceDraft,
  ResolvedConnectService,
} from "@t3tools/shared/connectService";
import {
  connectServiceCheckProblem,
  connectServiceSourceLabel,
} from "@t3tools/shared/connectServiceCopy";
import { T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import {
  appliedConnectService,
  builtInConnectService,
  checkConnectServiceDraft,
  saveConnectService,
} from "~/cloud/connectService";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { environmentCatalog } from "~/connection/catalog";
import { isElectron } from "~/env";
import { appAtomRegistry } from "~/rpc/atomRegistry";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { AdvancedSettings } from "./AdvancedSettings";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

type CheckProblem = Exclude<ConnectServiceCheck, { readonly _tag: "Ready" }>;

export interface ConnectServiceFormProps {
  readonly applied: ResolvedConnectService;
  /** False for a build that ships no service, where resetting turns T3 Connect off. */
  readonly hasBuiltIn: boolean;
  readonly desktop: boolean;
  /** False where a production sign-in key cannot work: a browser page outside the key's domain. */
  readonly signInWorksHere: boolean;
  readonly check: (draft: ConnectServiceDraft) => Promise<ConnectServiceCheck>;
  readonly save: (settings: SavedConnectService | null) => Promise<void>;
  /** Signs out of the service in use and forgets the machines reached through it. */
  readonly leave: () => Promise<void>;
}

const sameService = (settings: SavedConnectService, applied: ResolvedConnectService) =>
  settings.source === applied.source &&
  settings.relayUrl === applied.relayUrl &&
  settings.clerkPublishableKey === applied.clerkPublishableKey &&
  settings.clerkJwtTemplate === applied.clerkJwtTemplate &&
  settings.clerkCliOAuthClientId === applied.clerkCliOAuthClientId;

const hostOf = (relayUrl: string) => relayUrl.replace(/^https:\/\//u, "");

export function ConnectServiceForm({
  applied,
  hasBuiltIn,
  desktop,
  signInWorksHere,
  check,
  save,
  leave,
}: ConnectServiceFormProps) {
  const gt = useGT();
  const messages = useMessages();
  const searchableSetting = useSearchableSetting();
  const saved = applied.source === "discovered" || applied.source === "manual";
  const typed = applied.source === "manual";
  const [relayUrl, setRelayUrl] = useState(applied.relayUrl ?? "");
  const [clerkPublishableKey, setClerkPublishableKey] = useState(
    typed ? (applied.clerkPublishableKey ?? "") : "",
  );
  const [clerkJwtTemplate, setClerkJwtTemplate] = useState(
    typed ? (applied.clerkJwtTemplate ?? "") : "",
  );
  const [clerkCliOAuthClientId, setClerkCliOAuthClientId] = useState(
    typed ? (applied.clerkCliOAuthClientId ?? "") : "",
  );
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<CheckProblem | "check-failed" | "unchanged" | null>(null);
  // `undefined` is closed; `null` asks to go back to the built-in service.
  const [pending, setPending] = useState<SavedConnectService | null | undefined>(undefined);
  const [applying, setApplying] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setProblem(null);
  };

  const submit = async () => {
    setProblem(null);
    setChecking(true);
    const result = await settlePromise(() =>
      check({ relayUrl, clerkPublishableKey, clerkJwtTemplate, clerkCliOAuthClientId }),
    );
    setChecking(false);
    if (result._tag !== "Success") return setProblem("check-failed");
    if (result.value._tag !== "Ready") return setProblem(result.value);
    if (sameService(result.value.settings, applied)) return setProblem("unchanged");
    setPending(result.value.settings);
  };

  const apply = async () => {
    if (pending === undefined) return;
    setApplying(true);
    setApplyFailed(false);
    // Leaving can fail when the old service is the broken thing being replaced.
    await settlePromise(leave);
    const result = await settlePromise(() => save(pending));
    if (result._tag === "Success") return;
    setApplying(false);
    setApplyFailed(true);
  };

  const signInValuesNeeded =
    typeof problem === "object" &&
    problem !== null &&
    (problem._tag === "NotPublished" ||
      problem._tag === "UnreadableDocument" ||
      (problem._tag === "InvalidFields" && problem.fields[0] !== "relayUrl"));
  const problemText =
    problem === null
      ? null
      : problem === "check-failed"
        ? gt("Could not check this address. Try again.")
        : problem === "unchanged"
          ? gt("This device already uses this service.")
          : connectServiceCheckProblem(problem, messages);
  const target = pending?.relayUrl ?? null;

  return (
    <SettingsSection {...searchableSetting("connect-service")}>
      <SettingsRow
        title={gt("Connect address")}
        description={
          applied.relayUrl === null
            ? gt(
                "T3 Connect lets your devices find and reach your machines. Enter the address of a Connect service to turn it on.",
              )
            : gt(
                "The service your devices use to find and reach your machines. Enter the address of your own to use it instead.",
              )
        }
        status={
          <span data-testid="connect-service-source">
            {applied.relayUrl === null
              ? gt("T3 Connect is not set up on this device.")
              : gt("Using {host}. {source}.", {
                  host: hostOf(applied.relayUrl),
                  source: connectServiceSourceLabel(applied.source, messages),
                })}
            {applied.relayUrl !== null && !signInWorksHere ? (
              <span className="block pt-0.5">
                <T>
                  Its sign-in key only works in the desktop app or on a page under its own domain.
                </T>
              </span>
            ) : null}
          </span>
        }
      >
        <form
          className="flex flex-wrap items-center gap-2 pt-3 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="min-w-56 flex-1">
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-label={gt("Connect address")}
              placeholder="https://relay.example.com"
              value={relayUrl}
              onChange={(event) => edit(setRelayUrl)(event.target.value)}
              disabled={checking}
            />
          </div>
          <Button type="submit" disabled={checking || relayUrl.trim() === ""}>
            {checking ? (
              <>
                <Spinner size="sm" />
                <T>Checking…</T>
              </>
            ) : (
              gt("Save")
            )}
          </Button>
          {saved ? (
            <Button
              type="button"
              variant="outline"
              disabled={checking}
              onClick={() => setPending(null)}
            >
              {hasBuiltIn ? gt("Reset to built-in") : gt("Remove")}
            </Button>
          ) : null}
        </form>
        {problemText ? (
          <p
            role={problem === "unchanged" ? "status" : "alert"}
            className={
              problem === "unchanged"
                ? "pb-2 text-xs text-muted-foreground"
                : "pb-2 text-xs text-destructive"
            }
          >
            {problemText}
          </p>
        ) : null}
      </SettingsRow>
      <AdvancedSettings targetIds={[]} openRequested={signInValuesNeeded}>
        <SettingsRow
          title={gt("Sign-in key")}
          description={gt(
            "The Clerk publishable key. Leave these three empty to use the values the service publishes.",
          )}
          control={
            <div className="w-full @min-[32rem]/settings-row:w-72">
              <Input
                font="mono"
                autoComplete="off"
                spellCheck={false}
                aria-label={gt("Sign-in key")}
                placeholder="pk_live_…"
                value={clerkPublishableKey}
                onChange={(event) => edit(setClerkPublishableKey)(event.target.value)}
                disabled={checking}
              />
            </div>
          }
        />
        <SettingsRow
          title={gt("Token template")}
          description={gt("The name of the Clerk JWT template the service accepts.")}
          control={
            <div className="w-full @min-[32rem]/settings-row:w-72">
              <Input
                font="mono"
                autoComplete="off"
                spellCheck={false}
                aria-label={gt("Token template")}
                placeholder="t3-relay"
                value={clerkJwtTemplate}
                onChange={(event) => edit(setClerkJwtTemplate)(event.target.value)}
                disabled={checking}
              />
            </div>
          }
        />
        <SettingsRow
          title={gt("Command-line client ID")}
          description={gt(
            "The Clerk OAuth client the t3 connect command signs in with. Optional in this app.",
          )}
          control={
            <div className="w-full @min-[32rem]/settings-row:w-72">
              <Input
                font="mono"
                autoComplete="off"
                spellCheck={false}
                aria-label={gt("Command-line client ID")}
                value={clerkCliOAuthClientId}
                onChange={(event) => edit(setClerkCliOAuthClientId)(event.target.value)}
                disabled={checking}
              />
            </div>
          }
        />
      </AdvancedSettings>
      <AlertDialog
        open={pending !== undefined}
        onOpenChange={(open) => {
          if (applying || open) return;
          setPending(undefined);
          setApplyFailed(false);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target === null
                ? hasBuiltIn
                  ? gt("Go back to the built-in service?")
                  : gt("Remove this service?")
                : gt("Use {host} for T3 Connect?", { host: hostOf(target) })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {desktop
                ? gt(
                    "T3 Code will restart. You will be signed out of the current service, and machines reached through it leave your list until you link them to the new one. Agents and terminals running on this computer will stop.",
                  )
                : gt(
                    "This page will reload. You will be signed out of the current service, and machines reached through it leave your list until you link them to the new one.",
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {applyFailed ? (
            <p role="alert" className="px-6 pb-4 text-sm text-destructive">
              <T>Could not save the service. Nothing was changed.</T>
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose disabled={applying} render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button disabled={applying} onClick={() => void apply()}>
              {applying ? (
                <>
                  <Spinner size="sm" />
                  {desktop ? gt("Restarting…") : gt("Reloading…")}
                </>
              ) : desktop ? (
                gt("Restart and switch")
              ) : (
                gt("Reload and switch")
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}

async function forgetRelayEnvironments(): Promise<void> {
  await runAtomCommand(appAtomRegistry, environmentCatalog.removeRelayEnvironments, undefined, {
    reportFailure: false,
    reportDefect: false,
  });
}

function connectServiceFormProps(): Omit<ConnectServiceFormProps, "leave"> {
  const builtIn = builtInConnectService();
  return {
    applied: appliedConnectService(),
    hasBuiltIn: Boolean(builtIn.relayUrl && builtIn.clerkPublishableKey),
    desktop: isElectron,
    signInWorksHere: hasCloudPublicConfig(),
    check: checkConnectServiceDraft,
    save: saveConnectService,
  };
}

function SignedInConnectServiceSettings() {
  const clerk = useClerk();
  return (
    <ConnectServiceForm
      {...connectServiceFormProps()}
      leave={async () => {
        await forgetRelayEnvironments();
        // Stay on this page: the default sign-out redirect would race the save that follows.
        if (clerk.loaded && clerk.user) await clerk.signOut({ redirectUrl: window.location.href });
      }}
    />
  );
}

/** Where this device points T3 Connect: the service its build ships with, or one saved here. */
export function ConnectServiceSettings() {
  // Clerk's hooks exist only under the auth shell, which mounts when a service is configured.
  return hasCloudPublicConfig() ? (
    <SignedInConnectServiceSettings />
  ) : (
    <ConnectServiceForm {...connectServiceFormProps()} leave={forgetRelayEnvironments} />
  );
}
