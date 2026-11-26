import "~/index.css";

import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { ConnectIdentity, ConnectIdentityInline } from "./ConnectIdentityEmoji";

it("shows eight emoji with their names, then the hex, even when an emoji repeats", async () => {
  await using screen = await render(<ConnectIdentity fingerprint="0000 0000 0000 0000" />);
  const cells = screen.getByRole("list", { name: "Identity" }).getByRole("listitem").elements();
  expect(cells.map((cell) => cell.textContent)).toEqual(Array.from({ length: 8 }, () => "🐈Cat"));
  await expect
    .element(screen.getByTestId("connect-fingerprint"))
    .toHaveTextContent("0000 0000 0000 0000");
});

it("names the emoji for a screen reader inside a sentence", async () => {
  await using screen = await render(<ConnectIdentityInline fingerprint="8167 be98 3fda c935" />);
  await expect
    .element(
      screen.getByRole("img", {
        name: "Hat, Fire, Smiley, Folder, Hourglass, Horse, Pin, Corn",
      }),
    )
    .toHaveTextContent("🎩🔥😀📁⌛🐎📌🌽");
});

it("shows only the hex for something that is not a fingerprint", async () => {
  await using screen = await render(<ConnectIdentity fingerprint="unknown" />);
  await expect.element(screen.getByRole("list", { name: "Identity" })).not.toBeInTheDocument();
  await expect.element(screen.getByTestId("connect-fingerprint")).toHaveTextContent("unknown");
});
