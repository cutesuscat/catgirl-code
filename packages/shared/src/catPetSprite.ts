// @effect-diagnostics globalDate:off -- Formats a reset time for the pet bubble, which runs outside any Effect runtime.
/**
 * Desktop pet sprites: reads our `pet.json` (a Codex pet with a `catgirl` block) and plain Codex
 * pets, resolves the mood to draw, and steps frames with timers only (no animation loop).
 */

const CAT_PET_STATES = [
  "idle",
  "working",
  "needs-you",
  "done",
  "error",
  "limited",
  "sleeping",
  "held",
] as const;
export type CatPetState = (typeof CAT_PET_STATES)[number];

export interface CatPetAnimation {
  readonly row: number;
  readonly frames: number;
  /** One per frame; a single value applies to every frame. */
  readonly durations: readonly number[];
  readonly stillFrame: number;
  /** Drawn faded with a "z", for a Codex pet that has no sleeping row. */
  readonly dim?: boolean;
}

export interface CatPetSpec {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly format: "catgirl" | "codex";
  readonly sheetPath: string;
  readonly cell: { readonly width: number; readonly height: number };
  readonly imageRendering: "auto" | "pixelated";
  readonly animations: Readonly<Record<CatPetState, CatPetAnimation>>;
}

const CODEX_CELL = { width: 192, height: 208 } as const;
const CODEX_COLUMNS = 8;
const CODEX_ROWS = 9;

/** Codex's rows (community-documented): idle, run right, run left, wave, jump, failed, waiting, running, review. */
const CODEX_ANIMATIONS: Readonly<Record<CatPetState, CatPetAnimation>> = {
  idle: { row: 0, frames: 6, durations: [280, 110, 110, 140, 140, 320], stillFrame: 0 },
  working: { row: 7, frames: 6, durations: [120, 120, 120, 120, 120, 220], stillFrame: 0 },
  "needs-you": { row: 6, frames: 6, durations: [150, 150, 150, 150, 150, 260], stillFrame: 0 },
  done: { row: 8, frames: 6, durations: [150, 150, 150, 150, 150, 280], stillFrame: 0 },
  error: { row: 5, frames: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240], stillFrame: 0 },
  // No such rows in Codex: limited waits, sleeping is a faded idle, held is the first jump frame.
  limited: { row: 6, frames: 6, durations: [300, 300, 300, 300, 300, 520], stillFrame: 0 },
  sleeping: { row: 0, frames: 1, durations: [1000], stillFrame: 0, dim: true },
  held: { row: 4, frames: 1, durations: [1000], stillFrame: 0 },
};

/** For our own format, when a pet leaves a state out. */
const FALLBACK: Readonly<Record<CatPetState, CatPetState | null>> = {
  idle: null,
  working: "idle",
  "needs-you": "idle",
  done: "idle",
  error: "idle",
  limited: "needs-you",
  sleeping: "idle",
  held: "idle",
};

export const CAT_PET_MAX_BYTES = 20 * 1024 * 1024;

export type CatPetParseResult =
  | { readonly ok: true; readonly spec: CatPetSpec }
  | { readonly ok: false; readonly reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, fallback: string, max = 200) =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : fallback;

/** A path inside the pet's folder: relative, no `..`, an image. */
export function isSafeCatPetPath(path: string): boolean {
  if (path === "" || path.length > 200) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-z]:/i.test(path)) return false;
  if (path.split(/[\\/]/).some((part) => part === ".." || part === "")) return false;
  return /\.(webp|png)$/i.test(path);
}

const positiveInt = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max ? value : null;

function parseAnimation(raw: unknown): CatPetAnimation | null {
  if (!isRecord(raw)) return null;
  const row =
    typeof raw.row === "number" && Number.isInteger(raw.row) && raw.row >= 0 ? raw.row : null;
  const frames = positiveInt(raw.frames, 64);
  if (row === null || frames === null) return null;
  const durations = Array.isArray(raw.durations)
    ? raw.durations.filter((d): d is number => typeof d === "number" && d >= 16 && d <= 60_000)
    : [];
  const still = typeof raw.stillFrame === "number" ? Math.trunc(raw.stillFrame) : 0;
  return {
    row,
    frames,
    durations: durations.length > 0 ? durations.slice(0, frames) : [200],
    stillFrame: still >= 0 && still < frames ? still : 0,
  };
}

/**
 * Reads a `pet.json`. One without a `catgirl` block is a Codex pet: its sheet must be the
 * 8x9 atlas of 192x208 cells. `folderId` names the pet when the file doesn't.
 */
export function parseCatPetManifest(raw: unknown, folderId: string): CatPetParseResult {
  if (!isRecord(raw)) return { ok: false, reason: "pet.json is not an object" };
  const id = text(raw.id, folderId, 128);
  const displayName = text(raw.displayName, folderId, 80);
  const description = text(raw.description, "");
  const catgirl = raw.catgirl;
  if (catgirl === undefined) {
    const sheetPath = text(raw.spritesheetPath, "spritesheet.webp");
    if (!isSafeCatPetPath(sheetPath)) return { ok: false, reason: "unsafe spritesheet path" };
    return {
      ok: true,
      spec: {
        id,
        displayName,
        description,
        format: "codex",
        sheetPath,
        cell: CODEX_CELL,
        imageRendering: "auto",
        animations: CODEX_ANIMATIONS,
      },
    };
  }
  if (!isRecord(catgirl)) return { ok: false, reason: "catgirl block is not an object" };
  const sheetPath = text(catgirl.sheetPath, "");
  if (!isSafeCatPetPath(sheetPath)) return { ok: false, reason: "unsafe or missing sheet path" };
  const cellRaw = isRecord(catgirl.cell) ? catgirl.cell : {};
  const width = positiveInt(cellRaw.width, 1024) ?? CODEX_CELL.width;
  const height = positiveInt(cellRaw.height, 1024) ?? CODEX_CELL.height;
  const animationsRaw = isRecord(catgirl.animations) ? catgirl.animations : {};
  const parsed = new Map<CatPetState, CatPetAnimation>();
  for (const state of CAT_PET_STATES) {
    const animation = parseAnimation(animationsRaw[state]);
    if (animation !== null) parsed.set(state, animation);
  }
  if (!parsed.has("idle")) return { ok: false, reason: "no idle animation" };
  const resolve = (state: CatPetState): CatPetAnimation => {
    let current: CatPetState | null = state;
    while (current !== null) {
      const found = parsed.get(current);
      if (found !== undefined)
        return state === "sleeping" && current !== state ? { ...found, dim: true } : found;
      current = FALLBACK[current];
    }
    return parsed.get("idle")!;
  };
  const animations = Object.fromEntries(CAT_PET_STATES.map((s) => [s, resolve(s)])) as Record<
    CatPetState,
    CatPetAnimation
  >;
  return {
    ok: true,
    spec: {
      id,
      displayName,
      description,
      format: "catgirl",
      sheetPath,
      cell: { width, height },
      imageRendering: catgirl.imageRendering === "pixelated" ? "pixelated" : "auto",
      animations,
    },
  };
}

/** Whether the decoded sheet fits the pet: a whole number of cells, holding every row used. */
export function checkCatPetSheet(
  spec: CatPetSpec,
  size: { readonly width: number; readonly height: number },
): string | null {
  const { width, height } = spec.cell;
  if (size.width <= 0 || size.height <= 0) return "the sheet is empty";
  if (size.width % width !== 0 || size.height % height !== 0)
    return `the sheet is ${size.width}x${size.height}, not a multiple of ${width}x${height} cells`;
  if (
    spec.format === "codex" &&
    (size.width !== width * CODEX_COLUMNS || size.height !== height * CODEX_ROWS)
  )
    return `a Codex sheet must be ${width * CODEX_COLUMNS}x${height * CODEX_ROWS}`;
  const columns = size.width / width;
  const rows = size.height / height;
  for (const state of CAT_PET_STATES) {
    const animation = spec.animations[state];
    if (animation.row >= rows || animation.frames > columns)
      return `the ${state} animation runs past the sheet`;
  }
  return null;
}

export type CatPetBaseMood = "needs-you" | "limited" | "error" | "working" | "idle" | "sleeping";

export const CAT_PET_SLEEP_AFTER_MS = 10 * 60 * 1000;

/**
 * What to draw now: held > needs-you > limited > error > done > working > idle > sleeping.
 * `done` shows while a celebration plays. With the app window closed the data is stale, so she sleeps.
 */
export function resolveCatPetState(input: {
  readonly mood: CatPetBaseMood;
  readonly held: boolean;
  readonly celebrating: boolean;
  readonly appClosed: boolean;
  readonly idleSince: number | null;
  readonly now: number;
}): CatPetState {
  if (input.held) return "held";
  if (input.appClosed) return "sleeping";
  if (input.mood === "needs-you" || input.mood === "limited" || input.mood === "error")
    return input.mood;
  if (input.celebrating) return "done";
  if (
    input.mood === "idle" &&
    input.idleSince !== null &&
    input.now - input.idleSince >= CAT_PET_SLEEP_AFTER_MS
  )
    return "sleeping";
  return input.mood;
}

/** Shown under "only while agents are busy". */
export function isCatPetBusy(state: CatPetState): boolean {
  return state !== "idle" && state !== "sleeping";
}

export const CAT_PET_DONE_LOOPS = 3;

function catPetFrameDuration(animation: CatPetAnimation, frame: number): number {
  return animation.durations[frame] ?? animation.durations.at(-1) ?? 200;
}

/** How long one pass of an animation takes. */
export function catPetLoopDuration(animation: CatPetAnimation): number {
  let total = 0;
  for (let frame = 0; frame < animation.frames; frame++)
    total += catPetFrameDuration(animation, frame);
  return total;
}

export interface CatPetTimers {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

/**
 * Steps one animation with a timeout per frame. Reduced motion draws the still frame once.
 * `loops` plays a set number of passes, then calls `onEnd`; otherwise it loops until stopped.
 */
export class CatPetPlayer {
  private handle: unknown = null;
  private generation = 0;
  private readonly timers: CatPetTimers;
  private readonly draw: (animation: CatPetAnimation, frame: number) => void;

  constructor(timers: CatPetTimers, draw: (animation: CatPetAnimation, frame: number) => void) {
    this.timers = timers;
    this.draw = draw;
  }

  play(
    animation: CatPetAnimation,
    options: { readonly reduced: boolean; readonly loops?: number; readonly onEnd?: () => void },
  ): void {
    this.stop();
    const generation = this.generation;
    if (options.reduced || animation.frames <= 1) {
      this.draw(animation, options.reduced ? animation.stillFrame : 0);
      if (options.loops !== undefined && options.onEnd) {
        const onEnd = options.onEnd;
        this.schedule(generation, catPetLoopDuration(animation) * options.loops, onEnd);
      }
      return;
    }
    let frame = 0;
    let pass = 0;
    const step = () => {
      this.draw(animation, frame);
      this.schedule(generation, catPetFrameDuration(animation, frame), () => {
        frame += 1;
        if (frame >= animation.frames) {
          frame = 0;
          pass += 1;
          if (options.loops !== undefined && pass >= options.loops) {
            options.onEnd?.();
            return;
          }
        }
        step();
      });
    };
    step();
  }

  stop(): void {
    this.generation += 1;
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  private schedule(generation: number, ms: number, callback: () => void) {
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      if (generation === this.generation) callback();
    }, ms);
  }
}

/** Pixel art stays crisp at whole multiples of its 1x size; vector pets use the usual sizes. */
export function catPetDisplayWidth(
  size: "small" | "medium" | "large",
  imageRendering: CatPetSpec["imageRendering"],
): number {
  if (imageRendering === "pixelated") return size === "small" ? 96 : size === "medium" ? 192 : 288;
  return size === "small" ? 96 : size === "medium" ? 128 : 192;
}

export interface CatPetSummaryInput {
  readonly working: number;
  readonly needsYou: number;
  readonly limited: number;
  readonly failed: number;
  readonly unreadDone: number;
  readonly limit: { readonly label: string; readonly resetsAt: string | null } | null;
  readonly machines: { readonly offline: readonly string[] };
}

export const CAT_PET_KIND_LABELS = {
  approval: "Approve",
  input: "Answer",
  request: "Guest",
  limited: "Limited",
  failed: "Failed",
  working: "Working",
  done: "Done",
} as const;

/** "18:40", or the day too when the reset is not today. */
function formatCatPetResetTime(iso: string, now: Date, locale?: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === now.toDateString()
    ? time
    : `${at.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
}

/** The bubble's first line: "2 working · 1 needs you · Claude limit resets 18:40". */
export function catPetHeadline(
  summary: CatPetSummaryInput | null,
  options: { readonly appClosed: boolean; readonly now: Date; readonly locale?: string },
): string {
  if (options.appClosed) return "The Catgirl Code window is closed";
  if (summary === null) return "Waiting for Catgirl Code…";
  const parts: string[] = [];
  if (summary.needsYou > 0)
    parts.push(`${summary.needsYou} need${summary.needsYou === 1 ? "s" : ""} you`);
  if (summary.working > 0) parts.push(`${summary.working} working`);
  if (summary.limit !== null) {
    const reset =
      summary.limit.resetsAt === null
        ? null
        : formatCatPetResetTime(summary.limit.resetsAt, options.now, options.locale);
    parts.push(
      reset === null
        ? `${summary.limit.label} limit reached`
        : `${summary.limit.label} limit resets ${reset}`,
    );
  } else if (summary.limited > 0) {
    parts.push(`${summary.limited} hit a usage limit`);
  }
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.unreadDone > 0) parts.push(`${summary.unreadDone} done`);
  return parts.length === 0 ? "All quiet" : parts.join(" · ");
}

export function catPetOfflineLine(summary: CatPetSummaryInput | null): string | null {
  const offline = summary?.machines.offline ?? [];
  if (offline.length === 0) return null;
  return offline.length === 1 ? `${offline[0]} is offline` : `Offline: ${offline.join(", ")}`;
}
