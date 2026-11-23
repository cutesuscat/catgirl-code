import { DEFAULT_CLIENT_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { environmentLabelOverridesAtom } from "../../connection/environmentLabelOverrides";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { DeviceNameRow } from "./DeviceNameRow";

const DEV = EnvironmentId.make("env-dev");
const CFH = EnvironmentId.make("env-cfh");

// Two machines that report the same name, as two accounts in one container do.
vi.mock("~/connection/catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/connection/catalog")>();
  const { Atom } = await import("effect/reactivity");
  const entry = (environmentId: string) =>
    [environmentId, { target: { environmentId, label: "research-box" }, enabled: true }] as const;
  const savedCatalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map([entry("env-dev"), entry("env-cfh")]),
  }).pipe(Atom.keepAlive);
  return { environmentCatalog: { ...original.environmentCatalog, savedCatalogValueAtom } };
});

it("names a machine on this device, and clearing the name goes back", async () => {
  using stack = new DisposableStack();
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    environmentLabelOverrides: { [CFH]: "slop cfh" },
  });
  await using screen = await render(<DeviceNameRow environmentId={DEV} />);
  const input = screen.getByRole("textbox", { name: "Name for this machine on this device" });

  await expect.element(input).toHaveAttribute("placeholder", "research-box");
  await input.fill("  slop dev ");
  await input.element().blur();

  await vi.waitFor(() =>
    expect(getClientSettings().environmentLabelOverrides).toEqual({
      [CFH]: "slop cfh",
      [DEV]: "slop dev",
    }),
  );
  expect(appAtomRegistry.get(environmentLabelOverridesAtom)[DEV]).toBe("slop dev");
  await expect.element(input).toHaveValue("slop dev");

  await input.fill("");
  await input.element().blur();

  await vi.waitFor(() =>
    expect(getClientSettings().environmentLabelOverrides).toEqual({ [CFH]: "slop cfh" }),
  );
  expect(appAtomRegistry.get(environmentLabelOverridesAtom)[DEV]).toBeUndefined();
});
