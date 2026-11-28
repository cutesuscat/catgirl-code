import { describe, expect, it } from "vite-plus/test";

import {
  catPetFolderOf,
  listCatPets,
  loadCatPetFolder,
  readImageSize,
  type CatPetFiles,
} from "./catPetAssets.ts";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function webpLossless(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([...new TextEncoder().encode("RIFF")], 0);
  bytes.set([...new TextEncoder().encode("WEBPVP8L")], 8);
  bytes[20] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  new DataView(bytes.buffer).setUint32(21, bits, true);
  return bytes;
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function memoryFiles(entries: Record<string, Uint8Array>): CatPetFiles {
  return {
    join: (...parts) => parts.join("/"),
    readFile: async (path, maxBytes) => {
      const bytes = entries[path];
      return bytes === undefined || bytes.byteLength > maxBytes ? null : bytes;
    },
    listDirectories: async (path) => [
      ...new Set(
        Object.keys(entries)
          .filter((key) => key.startsWith(`${path}/`))
          .map((key) => key.slice(path.length + 1).split("/")[0]!),
      ),
    ],
  };
}

const ours = (sheetPath = "sheet.webp") => ({
  id: "marmalade",
  displayName: "Marmalade",
  catgirl: {
    sheetPath,
    cell: { width: 192, height: 208 },
    animations: {
      idle: { row: 0, frames: 6, durations: [200] },
      held: { row: 7, frames: 8, durations: [140] },
    },
  },
});

describe("readImageSize", () => {
  it("reads PNG and lossless WebP headers, and refuses anything else", () => {
    expect(readImageSize(png(1536, 1872))).toEqual({ type: "png", width: 1536, height: 1872 });
    expect(readImageSize(webpLossless(1536, 1664))).toEqual({
      type: "webp",
      width: 1536,
      height: 1664,
    });
    expect(readImageSize(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(readImageSize(new Uint8Array(4))).toBeNull();
  });
});

describe("loadCatPetFolder", () => {
  it("loads our pet as a data URL", async () => {
    const files = memoryFiles({
      "pets/m/pet.json": json(ours()),
      "pets/m/sheet.webp": webpLossless(1536, 1664),
    });
    const result = await loadCatPetFolder(files, "pets/m", "m", "built-in");
    expect(result.ok && result.pet.id).toBe("marmalade");
    expect(result.ok && result.pet.sheetUrl.startsWith("data:image/webp;base64,")).toBe(true);
  });

  it("loads a Codex pet and names it by source and folder", async () => {
    const files = memoryFiles({
      "codex/dewey/pet.json": json({ displayName: "Dewey", spritesheetPath: "spritesheet.png" }),
      "codex/dewey/spritesheet.png": png(1536, 1872),
    });
    const result = await loadCatPetFolder(files, "codex/dewey", "dewey", "codex");
    expect(result.ok && result.pet.id).toBe("codex:dewey");
    expect(result.ok && result.pet.spec.format).toBe("codex");
  });

  it("rejects bad pets with a reason", async () => {
    const cases: Array<[Record<string, Uint8Array>, RegExp]> = [
      [{}, /no readable pet.json/],
      [{ "p/pet.json": new TextEncoder().encode("{nope") }, /not JSON/],
      [{ "p/pet.json": json(ours()) }, /missing or over 20 MiB/],
      [{ "p/pet.json": json(ours()), "p/sheet.webp": new Uint8Array(40) }, /not a PNG or WebP/],
      [{ "p/pet.json": json(ours()), "p/sheet.webp": webpLossless(1500, 1664) }, /multiple/],
      [{ "p/pet.json": json(ours("../../x.webp")) }, /unsafe/],
      [{ "p/pet.json": json({}), "p/spritesheet.webp": webpLossless(1536, 1664) }, /Codex sheet/],
      [{ "p/pet.json": new Uint8Array(70 * 1024) }, /no readable pet.json/],
    ];
    for (const [entries, reason] of cases) {
      const result = await loadCatPetFolder(memoryFiles(entries), "p", "p", "catcode");
      expect(result.ok ? "loaded" : result.reason).toMatch(reason);
    }
  });
});

describe("listCatPets", () => {
  it("lists built-in pets, then custom folders that load, skipping broken ones", async () => {
    const builtIn = memoryFiles({
      "pets/marmalade/pet.json": json(ours()),
      "pets/marmalade/sheet.webp": webpLossless(1536, 1664),
    });
    const custom = memoryFiles({
      "home/.codex/pets/dewey/pet.json": json({ displayName: "Dewey" }),
      "home/.codex/pets/dewey/spritesheet.webp": webpLossless(1536, 1872),
      "home/.codex/pets/broken/pet.json": json({ displayName: "Broken" }),
    });
    const skipped: string[] = [];
    const pets = await listCatPets({
      files: custom,
      builtIn: { files: builtIn, root: "pets" },
      customRoots: [{ path: "home/.codex/pets", source: "codex" }],
      onSkip: (folder) => skipped.push(folder),
    });
    expect(pets.map((pet) => pet.id)).toEqual(["marmalade", "codex:dewey"]);
    expect(skipped).toContain("home/.codex/pets/broken");
    expect(skipped).toContain("clementine");
  });
});

describe("catPetFolderOf", () => {
  const roots = {
    builtIn: "pets",
    custom: [{ path: "/h/.codex/pets", source: "codex" as const }],
  };
  it("maps ids to folders and refuses escapes", () => {
    expect(catPetFolderOf("meowtase", roots)).toEqual({
      root: "pets",
      name: "meowtase",
      source: "built-in",
    });
    expect(catPetFolderOf("codex:dewey", roots)).toEqual({
      root: "/h/.codex/pets",
      name: "dewey",
      source: "codex",
    });
    expect(catPetFolderOf("catcode:x", roots)).toBeNull();
    expect(catPetFolderOf("codex:..", roots)).toBeNull();
    expect(catPetFolderOf("codex:a/b", roots)).toBeNull();
    expect(catPetFolderOf("unknown", roots)).toBeNull();
  });
});
