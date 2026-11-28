import type { CatPetMotion, CatPetSnapshot } from "@t3tools/contracts";
export type { CatPetCommand, CatPetStatus } from "@t3tools/contracts";
import type { CatPetSpec, CatPetState } from "@t3tools/shared/catPetSprite";

// Catgirl Code's own channels, kept out of upstream's channels.ts.
/** Pet page -> main. */
export const CAT_PET_PAGE_CHANNEL = "catgirl:pet-page";
/** Main -> pet page. */
export const CAT_PET_RENDER_CHANNEL = "catgirl:pet-render";
/** App window -> main: the summary to draw. */
export const CAT_PET_SNAPSHOT_CHANNEL = "catgirl:pet-snapshot";
/** App window -> main: the pets on offer, for the settings picker. */
export const CAT_PET_LIST_CHANNEL = "catgirl:pet-list";
/** App window -> main: where the pet ended up and whether its shortcut works. */
export const CAT_PET_STATUS_CHANNEL = "catgirl:pet-status";
/** Main -> app window: open a thread, start one, open settings, or change a pet setting. */
export const CAT_PET_COMMAND_CHANNEL = "catgirl:pet-command";

export type CatPetPageMessage =
  | { readonly type: "ready" }
  | { readonly type: "pointer"; readonly over: boolean }
  | { readonly type: "hover"; readonly on: boolean }
  | { readonly type: "panel-size"; readonly width: number; readonly height: number }
  | { readonly type: "press" }
  | { readonly type: "release" }
  | { readonly type: "open"; readonly environmentId?: string; readonly threadId?: string }
  | { readonly type: "new-thread" }
  | { readonly type: "tray"; readonly open: boolean }
  | { readonly type: "menu" }
  | { readonly type: "nudge"; readonly dx: number; readonly dy: number }
  | { readonly type: "reset-position" };

export type CatPetPanel = "none" | "bubble" | "tray";

export interface CatPetRenderMessage {
  /** Sent when the pet changes; the page keeps the last one. */
  readonly pet: {
    readonly spec: CatPetSpec;
    readonly sheetUrl: string;
    readonly sheetWidth: number;
    readonly sheetHeight: number;
  } | null;
  readonly state: CatPetState;
  /** Titles are already removed when the bubble shows counts only. */
  readonly snapshot: CatPetSnapshot | null;
  readonly appClosed: boolean;
  readonly motion: CatPetMotion;
  /** On battery, idle shows its still frame. */
  readonly stillWhenIdle: boolean;
  /** Hidden or the screen is locked: no timers at all. */
  readonly paused: boolean;
  readonly petSize: { readonly width: number; readonly height: number };
  readonly layout: {
    readonly pet: { readonly x: number; readonly y: number };
    readonly panel: { readonly x: number; readonly y: number; readonly above: boolean } | null;
  };
  readonly panel: CatPetPanel;
  /** Her right-click menu is open: she shows fully. */
  readonly menuOpen: boolean;
  /** 0.01 to 1 while nothing draws her attention; the page shows her fully when something does. */
  readonly opacity: number;
  /** macOS and Windows forward mouse moves over transparent pixels; Linux does not. */
  readonly clickThrough: boolean;
}
