import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { CatPetSettingsSection } from "./CatPetSettingsSection";

/** Moves a range input the way a drag does: React hears the input event. */
function slide(element: Element, value: number) {
  const input = element as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    input,
    String(value),
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("turns the pet on and slides its size and opacity, keeping the other fields", async () => {
  using stack = new DisposableStack();
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  await using screen = await render(<CatPetSettingsSection />);
  const shown = screen.getByRole("switch", { name: "Show the pet" });
  const size = screen.getByRole("slider", { name: "Pet size" });
  const opacity = screen.getByRole("slider", { name: "Pet opacity" });
  await expect.element(size).toBeDisabled();
  await expect.element(opacity).toBeDisabled();

  // The section renders without the app stylesheet, so the switch has no size for a pointer to hit.
  shown.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(getClientSettings().catPet.enabled).toBe(true));
  await expect.element(size).toHaveAttribute("aria-valuetext", "Medium");
  await expect.element(opacity).toHaveValue("100");

  slide(size.element(), 4);
  await vi.waitFor(() => expect(getClientSettings().catPet.size).toBe("xl"));
  await expect.element(size).toHaveAttribute("aria-valuetext", "Extra large");
  slide(size.element(), 0);
  await vi.waitFor(() => expect(getClientSettings().catPet.size).toBe("xs"));

  slide(opacity.element(), 20);
  await vi.waitFor(() => expect(getClientSettings().catPet.opacity).toBe(20));
  await expect.element(screen.getByText("20%")).toBeVisible();

  screen
    .getByRole("switch", { name: "Show thread titles in the pet's bubble" })
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(getClientSettings().catPet.showTitles).toBe(false));
  expect(getClientSettings().catPet).toMatchObject({
    enabled: true,
    size: "xs",
    opacity: 20,
    petId: "meowtase",
    petPicked: false,
  });
});
