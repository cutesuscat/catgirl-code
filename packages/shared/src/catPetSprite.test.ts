// @effect-diagnostics globalTimers:off -- The player takes plain timers; these tests drive them with fake ones.
import { describe, expect, it, vi } from "vite-plus/test";

import {
  CAT_PET_SLEEP_AFTER_MS,
  CatPetPlayer,
  catPetDisplayWidth,
  checkCatPetSheet,
  isCatPetBusy,
  isSafeCatPetPath,
  parseCatPetManifest,
  resolveCatPetState,
  type CatPetAnimation,
  type CatPetSpec,
} from "./catPetSprite.ts";

const ours = {
  id: "marmalade",
  displayName: "Marmalade",
  description: "Gingham.",
  catgirl: {
    version: 1,
    sheetPath: "sheet.webp",
    cell: { width: 192, height: 208 },
    imageRendering: "auto",
    animations: {
      idle: { row: 0, frames: 6, durations: [900, 130, 500, 500, 260, 500], stillFrame: 0 },
      working: { row: 1, frames: 6, durations: [120] },
      "needs-you": { row: 2, frames: 6, durations: [140] },
      done: { row: 3, frames: 6, durations: [130] },
      error: { row: 4, frames: 8, durations: [140] },
      limited: { row: 5, frames: 6, durations: [700] },
      sleeping: { row: 6, frames: 6, durations: [600] },
      held: { row: 7, frames: 8, durations: [140] },
    },
  },
};

const spec = (raw: unknown, id = "x"): CatPetSpec => {
  const result = parseCatPetManifest(raw, id);
  if (!result.ok) throw new Error(result.reason);
  return result.spec;
};

describe("parseCatPetManifest", () => {
  it("reads our format with every state", () => {
    const pet = spec(ours);
    expect(pet.format).toBe("catgirl");
    expect(pet.animations.held).toMatchObject({ row: 7, frames: 8 });
    expect(pet.animations.idle.durations).toHaveLength(6);
  });

  it("reads a Codex pet.json as the 8x9 atlas, mapping the states Codex lacks", () => {
    const pet = spec(
      { id: "dewey", displayName: "Dewey", spritesheetPath: "spritesheet.webp" },
      "dewey",
    );
    expect(pet.format).toBe("codex");
    expect(pet.animations.working.row).toBe(7);
    expect(pet.animations["needs-you"].row).toBe(6);
    expect(pet.animations.done.row).toBe(8);
    expect(pet.animations.limited.row).toBe(6);
    expect(pet.animations.sleeping).toMatchObject({ row: 0, frames: 1, dim: true });
    expect(pet.animations.held).toMatchObject({ row: 4, frames: 1 });
  });

  it("names a Codex pet after its folder when the fields are missing", () => {
    expect(spec({}, "folder-name")).toMatchObject({
      id: "folder-name",
      displayName: "folder-name",
      sheetPath: "spritesheet.webp",
    });
  });

  it("falls back for the states our format leaves out", () => {
    const { limited: _l, sleeping: _s, held: _h, ...rest } = ours.catgirl.animations;
    const pet = spec({ ...ours, catgirl: { ...ours.catgirl, animations: rest } });
    expect(pet.animations.limited.row).toBe(2);
    expect(pet.animations.sleeping).toMatchObject({ row: 0, dim: true });
    expect(pet.animations.held.row).toBe(0);
  });

  it("rejects bad files", () => {
    expect(parseCatPetManifest(null, "x")).toMatchObject({ ok: false });
    expect(parseCatPetManifest([1, 2], "x")).toMatchObject({ ok: false });
    expect(parseCatPetManifest({ spritesheetPath: "../../etc/passwd.png" }, "x")).toMatchObject({
      ok: false,
    });
    expect(parseCatPetManifest({ spritesheetPath: "/abs/sheet.png" }, "x")).toMatchObject({
      ok: false,
    });
    expect(parseCatPetManifest({ spritesheetPath: "evil.js" }, "x")).toMatchObject({ ok: false });
    expect(parseCatPetManifest({ catgirl: "nope" }, "x")).toMatchObject({ ok: false });
    expect(
      parseCatPetManifest({ catgirl: { sheetPath: "s.webp", animations: {} } }, "x"),
    ).toMatchObject({ ok: false, reason: "no idle animation" });
  });

  it("ignores junk durations and out-of-range still frames", () => {
    const pet = spec({
      catgirl: {
        sheetPath: "s.png",
        animations: { idle: { row: 0, frames: 2, durations: ["a", -5, 1e9], stillFrame: 9 } },
      },
    });
    expect(pet.animations.idle.durations).toEqual([200]);
    expect(pet.animations.idle.stillFrame).toBe(0);
  });
});

describe("isSafeCatPetPath", () => {
  it("accepts images inside the folder only", () => {
    expect(isSafeCatPetPath("sheet.webp")).toBe(true);
    expect(isSafeCatPetPath("art/sheet.PNG")).toBe(true);
    expect(isSafeCatPetPath("C:\\x.png")).toBe(false);
    expect(isSafeCatPetPath("a/../../b.png")).toBe(false);
    expect(isSafeCatPetPath("sheet.svg")).toBe(false);
  });
});

describe("checkCatPetSheet", () => {
  it("requires whole cells covering every row used, and the exact atlas for Codex", () => {
    const pet = spec(ours);
    expect(checkCatPetSheet(pet, { width: 1536, height: 1664 })).toBeNull();
    expect(checkCatPetSheet(pet, { width: 1500, height: 1664 })).toMatch(/multiple/);
    expect(checkCatPetSheet(pet, { width: 1536, height: 208 * 7 })).toMatch(/held/);
    const codex = spec({});
    expect(checkCatPetSheet(codex, { width: 1536, height: 1872 })).toBeNull();
    expect(checkCatPetSheet(codex, { width: 1536, height: 1664 })).toMatch(/Codex/);
    expect(checkCatPetSheet(codex, { width: 0, height: 0 })).toMatch(/empty/);
  });
});

describe("resolveCatPetState", () => {
  const base = { held: false, celebrating: false, appClosed: false, idleSince: null, now: 0 };
  it("orders held > needs-you > limited > error > done > working > idle", () => {
    expect(resolveCatPetState({ ...base, mood: "needs-you", held: true })).toBe("held");
    expect(resolveCatPetState({ ...base, mood: "needs-you", celebrating: true })).toBe("needs-you");
    expect(resolveCatPetState({ ...base, mood: "limited", celebrating: true })).toBe("limited");
    expect(resolveCatPetState({ ...base, mood: "error", celebrating: true })).toBe("error");
    expect(resolveCatPetState({ ...base, mood: "working", celebrating: true })).toBe("done");
    expect(resolveCatPetState({ ...base, mood: "working" })).toBe("working");
    expect(resolveCatPetState({ ...base, mood: "idle" })).toBe("idle");
  });

  it("sleeps after ten idle minutes, or while the app window is closed", () => {
    const idle = { ...base, mood: "idle" as const, idleSince: 1_000 };
    expect(resolveCatPetState({ ...idle, now: 1_000 + CAT_PET_SLEEP_AFTER_MS - 1 })).toBe("idle");
    expect(resolveCatPetState({ ...idle, now: 1_000 + CAT_PET_SLEEP_AFTER_MS })).toBe("sleeping");
    expect(resolveCatPetState({ ...base, mood: "working", appClosed: true })).toBe("sleeping");
    expect(isCatPetBusy("done")).toBe(true);
    expect(isCatPetBusy("sleeping")).toBe(false);
  });
});

describe("CatPetPlayer", () => {
  const animation: CatPetAnimation = {
    row: 3,
    frames: 3,
    durations: [100, 200, 300],
    stillFrame: 1,
  };

  it("steps frames on their own durations, plays a set number of passes, then ends", () => {
    vi.useFakeTimers();
    const frames: number[] = [];
    const onEnd = vi.fn();
    const player = new CatPetPlayer(
      { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (h) => clearTimeout(h as never) },
      (_animation, frame) => frames.push(frame),
    );
    player.play(animation, { reduced: false, loops: 2, onEnd });
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1]);
    vi.advanceTimersByTime(200 + 300 + 600);
    expect(frames).toEqual([0, 1, 2, 0, 1, 2]);
    expect(onEnd).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(frames).toHaveLength(6);
    vi.useRealTimers();
  });

  it("draws the still frame once with reduced motion, and stops cleanly", () => {
    vi.useFakeTimers();
    const frames: number[] = [];
    const player = new CatPetPlayer(
      { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (h) => clearTimeout(h as never) },
      (_animation, frame) => frames.push(frame),
    );
    player.play(animation, { reduced: true });
    vi.advanceTimersByTime(5_000);
    expect(frames).toEqual([1]);
    player.play(animation, { reduced: false });
    player.stop();
    vi.advanceTimersByTime(5_000);
    expect(frames).toEqual([1, 0]);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("catPetDisplayWidth", () => {
  it("keeps pixel pets at whole multiples of 96", () => {
    for (const size of ["small", "medium", "large"] as const) {
      expect(catPetDisplayWidth(size, "pixelated") % 96).toBe(0);
    }
    expect(catPetDisplayWidth("medium", "auto")).toBe(128);
  });
});
