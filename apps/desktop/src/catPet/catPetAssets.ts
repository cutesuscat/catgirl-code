import { BUILT_IN_CAT_PET_IDS } from "@t3tools/contracts";
import {
  CAT_PET_MAX_BYTES,
  checkCatPetSheet,
  parseCatPetManifest,
  type CatPetSpec,
} from "@t3tools/shared/catPetSprite";

/** A pet ready to draw: its spec and its sheet as a data URL (the pet page loads nothing else). */
export interface LoadedCatPet {
  readonly id: string;
  readonly source: "built-in" | "catcode" | "codex";
  readonly spec: CatPetSpec;
  readonly sheetUrl: string;
  readonly sheetSize: { readonly width: number; readonly height: number };
}

export interface CatPetListing {
  readonly id: string;
  readonly source: LoadedCatPet["source"];
  readonly displayName: string;
}

/** File access, injected so the loader is testable and never runs code from a pet folder. */
export interface CatPetFiles {
  readonly readFile: (path: string, maxBytes: number) => Promise<Uint8Array | null>;
  readonly listDirectories: (path: string) => Promise<readonly string[]>;
  readonly join: (...parts: string[]) => string;
}

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_CUSTOM_PETS = 64;

const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** The pixel size of a PNG or WebP from its header, without decoding it. */
export function readImageSize(
  bytes: Uint8Array,
): { readonly type: "png" | "webp"; readonly width: number; readonly height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") {
    if (ascii(bytes, 12, 4) !== "IHDR") return null;
    return { type: "png", width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X") {
      return { type: "webp", width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        type: "webp",
        width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
      };
    }
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export type CatPetLoadResult =
  | { readonly ok: true; readonly pet: LoadedCatPet }
  | { readonly ok: false; readonly reason: string };

/** Loads one pet folder: JSON and one image only, size-limited and checked against its cells. */
export async function loadCatPetFolder(
  files: CatPetFiles,
  folder: string,
  folderName: string,
  source: LoadedCatPet["source"],
): Promise<CatPetLoadResult> {
  const manifestBytes = await files.readFile(files.join(folder, "pet.json"), MAX_MANIFEST_BYTES);
  if (manifestBytes === null) return { ok: false, reason: "no readable pet.json" };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return { ok: false, reason: "pet.json is not JSON" };
  }
  const parsed = parseCatPetManifest(raw, folderName);
  if (!parsed.ok) return parsed;
  const sheet = await files.readFile(files.join(folder, parsed.spec.sheetPath), CAT_PET_MAX_BYTES);
  if (sheet === null) return { ok: false, reason: "the sprite sheet is missing or over 20 MiB" };
  const size = readImageSize(sheet);
  if (size === null) return { ok: false, reason: "the sprite sheet is not a PNG or WebP" };
  const problem = checkCatPetSheet(parsed.spec, size);
  if (problem !== null) return { ok: false, reason: problem };
  const id = source === "built-in" ? parsed.spec.id : `${source}:${folderName}`;
  return {
    ok: true,
    pet: {
      id,
      source,
      spec: { ...parsed.spec, id },
      sheetUrl: `data:image/${size.type};base64,${toBase64(sheet)}`,
      sheetSize: { width: size.width, height: size.height },
    },
  };
}

/** The pets on offer: built-in ones, then each custom folder that loads. Broken folders are skipped. */
export async function listCatPets(input: {
  readonly files: CatPetFiles;
  /** The web bundle's `pets/` folder: files in a packaged app, the dev server in development. */
  readonly builtIn: { readonly files: CatPetFiles; readonly root: string };
  readonly customRoots: ReadonlyArray<{
    readonly path: string;
    readonly source: "catcode" | "codex";
  }>;
  readonly onSkip?: (folder: string, reason: string) => void;
}): Promise<readonly LoadedCatPet[]> {
  const pets: LoadedCatPet[] = [];
  for (const id of BUILT_IN_CAT_PET_IDS) {
    const { files, root } = input.builtIn;
    const result = await loadCatPetFolder(files, files.join(root, id), id, "built-in");
    if (result.ok) pets.push(result.pet);
    else input.onSkip?.(id, result.reason);
  }
  let custom = 0;
  for (const root of input.customRoots) {
    for (const name of await input.files.listDirectories(root.path)) {
      if (custom >= MAX_CUSTOM_PETS) return pets;
      if (name.startsWith(".")) continue;
      const folder = input.files.join(root.path, name);
      const result = await loadCatPetFolder(input.files, folder, name, root.source);
      if (!result.ok) {
        input.onSkip?.(folder, result.reason);
        continue;
      }
      if (pets.some((pet) => pet.id === result.pet.id)) continue;
      pets.push(result.pet);
      custom += 1;
    }
  }
  return pets;
}

/** Where a pet id lives: a built-in name, or `catcode:<folder>` / `codex:<folder>`. */
export function catPetFolderOf(
  id: string,
  roots: {
    readonly builtIn: string;
    readonly custom: ReadonlyArray<{ readonly path: string; readonly source: "catcode" | "codex" }>;
  },
): {
  readonly root: string;
  readonly name: string;
  readonly source: LoadedCatPet["source"];
} | null {
  if ((BUILT_IN_CAT_PET_IDS as readonly string[]).includes(id)) {
    return { root: roots.builtIn, name: id, source: "built-in" };
  }
  const match = /^(catcode|codex):([^/\\]+)$/.exec(id);
  const name = match?.[2];
  if (match === null || name === undefined || name === "." || name === "..") return null;
  const root = roots.custom.find((candidate) => candidate.source === match[1]);
  return root === undefined ? null : { root: root.path, name, source: root.source };
}
