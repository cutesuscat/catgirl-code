import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** The pets bundled with the app, under `apps/web/public/pets/<id>/`. */
export const BUILT_IN_CAT_PET_IDS = ["marmalade", "clementine", "cinnamon", "meowtase"] as const;
export const DEFAULT_CAT_PET_ID = "marmalade";

export const CatPetSize = Schema.Literals(["small", "medium", "large"]);
export type CatPetSize = typeof CatPetSize.Type;

export const CatPetMotion = Schema.Literals(["system", "reduced", "full"]);
export type CatPetMotion = typeof CatPetMotion.Type;

/**
 * The desktop pet's device settings. `placement: "desktop"` floats over other apps and falls
 * back to a pet inside the app window where it can't (Wayland, the web build).
 */
export const CatPetSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  placement: Schema.Literals(["desktop", "in-app"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("desktop" as const)),
  ),
  petId: Schema.String.check(Schema.isMaxLength(128)).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CAT_PET_ID)),
  ),
  size: CatPetSize.pipe(Schema.withDecodingDefault(Effect.succeed("medium" as const))),
  showWhen: Schema.Literals(["always", "busy"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("always" as const)),
  ),
  hideWhenAppFocused: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  overFullScreen: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  motion: CatPetMotion.pipe(Schema.withDecodingDefault(Effect.succeed("system" as const))),
  showTitles: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** An Electron accelerator such as `Control+Alt+P`; empty means no global shortcut. */
  shortcut: Schema.String.check(Schema.isMaxLength(64)).pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  customPets: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type CatPetSettings = typeof CatPetSettings.Type;
export const DEFAULT_CAT_PET_SETTINGS: CatPetSettings = Schema.decodeSync(CatPetSettings)({});

/** Most urgent first. `held` and `done` are decided where the pet is drawn. */
export const CAT_PET_MOODS = [
  "held",
  "needs-you",
  "limited",
  "error",
  "done",
  "working",
  "idle",
  "sleeping",
] as const;
export type CatPetMood = (typeof CAT_PET_MOODS)[number];

const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }));
const ShortText = Schema.String.check(Schema.isMaxLength(200));

export const CatPetThreadKind = Schema.Literals([
  "approval",
  "input",
  "request",
  "limited",
  "failed",
  "working",
  "done",
]);
export type CatPetThreadKind = typeof CatPetThreadKind.Type;

export const CatPetThread = Schema.Struct({
  environmentId: ShortText,
  threadId: ShortText,
  title: ShortText,
  machine: ShortText,
  kind: CatPetThreadKind,
});
export type CatPetThread = typeof CatPetThread.Type;

/** What the app window tells the pet, sent only when it changes. */
export const CatPetSnapshot = Schema.Struct({
  mood: Schema.Literals(["needs-you", "limited", "error", "working", "idle", "sleeping"]),
  /** A new value plays `done`. */
  celebrateSeq: Count,
  /** Finished runs the pet celebrated whose threads she has not opened since. */
  unreadDone: Count,
  /** When the pet last went idle, in ms since the epoch; it sleeps after a while. */
  idleSince: Schema.NullOr(Schema.Number),
  working: Count,
  needsYou: Count,
  limited: Count,
  failed: Count,
  limit: Schema.NullOr(Schema.Struct({ label: ShortText, resetsAt: Schema.NullOr(ShortText) })),
  machines: Schema.Struct({
    total: Count,
    connected: Count,
    offline: Schema.Array(ShortText).check(Schema.isMaxLength(8)),
  }),
  /** Needs-you first, then limited and failed, working, then recently done. */
  threads: Schema.Array(CatPetThread).check(Schema.isMaxLength(12)),
});
export type CatPetSnapshot = typeof CatPetSnapshot.Type;
