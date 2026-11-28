import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** The pets bundled with the app, under `apps/web/public/pets/<id>/`. */
export const BUILT_IN_CAT_PET_IDS = ["marmalade", "clementine", "cinnamon", "meowtase"] as const;
const DEFAULT_CAT_PET_ID = "meowtase";
/** Pets that were once the default. Stored but never picked, they follow today's default. */
const PAST_DEFAULT_CAT_PET_IDS: readonly string[] = ["marmalade"];

/** The size slider's stops, smallest first. */
export const CAT_PET_SIZES = ["xs", "s", "m", "l", "xl"] as const;
export const CatPetSize = Schema.Literals(CAT_PET_SIZES);
export type CatPetSize = typeof CatPetSize.Type;

const LegacyCatPetSize = Schema.Literals(["small", "medium", "large"]).pipe(
  Schema.decodeTo(
    CatPetSize,
    SchemaTransformation.transform({
      decode: (size): CatPetSize => (size === "small" ? "s" : size === "large" ? "l" : "m"),
      encode: (size) =>
        size === "xs" || size === "s" ? "small" : size === "m" ? "medium" : "large",
    }),
  ),
);

export const CatPetMotion = Schema.Literals(["system", "reduced", "full"]);
export type CatPetMotion = typeof CatPetMotion.Type;

/**
 * The desktop pet's device settings. `placement: "desktop"` floats over other apps and falls
 * back to a pet inside the app window where it can't (Wayland, the web build).
 */
const CatPetSettingsFields = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  placement: Schema.Literals(["desktop", "in-app"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("desktop" as const)),
  ),
  petId: Schema.String.check(Schema.isMaxLength(128)).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CAT_PET_ID)),
  ),
  /** She chose `petId` herself; otherwise it follows the default. */
  petPicked: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  // The first build stored small, medium and large: they become s, m and l.
  size: Schema.Union([CatPetSize, LegacyCatPetSize]).pipe(
    Schema.withDecodingDefault(Effect.succeed("m" as const)),
  ),
  /** Percent, 1 to 100, while nothing draws her attention; hovering or an alert shows her fully. */
  opacity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(100)),
  ),
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

/**
 * The desktop pet's device settings (see the fields above). Before `petPicked` existed a
 * past default was stored like a choice, so one she never marked as picked follows the default.
 */
export const CatPetSettings = CatPetSettingsFields.pipe(
  Schema.decodeTo(
    Schema.toType(CatPetSettingsFields),
    SchemaTransformation.transform({
      decode: (settings) =>
        settings.petPicked || settings.petId === DEFAULT_CAT_PET_ID
          ? settings
          : PAST_DEFAULT_CAT_PET_IDS.includes(settings.petId)
            ? { ...settings, petId: DEFAULT_CAT_PET_ID }
            : { ...settings, petPicked: true },
      encode: (settings) => settings,
    }),
  ),
);
export type CatPetSettings = typeof CatPetSettings.Type;
export const DEFAULT_CAT_PET_SETTINGS: CatPetSettings = Schema.decodeSync(CatPetSettings)({});

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

/** What the desktop app asks the app window to do for the pet. */
export type CatPetCommand =
  | { readonly type: "open-thread"; readonly environmentId: string; readonly threadId: string }
  | { readonly type: "new-thread" }
  | { readonly type: "open-settings" }
  | { readonly type: "update-settings"; readonly patch: Partial<CatPetSettings> };

export interface CatPetStatus {
  readonly placement: "desktop" | "in-app" | "off";
  /** Why the pet is not floating where she asked, if it isn't. */
  readonly reason: string | null;
  readonly shortcut: "unset" | "ok" | "unavailable";
}

export interface CatPetListEntry {
  readonly id: string;
  readonly source: "built-in" | "catcode" | "codex";
  readonly displayName: string;
  /** A parsed pet spec (see `@t3tools/shared/catPetSprite`). */
  readonly spec: unknown;
  /** Null for built-in pets, which load from the app's own `/pets/`. */
  readonly sheetUrl: string | null;
}

/** `window.catgirlPet`, from the desktop preload. Absent in the browser build. */
export interface CatgirlPetBridge {
  readonly setSnapshot: (snapshot: CatPetSnapshot) => Promise<void>;
  readonly listPets: (options: {
    readonly customPets: boolean;
  }) => Promise<readonly CatPetListEntry[]>;
  readonly getStatus: () => Promise<CatPetStatus>;
  readonly onCommand: (listener: (command: CatPetCommand) => void) => () => void;
}
