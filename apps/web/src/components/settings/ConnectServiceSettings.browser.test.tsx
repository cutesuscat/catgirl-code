import "~/index.css";

import type { ConnectServiceSettings as SavedConnectService } from "@t3tools/contracts";
import type { ConnectServiceCheck } from "@t3tools/shared/connectService";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ConnectServiceForm, type ConnectServiceFormProps } from "./ConnectServiceSettings";

const builtIn = {
  source: "built-in",
  relayUrl: "https://relay.built-in.test",
  clerkPublishableKey: `pk_live_${btoa("clerk.built-in.test$")}`,
  clerkJwtTemplate: "t3-relay",
  clerkCliOAuthClientId: "built-in-client",
} as const;
const discovered: SavedConnectService = {
  relayUrl: "https://relay.example.test",
  clerkPublishableKey: `pk_live_${btoa("clerk.example.test$")}`,
  clerkJwtTemplate: "t3-relay",
  clerkCliOAuthClientId: null,
  source: "discovered",
};

function setup(check: ConnectServiceCheck, overrides: Partial<ConnectServiceFormProps> = {}) {
  const calls: string[] = [];
  const props: ConnectServiceFormProps = {
    applied: builtIn,
    hasBuiltIn: true,
    desktop: false,
    signInWorksHere: true,
    check: vi.fn(async () => check),
    save: vi.fn(async () => void calls.push("save")),
    leave: vi.fn(async () => void calls.push("leave")),
    current: null,
    update: vi.fn(async () => true),
    ...overrides,
  };
  return { props, calls };
}

it("checks a typed address, asks before reloading, then leaves the old service and saves", async () => {
  const { props, calls } = setup({ _tag: "Ready", settings: discovered });
  await using screen = await render(<ConnectServiceForm {...props} />);

  await expect
    .element(screen.getByTestId("connect-service-source"))
    .toHaveTextContent("Using relay.built-in.test. Built into this app.");
  await screen.getByRole("textbox", { name: "Connect address" }).fill("https://relay.example.test");
  await screen.getByRole("button", { name: "Save" }).click();

  expect(props.check).toHaveBeenCalledWith({
    relayUrl: "https://relay.example.test",
    clerkPublishableKey: "",
    clerkJwtTemplate: "",
    clerkCliOAuthClientId: "",
  });
  await expect
    .element(page.getByRole("alertdialog", { name: "Use relay.example.test for T3 Connect?" }))
    .toBeVisible();
  expect(calls).toEqual([]);

  await page.getByRole("button", { name: "Reload and switch" }).click();
  await vi.waitFor(() => expect(calls).toEqual(["leave", "save"]));
  expect(props.save).toHaveBeenCalledWith(discovered);
});

it("opens the sign-in values when the relay publishes none, and saves nothing", async () => {
  const { props, calls } = setup({ _tag: "NotPublished" });
  await using screen = await render(<ConnectServiceForm {...props} />);

  // Not a URL to the browser either: the form's own check must still be the one that answers.
  await screen.getByRole("textbox", { name: "Connect address" }).fill("relay.example.test");
  await screen.getByRole("button", { name: "Save" }).click();

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "This service does not publish its sign-in values. Enter them under Advanced.",
    );
  await expect.element(screen.getByRole("textbox", { name: "Sign-in key" })).toBeVisible();
  expect(calls).toEqual([]);
});

it("goes back to the built-in service from a saved one", async () => {
  const { props, calls } = setup(
    { _tag: "NotPublished" },
    { applied: { ...discovered, source: "manual" }, desktop: true },
  );
  await using screen = await render(<ConnectServiceForm {...props} />);

  await expect
    .element(screen.getByTestId("connect-service-source"))
    .toHaveTextContent("Using relay.example.test. Sign-in values entered on this device.");
  await screen.getByRole("button", { name: "Reset to built-in" }).click();
  await page.getByRole("button", { name: "Restart and switch" }).click();

  await vi.waitFor(() => expect(calls).toEqual(["leave", "save"]));
  expect(props.save).toHaveBeenCalledWith(null);
});
