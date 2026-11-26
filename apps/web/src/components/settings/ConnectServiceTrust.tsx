/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Connect version 2, English only: upstream's catalogs stay untouched */
import type { ConnectServiceSettings } from "@t3tools/contracts";
import {
  CONNECT_DIAGNOSTICS_KINDS,
  connectDiagnosticsOffers,
  connectKeyFingerprint,
  connectServiceName,
  declineConnectIdentityChange,
  sameConnectFingerprint,
} from "@t3tools/shared/connectDocument";
import {
  CONNECT_DIAGNOSTICS_LABELS,
  connectChangeText,
  connectRefreshProblemText,
} from "@t3tools/shared/connectDocumentCopy";
import {
  connectServiceAfterRestart,
  connectServiceNeedsRestart,
} from "@t3tools/shared/connectService";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
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
import { SettingsRow } from "./settingsLayout";

type Signed = ConnectServiceSettings & {
  readonly connect: NonNullable<ConnectServiceSettings["connect"]>;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function Fingerprint({ value }: { readonly value: string }) {
  return (
    <code data-testid="connect-fingerprint" className="font-mono text-foreground">
      {value}
    </code>
  );
}

const fingerprintOf = (key: string) => connectKeyFingerprint(key) ?? "unknown";

/** Shown before a new service is saved: who it is, and the key this device is about to pin. */
export function ConnectFirstUseDetails({
  settings,
  linkFingerprint,
}: {
  readonly settings: ConnectServiceSettings;
  readonly linkFingerprint: string | null;
}) {
  if (!settings.connect) return null;
  const fingerprint = fingerprintOf(settings.connect.key);
  const offers = CONNECT_DIAGNOSTICS_KINDS.filter(
    (kind) => connectDiagnosticsOffers(settings.connect?.document)[kind] !== undefined,
  );
  return (
    <dl
      data-testid="connect-first-use"
      className="mx-6 mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border/70 px-3 py-2 text-sm"
    >
      <dt className="text-muted-foreground">Service</dt>
      <dd>{connectServiceName(settings.connect.document, settings.relayUrl)}</dd>
      <dt className="text-muted-foreground">Address</dt>
      <dd>{hostOf(settings.relayUrl)}</dd>
      <dt className="text-muted-foreground">Identity</dt>
      <dd>
        <Fingerprint value={fingerprint} />
      </dd>
      <dd className="col-span-2 pt-1 text-xs text-muted-foreground">
        {linkFingerprint !== null && sameConnectFingerprint(linkFingerprint, fingerprint)
          ? "Matches the setup link. This device will remember this identity and warn you if it changes."
          : "Check this matches what the service's operator gave you. This device will remember it and warn you if it changes."}
        {offers.length > 0
          ? ` It offers to receive ${offers
              .map((kind) => CONNECT_DIAGNOSTICS_LABELS[kind].noun.toLowerCase())
              .join(", ")}; nothing is sent unless you turn it on.`
          : null}
      </dd>
    </dl>
  );
}

function IdentityChangedNotice({
  current,
  update,
  restartInto,
}: {
  readonly current: Signed;
  readonly update: (settings: ConnectServiceSettings) => Promise<boolean>;
  readonly restartInto: (settings: ConnectServiceSettings) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const change = current.connect.identityChange;
  if (!change) return null;
  const oldFingerprint = fingerprintOf(current.connect.key);
  const newFingerprint = fingerprintOf(change.envelope.key);
  const name = connectServiceName(current.connect.document, current.relayUrl);
  const trusted = connectServiceAfterRestart(current, "trust-new-identity");
  const restartNeeded = trusted !== null && connectServiceNeedsRestart(current, trusted);

  const trust = async () => {
    if (trusted === null) return setFailed(true);
    if (restartNeeded) {
      setConfirming(false);
      return restartInto(trusted);
    }
    if (await update(trusted)) return setConfirming(false);
    setFailed(true);
  };

  if (change.declined) {
    return (
      <p
        data-testid="connect-identity-declined"
        className="px-4 pb-3 text-xs text-muted-foreground"
      >
        Keeping the old settings. {name} now presents another identity (
        <Fingerprint value={newFingerprint} />
        ).{" "}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() =>
            void update({
              ...current,
              connect: { ...current.connect, identityChange: { ...change, declined: false } },
            })
          }
        >
          Review
        </button>
      </p>
    );
  }

  return (
    <div className="px-4 pb-3">
      <Alert variant="warning" data-testid="connect-identity-changed" role="alert">
        <AlertTitle>This Connect service's identity changed</AlertTitle>
        <AlertDescription>
          <p>
            {name} now presents the identity <Fingerprint value={newFingerprint} /> instead of{" "}
            <Fingerprint value={oldFingerprint} />, and the old one did not endorse it. Nothing from
            it is used: this device keeps the settings it last trusted until you decide. If you did
            not expect this, keep the old settings and ask the service's operator.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="compact"
              onClick={() =>
                void update({ ...current, connect: declineConnectIdentityChange(current.connect) })
              }
            >
              Keep using the old settings
            </Button>
            <Button size="compact" variant="outline" onClick={() => setConfirming(true)}>
              Trust the new identity…
            </Button>
          </div>
        </AlertDescription>
      </Alert>
      <AlertDialog open={confirming} onOpenChange={(open) => setConfirming(open)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Trust the new identity of {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Only do this if the service's operator told you its identity changed, ideally some
              other way than this app. Any diagnostics you allowed are turned off again.
              {restartNeeded
                ? " Its sign-in values changed too, so the app restarts and signs you out."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="mx-6 mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Trusted until now</dt>
            <dd>
              <Fingerprint value={oldFingerprint} />
            </dd>
            <dt className="text-muted-foreground">New identity</dt>
            <dd>
              <Fingerprint value={newFingerprint} />
            </dd>
          </dl>
          {failed || trusted === null ? (
            <p role="alert" className="px-6 pb-4 text-sm text-destructive">
              This identity's document can no longer be used (it may have expired). Nothing was
              changed.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" disabled={trusted === null} onClick={() => void trust()}>
              Trust {newFingerprint}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

const offerWhere = {
  analytics:
    "Sent by a machine's T3 server. Each machine decides for itself in Settings › Diagnostics › Usage analytics, off until turned on there.",
  crashReports: "Sent by the phone app. Each phone decides for itself, off until turned on there.",
  traces: "Sent by the phone app. Each phone decides for itself, off until turned on there.",
} as const;

const RECENT_SHOWN = 3;

function RecentChanges({ current }: { readonly current: Signed }) {
  const [all, setAll] = useState(false);
  const changes = current.connect.recentChanges ?? [];
  if (changes.length === 0) return null;
  const shown = all ? changes : changes.slice(0, RECENT_SHOWN);
  return (
    <SettingsRow
      title="Recent changes"
      description="What the service changed in its document, newest first. Changes to sign-in apply when the app restarts."
    >
      <ul data-testid="connect-recent-changes" className="space-y-1 pt-2 pb-1 text-xs">
        {shown.map((change) => (
          <li
            key={`${change.at}-${change.kind}-${change.diagnostics ?? ""}`}
            className="flex gap-2"
          >
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {change.at.slice(0, 10)}
            </span>
            <span>{connectChangeText(change)}</span>
          </li>
        ))}
      </ul>
      {changes.length > RECENT_SHOWN ? (
        <button
          type="button"
          className="pb-2 text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${changes.length}`}
        </button>
      ) : null}
    </SettingsRow>
  );
}

/** What this device knows about a signed service: who it is, what changed, what it offers. */
export function ConnectServiceTrust({
  current,
  update,
  restartInto,
}: {
  readonly current: Signed;
  readonly update: (settings: ConnectServiceSettings) => Promise<boolean>;
  readonly restartInto: (settings: ConnectServiceSettings) => void;
}) {
  const { document, key, refreshProblem, pending } = current.connect;
  const name = connectServiceName(document, current.relayUrl);
  const offers = connectDiagnosticsOffers(document);
  const pendingSettings = pending ? connectServiceAfterRestart(current, "pending") : null;
  const links = [
    { label: "Privacy policy", url: document.service?.privacyPolicyUrl ?? "" },
    { label: "Contact the operator", url: document.service?.operatorContact ?? "" },
  ].filter((link) => link.url.startsWith("https://"));

  return (
    <>
      <SettingsRow
        data-testid="connect-service-identity"
        title={name}
        description={
          <>
            {hostOf(current.relayUrl)} · signed by <Fingerprint value={fingerprintOf(key)} />
            {links.map((link) => (
              <span key={link.label}>
                {" · "}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {link.label}
                </a>
              </span>
            ))}
          </>
        }
        status={
          refreshProblem ? (
            <span data-testid="connect-refresh-problem" className="text-warning-foreground">
              {connectRefreshProblemText(refreshProblem)}
            </span>
          ) : (
            `Checked ${current.connect.checkedAt.slice(0, 10)}.`
          )
        }
      />
      <IdentityChangedNotice current={current} update={update} restartInto={restartInto} />
      {pendingSettings !== null ? (
        <SettingsRow
          data-testid="connect-pending-sign-in"
          title="New sign-in values"
          description={`${name} changed how devices sign in. This device keeps the old ones until the app restarts.`}
          control={
            <Button size="compact" variant="outline" onClick={() => restartInto(pendingSettings)}>
              Restart to apply…
            </Button>
          }
        />
      ) : null}
      {CONNECT_DIAGNOSTICS_KINDS.map((kind) => {
        const offer = offers[kind];
        if (!offer) return null;
        return (
          <SettingsRow
            key={kind}
            data-testid={`connect-offer-${kind}`}
            title={CONNECT_DIAGNOSTICS_LABELS[kind].verb(name)}
            description={`Offered by the service, to ${hostOf(offer.url)}. ${offerWhere[kind]}`}
            status="Not switched on by the service."
          />
        );
      })}
      <RecentChanges current={current} />
    </>
  );
}
