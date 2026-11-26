// @effect-diagnostics globalDate:off - Test documents are dated around a fixed clock.
import "~/index.css";

import type { ConnectServiceSettings as SavedConnectService } from "@t3tools/contracts";
import { pinConnectService, verifyConnectDocument } from "@t3tools/shared/connectDocument";
import {
  signConnectDocumentForTests,
  TEST_CONNECT_SEEDS,
} from "@t3tools/shared/connectDocumentTesting";
import type { ConnectServiceCheck } from "@t3tools/shared/connectService";
import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ConnectServiceForm, type ConnectServiceFormProps } from "./ConnectServiceSettings";

const RELAY = "https://relay.example.com";
const OLD_FP = "3475 0f98 bd59 fcfc";
const NEW_FP = "6a38 03d5 f059 902a";
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-02T00:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

/** The component checks documents against the clock, so each test fixes it. */
function fixedClock(): Disposable {
  vi.setSystemTime(NOW);
  return { [Symbol.dispose]: () => vi.useRealTimers() };
}

const payload = (signIn: Record<string, string> = {}) => ({
  version: 2,
  issuedAt: at(-1),
  expiresAt: at(29),
  relayUrl: RELAY,
  service: {
    name: "Example cats",
    operatorContact: "https://example.com/contact",
    privacyPolicyUrl: "https://example.com/privacy",
  },
  signIn: {
    provider: "clerk",
    publishableKey: `pk_test_${btoa("example.clerk.accounts.dev$")}`,
    jwtTemplate: "t3-relay",
    cliOAuthClientId: "example-client",
    ...signIn,
  },
  diagnostics: {
    analytics: { url: `${RELAY}/v1/collect/analytics`, format: "posthog-batch", auth: "connect" },
    crashReports: { url: `${RELAY}/v1/collect/otlp`, format: "otlp-http", auth: "connect" },
  },
});

/** The element's whole text, matched in part: this matcher only takes a whole string. */
const expectText = (locator: { element: () => Element }, pattern: RegExp) =>
  vi.waitFor(() => expect(locator.element().textContent ?? "").toMatch(pattern));

function signed(seed: string, signIn?: Record<string, string>): SavedConnectService {
  const check = verifyConnectDocument(signConnectDocumentForTests(payload(signIn), seed), {
    relayUrl: RELAY,
    pinnedKey: null,
    now: NOW,
  });
  if (check._tag !== "Apply") throw new Error(check._tag);
  return {
    relayUrl: RELAY,
    clerkPublishableKey: check.document.signIn.publishableKey,
    clerkJwtTemplate: check.document.signIn.jwtTemplate,
    clerkCliOAuthClientId: "example-client",
    source: "discovered",
    connect: pinConnectService(check, NOW),
  };
}

const saved = signed(TEST_CONNECT_SEEDS.old);
const withIdentityChange = (signIn?: Record<string, string>): SavedConnectService => ({
  ...saved,
  connect: {
    ...saved.connect!,
    identityChange: {
      envelope: signConnectDocumentForTests(payload(signIn), TEST_CONNECT_SEEDS.new),
      seenAt: at(0),
    },
  },
});

function setup(
  check: ConnectServiceCheck,
  current: SavedConnectService | null,
  overrides: Partial<ConnectServiceFormProps> = {},
) {
  const props: ConnectServiceFormProps = {
    applied: current ?? {
      source: "none",
      relayUrl: null,
      clerkPublishableKey: null,
      clerkJwtTemplate: null,
      clerkCliOAuthClientId: null,
    },
    hasBuiltIn: false,
    desktop: false,
    signInWorksHere: true,
    check: vi.fn(async () => check),
    save: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    current,
    update: vi.fn(async () => true),
    ...overrides,
  };
  return props;
}

it("first use shows the service, its host and its fingerprint before saving pins it", async () => {
  using _clock = fixedClock();
  const props = setup({ _tag: "Ready", settings: saved }, null);
  await using screen = await render(<ConnectServiceForm {...props} />);
  await screen.getByRole("textbox", { name: "Connect address" }).fill(RELAY);
  await screen.getByRole("button", { name: "Save" }).click();

  const details = page.getByTestId("connect-first-use");
  await expectText(details, /Example cats/);
  await expectText(details, /relay\.example\.com/);
  await expectText(details, new RegExp(OLD_FP));
  await expectText(details, /Check this matches what the service's operator/);
  await expectText(details, /usage data, crash reports; nothing is sent/);
  expect(props.save).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Reload and switch" }).click();
  await vi.waitFor(() => expect(props.save).toHaveBeenCalledWith(saved));
});

it("a setup link whose fingerprint matches says so", async () => {
  using _clock = fixedClock();
  const props = setup({ _tag: "Ready", settings: saved }, null);
  await using screen = await render(<ConnectServiceForm {...props} />);
  await screen
    .getByRole("textbox", { name: "Connect address" })
    .fill(`${RELAY}/#fp=${OLD_FP.replaceAll(" ", "")}`);
  await screen.getByRole("button", { name: "Save" }).click();
  await expectText(page.getByTestId("connect-first-use"), /Matches the setup link/);
});

it("a setup link naming another key is refused and nothing is saved", async () => {
  using _clock = fixedClock();
  const props = setup({ _tag: "DocumentRejected", problem: "fingerprint-mismatch" }, null);
  await using screen = await render(<ConnectServiceForm {...props} />);
  await screen
    .getByRole("textbox", { name: "Connect address" })
    .fill(`${RELAY}/#fp=0000000000000000`);
  await screen.getByRole("button", { name: "Save" }).click();
  await expectText(screen.getByRole("alert"), /does not match the fingerprint in the setup link/);
  expect(props.save).not.toHaveBeenCalled();
  expect(props.update).not.toHaveBeenCalled();
});

it("an identity change applies nothing: closing the question or keeping the old settings", async () => {
  using _clock = fixedClock();
  const current = withIdentityChange();
  const props = setup({ _tag: "NotPublished" }, current);
  await using screen = await render(<ConnectServiceForm {...props} />);

  const notice = screen.getByTestId("connect-identity-changed");
  await expectText(notice, /This Connect service's identity changed/);
  await expectText(notice, new RegExp(`${NEW_FP}.*instead of.*${OLD_FP}`));

  await screen.getByRole("button", { name: "Trust the new identity…" }).click();
  await expect
    .element(page.getByRole("alertdialog", { name: "Trust the new identity of Example cats?" }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Trust the new identity…" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(props.update).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Keep using the old settings" }).click();
  await vi.waitFor(() => expect(props.update).toHaveBeenCalledTimes(1));
  const kept = vi.mocked(props.update).mock.calls[0]![0];
  expect(kept.connect?.key).toBe(saved.connect?.key);
  expect(kept.connect?.document).toEqual(saved.connect?.document);
  expect(kept.connect?.identityChange?.declined).toBe(true);
  expect(props.save).not.toHaveBeenCalled();
});

it("trusting the new identity takes a second, explicit yes and starts the answers over", async () => {
  using _clock = fixedClock();
  const props = setup({ _tag: "NotPublished" }, withIdentityChange());
  await using screen = await render(<ConnectServiceForm {...props} />);
  await screen.getByRole("button", { name: "Trust the new identity…" }).click();
  await page.getByRole("button", { name: `Trust ${NEW_FP}` }).click();

  await vi.waitFor(() => expect(props.update).toHaveBeenCalledTimes(1));
  const trusted = vi.mocked(props.update).mock.calls[0]![0];
  expect(trusted.connect?.key).not.toBe(saved.connect?.key);
  expect(trusted.connect?.identityChange).toBeUndefined();
  expect(trusted.connect?.diagnostics).toBeUndefined();
  expect(trusted.connect?.recentChanges?.[0]?.kind).toBe("identity-trusted");
  expect(props.save).not.toHaveBeenCalled();
});

it("a new identity with new sign-in values goes through the restart question too", async () => {
  using _clock = fixedClock();
  const props = setup({ _tag: "NotPublished" }, withIdentityChange({ jwtTemplate: "other" }));
  await using screen = await render(<ConnectServiceForm {...props} />);
  await screen.getByRole("button", { name: "Trust the new identity…" }).click();
  await expectText(page.getByRole("alertdialog"), /the app restarts and signs you out/);
  await page.getByRole("button", { name: `Trust ${NEW_FP}` }).click();

  await expect
    .element(page.getByRole("alertdialog", { name: "Use relay.example.com for T3 Connect?" }))
    .toBeVisible();
  expect(props.update).not.toHaveBeenCalled();
  expect(props.save).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Reload and switch" }).click();
  await vi.waitFor(() => expect(props.save).toHaveBeenCalledTimes(1));
  expect(vi.mocked(props.save).mock.calls[0]![0]?.clerkJwtTemplate).toBe("other");
});

it("shows what the service offers without switching anything on, and its recent changes", async () => {
  using _clock = fixedClock();
  const current: SavedConnectService = {
    ...saved,
    connect: {
      ...saved.connect!,
      refreshProblem: "unreachable",
      recentChanges: [
        {
          at: at(0),
          kind: "offer-added",
          diagnostics: "crashReports",
          to: `${RELAY}/v1/collect/otlp`,
        },
        { at: at(-2), kind: "name", from: "Cats", to: "Example cats" },
      ],
    },
  };
  const props = setup({ _tag: "NotPublished" }, current);
  await using screen = await render(<ConnectServiceForm {...props} />);

  await expectText(
    screen.getByTestId("connect-service-identity"),
    new RegExp(`relay\\.example\\.com · signed by ${OLD_FP}`),
  );
  await expectText(
    screen.getByTestId("connect-refresh-problem"),
    /Could not refresh: the service did not answer/,
  );
  await expectText(
    screen.getByTestId("connect-offer-analytics"),
    /Send usage data to Example cats/,
  );
  await expectText(
    screen.getByTestId("connect-offer-crashReports"),
    /Not switched on by the service/,
  );
  await expect.element(screen.getByTestId("connect-offer-traces")).not.toBeInTheDocument();
  await expectText(
    screen.getByTestId("connect-recent-changes"),
    /Now offers to receive crash reports.*Off until you turn it on.*Name changed from "Cats" to "Example cats"/,
  );
});

it("a sign-in change from the service waits for a restart the person asks for", async () => {
  using _clock = fixedClock();
  const pendingDocument = {
    ...saved.connect!.document,
    signIn: { ...saved.connect!.document.signIn, jwtTemplate: "next" },
  };
  const current: SavedConnectService = {
    ...saved,
    connect: { ...saved.connect!, pending: { key: saved.connect!.key, document: pendingDocument } },
  };
  const props = setup({ _tag: "NotPublished" }, current);
  await using screen = await render(<ConnectServiceForm {...props} />);
  await screen.getByRole("button", { name: "Restart to apply…" }).click();
  await page.getByRole("button", { name: "Reload and switch" }).click();
  await vi.waitFor(() => expect(props.save).toHaveBeenCalledTimes(1));
  expect(vi.mocked(props.save).mock.calls[0]![0]?.clerkJwtTemplate).toBe("next");
});
