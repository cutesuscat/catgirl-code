// @effect-diagnostics globalTimers:off globalDate:off -- Drag polling, hover debounce and mood timers run only while needed.
import {
  CAT_PET_SIZES,
  CatPetSnapshot as CatPetSnapshotSchema,
  DEFAULT_CAT_PET_SETTINGS,
  type CatPetSettings,
  type CatPetSnapshot,
} from "@t3tools/contracts";
import {
  CAT_PET_DONE_LOOPS,
  CAT_PET_SIZE_LABELS,
  CAT_PET_SLEEP_AFTER_MS,
  catPetDisplayWidth,
  catPetLoopDuration,
  isCatPetBusy,
  resolveCatPetState,
  type CatPetState,
} from "@t3tools/shared/catPetSprite";
import * as Electron from "electron";
import * as Schema from "effect/Schema";

import type { LoadedCatPet } from "./catPetAssets.ts";
import {
  CAT_PET_COMMAND_CHANNEL,
  CAT_PET_PAGE_CHANNEL,
  CAT_PET_RENDER_CHANNEL,
  type CatPetCommand,
  type CatPetPageMessage,
  type CatPetPanel,
  type CatPetRenderMessage,
  type CatPetStatus,
} from "./catPetChannels.ts";
import { CAT_PET_WINDOW_TITLE, catPetPageHtml } from "./catPetPage.ts";
import {
  EMPTY_CAT_PET_POSITIONS,
  catPetDisplayKey,
  clampToArea,
  displayAt,
  forgetCatPetPosition,
  layoutCatPetWindow,
  rememberCatPetPosition,
  resolveCatPetPosition,
  type CatPetDisplay,
  type CatPetRect,
  type CatPetSavedPositions,
} from "./catPetPosition.ts";

const decodeSnapshot = Schema.decodeUnknownSync(CatPetSnapshotSchema);

export interface CatPetControllerDeps {
  readonly platform: NodeJS.Platform;
  /** Native Wayland can't place or raise windows, so the pet moves into the app window. */
  readonly wayland: boolean;
  readonly preloadPath: string;
  readonly createWindow: (
    options: Electron.BrowserWindowConstructorOptions,
  ) => Promise<Electron.BrowserWindow>;
  /** Brings the app window forward, creating it if needed. */
  readonly activateApp: () => Promise<void>;
  readonly loadPet: (id: string, customPets: boolean) => Promise<LoadedCatPet | null>;
  readonly readPositions: () => CatPetSavedPositions;
  readonly writePositions: (positions: CatPetSavedPositions) => void;
  /** Saves pet settings when no app window is open to do it. */
  readonly persistSettings: (settings: CatPetSettings) => Promise<void>;
  readonly onBattery: () => boolean;
  readonly log: (message: string, detail?: unknown) => void;
}

/** A dev-only override (CATCODE_PET_DEBUG_FILE) used for screenshots: never in a menu. */
export interface CatPetDebugOverride {
  readonly state?: CatPetState;
  readonly panel?: CatPetPanel;
  readonly snapshot?: unknown;
  readonly appClosed?: boolean;
}

const DRAG_THRESHOLD = 4;
const DRAG_POLL_MS = 16;
const DRAG_MAX_MS = 120_000;
const FOCUS_DEBOUNCE_MS = 150;
const SNAPSHOT_THROTTLE_MS = 250;

function toDisplay(display: Electron.Display): CatPetDisplay {
  return {
    id: display.id,
    label: display.label,
    scaleFactor: display.scaleFactor,
    bounds: display.bounds,
    workArea: display.workArea,
  };
}

export class CatPetController {
  private readonly deps: CatPetControllerDeps;
  private settings: CatPetSettings = DEFAULT_CAT_PET_SETTINGS;
  private snapshot: CatPetSnapshot | null = null;
  private appContents: Electron.WebContents | null = null;
  private appClosed = false;
  private pendingCommands: CatPetCommand[] = [];
  private appFocused = false;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private window: Electron.BrowserWindow | null = null;
  private creating: Promise<void> | null = null;
  private pageReady = false;
  private pet: LoadedCatPet | null = null;
  private petRequest = "";
  private petSent: LoadedCatPet | null = null;
  private panel: CatPetPanel = "none";
  private menuOpen = false;
  private panelSize: { width: number; height: number } = { width: 296, height: 120 };
  private petBox: CatPetRect | null = null;
  private positions: CatPetSavedPositions = EMPTY_CAT_PET_POSITIONS;
  private drag: {
    readonly cursor: Electron.Point;
    readonly box: CatPetRect;
    readonly started: number;
    moved: boolean;
    timer: ReturnType<typeof setInterval>;
  } | null = null;
  private held = false;
  private celebrating = false;
  private celebrateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCelebrateSeq: number | null = null;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private locked = false;
  private hiddenForNow = false;
  private shortcut: { accelerator: string; ok: boolean } | null = null;
  private debug: CatPetDebugOverride = {};
  private lastSnapshotAt = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSnapshot: CatPetSnapshot | null = null;
  private disposers: Array<() => void> = [];
  private petChoices: ReadonlyArray<{ readonly id: string; readonly displayName: string }> = [];

  constructor(deps: CatPetControllerDeps) {
    this.deps = deps;
    this.positions = deps.readPositions();
  }

  start(): void {
    const onPage = (event: Electron.IpcMainEvent, raw: unknown) => {
      const window = this.window;
      if (window === null || window.isDestroyed() || event.sender !== window.webContents) return;
      if (event.senderFrame !== window.webContents.mainFrame) return;
      if (typeof raw !== "object" || raw === null || !("type" in raw)) return;
      this.onPageMessage(raw as CatPetPageMessage);
    };
    Electron.ipcMain.on(CAT_PET_PAGE_CHANNEL, onPage);
    this.disposers.push(() => Electron.ipcMain.removeListener(CAT_PET_PAGE_CHANNEL, onPage));

    const onFocus = (_event: unknown, window: Electron.BrowserWindow) => {
      if (window.webContents === this.appContents) this.setAppFocused(true);
    };
    const onBlur = (_event: unknown, window: Electron.BrowserWindow) => {
      if (window.webContents === this.appContents) this.setAppFocused(false);
    };
    Electron.app.on("browser-window-focus", onFocus);
    Electron.app.on("browser-window-blur", onBlur);
    this.disposers.push(() => {
      Electron.app.removeListener("browser-window-focus", onFocus);
      Electron.app.removeListener("browser-window-blur", onBlur);
    });

    const onDisplays = () => this.onDisplaysChanged();
    for (const name of ["display-added", "display-removed", "display-metrics-changed"] as const) {
      Electron.screen.on(name as "display-added", onDisplays);
      this.disposers.push(() =>
        Electron.screen.removeListener(name as "display-added", onDisplays),
      );
    }
    const power: Array<[string, () => void]> = [
      ["lock-screen", () => this.setLocked(true)],
      ["unlock-screen", () => this.setLocked(false)],
      ["on-battery", () => this.render()],
      ["on-ac", () => this.render()],
    ];
    for (const [name, listener] of power) {
      Electron.powerMonitor.on(name as "lock-screen", listener);
      this.disposers.push(() =>
        Electron.powerMonitor.removeListener(name as "lock-screen", listener),
      );
    }
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.registerShortcut("");
    this.stopDrag();
    for (const timer of [
      this.focusTimer,
      this.celebrateTimer,
      this.sleepTimer,
      this.snapshotTimer,
    ]) {
      if (timer !== null) clearTimeout(timer);
    }
    this.destroyWindow();
  }

  configure(settings: CatPetSettings): void {
    const before = this.settings;
    this.settings = settings;
    if (!settings.enabled) this.hiddenForNow = false;
    this.registerShortcut(settings.enabled ? settings.shortcut.trim() : "");
    if (
      this.window !== null &&
      !this.window.isDestroyed() &&
      before.overFullScreen !== settings.overFullScreen
    ) {
      this.applyWorkspaces(this.window);
    }
    if (before.size !== settings.size) this.petBox = null;
    void this.ensurePet();
    this.update();
  }

  /** From the app window; throttled so a burst of thread updates draws once. */
  setSnapshot(raw: unknown, sender: Electron.WebContents): void {
    const snapshot = decodeSnapshot(raw);
    if (sender !== this.appContents) this.attachApp(sender);
    const wait = this.lastSnapshotAt + SNAPSHOT_THROTTLE_MS - Date.now();
    if (wait > 0) {
      this.queuedSnapshot = snapshot;
      this.snapshotTimer ??= setTimeout(() => {
        this.snapshotTimer = null;
        const queued = this.queuedSnapshot;
        this.queuedSnapshot = null;
        if (queued !== null) this.acceptSnapshot(queued);
      }, wait);
      return;
    }
    this.acceptSnapshot(snapshot);
  }

  setDebug(override: CatPetDebugOverride): void {
    const hadPanel = this.debug.panel !== undefined;
    this.debug = override;
    if (override.panel !== undefined) this.panel = override.panel;
    else if (hadPanel) this.panel = "none";
    this.update();
  }

  status(): CatPetStatus {
    const placement = this.effectivePlacement();
    return {
      placement,
      reason:
        this.settings.enabled && this.settings.placement === "desktop" && placement === "in-app"
          ? "Wayland can't float a window over other apps, so the pet sits in the app window."
          : null,
      shortcut: this.shortcut === null ? "unset" : this.shortcut.ok ? "ok" : "unavailable",
    };
  }

  private effectivePlacement(): CatPetStatus["placement"] {
    if (!this.settings.enabled) return "off";
    if (this.settings.placement === "in-app" || this.deps.wayland) return "in-app";
    return "desktop";
  }

  private attachApp(contents: Electron.WebContents): void {
    this.appContents = contents;
    this.appClosed = false;
    contents.once("destroyed", () => {
      if (this.appContents !== contents) return;
      this.appContents = null;
      this.appClosed = true;
      this.appFocused = false;
      this.update();
    });
    const pending = this.pendingCommands.splice(0);
    for (const command of pending) contents.send(CAT_PET_COMMAND_CHANNEL, command);
  }

  private acceptSnapshot(snapshot: CatPetSnapshot): void {
    this.lastSnapshotAt = Date.now();
    if (this.lastCelebrateSeq !== null && snapshot.celebrateSeq > this.lastCelebrateSeq) {
      this.celebrate();
    }
    this.lastCelebrateSeq = snapshot.celebrateSeq;
    this.snapshot = snapshot;
    this.update();
  }

  private celebrate(): void {
    const done = this.pet?.spec.animations.done;
    const ms = done === undefined ? 2500 : catPetLoopDuration(done) * CAT_PET_DONE_LOOPS;
    this.celebrating = true;
    if (this.celebrateTimer !== null) clearTimeout(this.celebrateTimer);
    this.celebrateTimer = setTimeout(() => {
      this.celebrateTimer = null;
      this.celebrating = false;
      this.update();
    }, ms);
  }

  private setAppFocused(focused: boolean): void {
    if (this.focusTimer !== null) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (this.appFocused === focused) return;
      this.appFocused = focused;
      if (this.settings.hideWhenAppFocused) this.update();
    }, FOCUS_DEBOUNCE_MS);
  }

  private setLocked(locked: boolean): void {
    this.locked = locked;
    this.render();
  }

  toggleHidden(): void {
    this.hiddenForNow = !this.hiddenForNow;
    this.update();
  }

  private snapshotForPage(): CatPetSnapshot | null {
    let snapshot = this.snapshot;
    if (this.debug.snapshot !== undefined) {
      try {
        snapshot = decodeSnapshot(this.debug.snapshot);
      } catch (error) {
        this.deps.log("cat pet debug snapshot rejected", error);
      }
    }
    if (snapshot === null || this.settings.showTitles) return snapshot;
    return { ...snapshot, threads: snapshot.threads.map((thread) => ({ ...thread, title: "" })) };
  }

  private appIsClosed(): boolean {
    return this.debug.appClosed ?? this.appClosed;
  }

  private state(now: number): CatPetState {
    if (this.debug.state !== undefined) return this.debug.state;
    return resolveCatPetState({
      mood: this.snapshot?.mood ?? "idle",
      held: this.held,
      celebrating: this.celebrating,
      appClosed: this.appIsClosed(),
      idleSince: this.snapshot?.idleSince ?? null,
      now,
    });
  }

  private scheduleSleep(now: number): void {
    if (this.sleepTimer !== null) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    const idleSince = this.snapshot?.mood === "idle" ? this.snapshot.idleSince : null;
    if (idleSince === null) return;
    const wait = idleSince + CAT_PET_SLEEP_AFTER_MS - now;
    if (wait <= 0) return;
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null;
      this.update();
    }, wait + 50);
  }

  private shouldShow(state: CatPetState): boolean {
    if (this.effectivePlacement() !== "desktop" || this.hiddenForNow) return false;
    if (this.pet === null) return false;
    if (this.debug.state !== undefined) return true;
    if (this.settings.showWhen === "busy" && !isCatPetBusy(state)) return false;
    if (this.settings.hideWhenAppFocused && this.appFocused) return false;
    return true;
  }

  /** Re-decides everything: window, visibility, timers and the page's picture. */
  update(): void {
    const now = Date.now();
    this.scheduleSleep(now);
    const state = this.state(now);
    // Without macOS's windowless app, an open pet window would keep the app from quitting.
    const keepWindow =
      this.effectivePlacement() === "desktop" &&
      this.pet !== null &&
      !(this.deps.platform !== "darwin" && this.appIsClosed() && this.debug.appClosed !== true);
    if (!keepWindow) {
      this.destroyWindow();
      return;
    }
    if (this.window === null || this.window.isDestroyed()) {
      void this.createWindow();
      return;
    }
    const show = this.shouldShow(state);
    if (show && !this.window.isVisible()) {
      this.applyBounds();
      this.window.showInactive();
      this.applyClickThrough(false);
    } else if (!show && this.window.isVisible()) {
      this.closePanel();
      this.window.hide();
    }
    this.render();
  }

  private petSize(): { width: number; height: number } {
    const spec = this.pet?.spec;
    const width = catPetDisplayWidth(this.settings.size, spec?.imageRendering ?? "auto");
    const cell = spec?.cell ?? { width: 192, height: 208 };
    return { width, height: Math.round((width * cell.height) / cell.width) };
  }

  private displays(): CatPetDisplay[] {
    return Electron.screen.getAllDisplays().map(toDisplay);
  }

  private ensurePetBox(): CatPetRect {
    const size = this.petSize();
    if (
      this.petBox !== null &&
      this.petBox.width === size.width &&
      this.petBox.height === size.height
    ) {
      return this.petBox;
    }
    const point = resolveCatPetPosition(
      this.positions,
      this.displays(),
      toDisplay(Electron.screen.getPrimaryDisplay()),
      size,
    );
    this.petBox = { ...point, ...size };
    return this.petBox;
  }

  private layout() {
    const box = this.ensurePetBox();
    const display =
      displayAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, this.displays()) ??
      toDisplay(Electron.screen.getPrimaryDisplay());
    return layoutCatPetWindow(box, this.panel === "none" ? null : this.panelSize, display.workArea);
  }

  private applyBounds(): void {
    const window = this.window;
    if (window === null || window.isDestroyed()) return;
    const { window: bounds } = this.layout();
    const current = window.getBounds();
    if (
      current.x !== bounds.x ||
      current.y !== bounds.y ||
      current.width !== bounds.width ||
      current.height !== bounds.height
    ) {
      window.setBounds(bounds, false);
    }
  }

  private render(): void {
    const window = this.window;
    if (window === null || window.isDestroyed() || !this.pageReady || this.pet === null) return;
    this.applyBounds();
    const layout = this.layout();
    const pet = this.pet;
    const message: CatPetRenderMessage = {
      pet:
        this.petSent === pet
          ? null
          : {
              spec: pet.spec,
              sheetUrl: pet.sheetUrl,
              sheetWidth: pet.sheetSize.width,
              sheetHeight: pet.sheetSize.height,
            },
      state: this.state(Date.now()),
      snapshot: this.snapshotForPage(),
      appClosed: this.appIsClosed(),
      motion: this.settings.motion,
      stillWhenIdle: this.deps.onBattery(),
      paused: this.locked || !window.isVisible(),
      petSize: this.petSize(),
      layout: { pet: layout.pet, panel: layout.panel },
      panel: this.panel,
      menuOpen: this.menuOpen,
      opacity: this.settings.opacity / 100,
      clickThrough: this.deps.platform !== "linux",
    };
    this.petSent = pet;
    window.webContents.send(CAT_PET_RENDER_CHANNEL, message);
  }

  private async createWindow(): Promise<void> {
    if (this.creating !== null) return this.creating;
    this.creating = (async () => {
      const box = this.ensurePetBox();
      const mac = this.deps.platform === "darwin";
      const window = await this.deps.createWindow({
        ...box,
        title: CAT_PET_WINDOW_TITLE,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        roundedCorners: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        // Linux has no setFocusable, so its window stays focusable for the tray's keys; it is
        // still only ever shown inactive.
        ...(mac ? { type: "panel" } : this.deps.platform === "win32" ? { focusable: false } : {}),
        webPreferences: {
          preload: this.deps.preloadPath,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: true,
          spellcheck: false,
        },
      });
      this.window = window;
      this.pageReady = false;
      this.petSent = null;
      window.setAlwaysOnTop(true, "floating");
      this.applyWorkspaces(window);
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.on("closed", () => {
        if (this.window === window) {
          this.window = null;
          this.pageReady = false;
        }
      });
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(catPetPageHtml())}`);
    })()
      .catch((error: unknown) => this.deps.log("cat pet window failed", error))
      .finally(() => {
        this.creating = null;
      });
    return this.creating;
  }

  private applyWorkspaces(window: Electron.BrowserWindow): void {
    if (this.deps.platform !== "darwin") return;
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: this.settings.overFullScreen,
      skipTransformProcessType: true,
    });
  }

  private applyClickThrough(solid: boolean): void {
    const window = this.window;
    if (window === null || window.isDestroyed() || this.deps.platform === "linux") return;
    if (solid) window.setIgnoreMouseEvents(false);
    else window.setIgnoreMouseEvents(true, { forward: true });
  }

  private destroyWindow(): void {
    this.stopDrag();
    this.panel = "none";
    const window = this.window;
    this.window = null;
    this.pageReady = false;
    if (window !== null && !window.isDestroyed()) window.destroy();
  }

  private async ensurePet(): Promise<void> {
    if (!this.settings.enabled) return;
    const request = `${this.settings.petId}|${this.settings.customPets}`;
    if (request === this.petRequest) return;
    this.petRequest = request;
    const pet =
      (await this.deps.loadPet(this.settings.petId, this.settings.customPets)) ??
      (await this.deps.loadPet(DEFAULT_CAT_PET_SETTINGS.petId, false));
    if (request !== this.petRequest) return;
    if (pet === null) this.deps.log("cat pet: no pet could be loaded");
    this.pet = pet;
    this.petBox = null;
    this.update();
  }

  private onDisplaysChanged(): void {
    this.petBox = null;
    if (this.window !== null && !this.window.isDestroyed()) {
      this.applyBounds();
      if (this.window.isVisible()) this.applyClickThrough(false);
    }
    this.render();
  }

  private onPageMessage(message: CatPetPageMessage): void {
    switch (message.type) {
      case "ready":
        this.pageReady = true;
        this.petSent = null;
        this.update();
        return;
      case "pointer":
        this.applyClickThrough(message.over || this.drag !== null);
        return;
      case "hover":
        if (message.on && this.panel === "none" && this.drag === null) this.setPanel("bubble");
        else if (!message.on && this.panel === "bubble") this.setPanel("none");
        return;
      case "panel-size": {
        const width = Math.min(Math.max(Math.round(message.width), 120), 480);
        const height = Math.min(Math.max(Math.round(message.height), 40), 640);
        if (width === this.panelSize.width && height === this.panelSize.height) return;
        this.panelSize = { width, height };
        this.render();
        return;
      }
      case "press":
        this.startDrag();
        return;
      case "release":
        this.endDrag();
        return;
      case "open":
        if (message.environmentId !== undefined && message.threadId !== undefined) {
          this.openThread(message.environmentId, message.threadId);
        } else {
          void this.deps.activateApp();
        }
        this.closePanel();
        return;
      case "new-thread":
        this.closePanel();
        this.sendToApp({ type: "new-thread" });
        return;
      case "tray":
        this.setPanel(message.open ? "tray" : "none");
        return;
      case "menu":
        this.showMenu();
        return;
      case "nudge":
        this.nudge(message.dx, message.dy);
        return;
      case "reset-position":
        this.resetPosition();
        return;
    }
  }

  private setPanel(panel: CatPetPanel): void {
    if (this.debug.panel !== undefined) return;
    if (panel === this.panel) return;
    const window = this.window;
    const focusable = this.deps.platform === "win32" && window !== null && !window.isDestroyed();
    if (panel === "tray" && window !== null && !window.isDestroyed()) {
      if (focusable) window.setFocusable(true);
      this.panel = panel;
      this.render();
      // The tray takes keys (arrows, Esc). On Linux show() activates where focus() is refused;
      // elsewhere it could activate the whole app, so focus() alone (a panel on macOS).
      if (this.deps.platform === "linux") window.show();
      window.focus();
      return;
    }
    if (this.panel === "tray" && focusable) window.setFocusable(false);
    this.panel = panel;
    this.render();
  }

  private closePanel(): void {
    if (this.panel !== "none") this.setPanel("none");
  }

  private click(): void {
    const urgent = this.snapshot?.threads.find((thread) => thread.kind !== "working");
    if (urgent !== undefined && !this.appIsClosed()) {
      this.openThread(urgent.environmentId, urgent.threadId);
    } else {
      void this.deps.activateApp();
    }
  }

  private openThread(environmentId: string, threadId: string): void {
    void this.deps
      .activateApp()
      .then(() => this.sendToApp({ type: "open-thread", environmentId, threadId }));
  }

  private sendToApp(command: CatPetCommand): void {
    const contents = this.appContents;
    if (contents === null || contents.isDestroyed()) {
      // The app window is closed (macOS): it runs these once it is back and reports in.
      this.pendingCommands = [...this.pendingCommands.slice(-3), command];
      void this.deps.activateApp();
      return;
    }
    contents.send(CAT_PET_COMMAND_CHANNEL, command);
  }

  private updateSettings(patch: Partial<CatPetSettings>): void {
    const next = { ...this.settings, ...patch };
    const contents = this.appContents;
    if (contents !== null && !contents.isDestroyed()) {
      contents.send(CAT_PET_COMMAND_CHANNEL, {
        type: "update-settings",
        patch,
      } satisfies CatPetCommand);
      return;
    }
    this.configure(next);
    void this.deps
      .persistSettings(next)
      .catch((error: unknown) => this.deps.log("cat pet settings not saved", error));
  }

  /** The pets the right-click menu offers, refreshed whenever the list is read. */
  setPetChoices(
    choices: ReadonlyArray<{ readonly id: string; readonly displayName: string }>,
  ): void {
    this.petChoices = choices;
  }

  private showMenu(): void {
    const window = this.window;
    if (window === null || window.isDestroyed()) return;
    this.closePanel();
    const needs = (this.snapshot?.threads ?? []).filter(
      (thread) => thread.kind !== "working" && thread.kind !== "done",
    );
    const size = (value: CatPetSettings["size"]): Electron.MenuItemConstructorOptions => ({
      label: CAT_PET_SIZE_LABELS[value],
      type: "radio",
      checked: this.settings.size === value,
      click: () => this.updateSettings({ size: value }),
    });
    const pets =
      this.petChoices.length > 0 ? this.petChoices : this.pet === null ? [] : [this.pet.spec];
    const menu = Electron.Menu.buildFromTemplate([
      { label: "Open Catgirl Code", click: () => void this.deps.activateApp() },
      {
        label: "Needs you",
        submenu:
          needs.length === 0
            ? [{ label: "Nothing needs you", enabled: false }]
            : needs.map((thread) => ({
                label: `${thread.title === "" ? "Thread" : thread.title} (${thread.machine})`,
                click: () => this.openThread(thread.environmentId, thread.threadId),
              })),
      },
      { type: "separator" },
      {
        label: "Size",
        submenu: CAT_PET_SIZES.map(size),
      },
      {
        label: "Pet",
        submenu: pets.map((pet) => ({
          label: pet.displayName,
          type: "radio",
          checked: this.settings.petId === pet.id,
          click: () => this.updateSettings({ petId: pet.id, petPicked: true }),
        })),
      },
      {
        label: "Only show while agents are busy",
        type: "checkbox",
        checked: this.settings.showWhen === "busy",
        click: () =>
          this.updateSettings({ showWhen: this.settings.showWhen === "busy" ? "always" : "busy" }),
      },
      { type: "separator" },
      { label: "Hide pet", click: () => this.updateSettings({ enabled: false }) },
      { label: "Pet settings…", click: () => this.sendToApp({ type: "open-settings" }) },
    ]);
    // She shows fully while her menu is open.
    this.menuOpen = true;
    this.render();
    menu.popup({
      window,
      callback: () => {
        this.menuOpen = false;
        this.render();
      },
    });
  }

  private startDrag(): void {
    this.stopDrag();
    const box = this.ensurePetBox();
    const cursor = Electron.screen.getCursorScreenPoint();
    const started = Date.now();
    const timer = setInterval(() => this.dragStep(), DRAG_POLL_MS);
    this.drag = { cursor, box, started, moved: false, timer };
    this.applyClickThrough(true);
  }

  private dragStep(): void {
    const drag = this.drag;
    const window = this.window;
    if (drag === null || window === null || window.isDestroyed()) return this.stopDrag();
    if (Date.now() - drag.started > DRAG_MAX_MS) return this.endDrag();
    const point = Electron.screen.getCursorScreenPoint();
    const dx = point.x - drag.cursor.x;
    const dy = point.y - drag.cursor.y;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      this.held = true;
      this.panel = "none";
      this.update();
    }
    this.petBox = { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
    window.setBounds({ ...this.petBox }, false);
  }

  private endDrag(): void {
    const drag = this.drag;
    this.stopDrag();
    if (drag === null) return;
    if (!drag.moved) {
      this.click();
      return;
    }
    this.held = false;
    if (this.petBox !== null) this.savePosition(this.petBox);
    this.update();
  }

  private stopDrag(): void {
    if (this.drag !== null) clearInterval(this.drag.timer);
    this.drag = null;
  }

  private savePosition(box: CatPetRect): void {
    const { saved, clamped } = rememberCatPetPosition(this.positions, box, this.displays());
    this.positions = saved;
    this.petBox = { ...box, ...clamped };
    this.deps.writePositions(saved);
  }

  private nudge(dx: number, dy: number): void {
    const box = this.ensurePetBox();
    const display = displayAt(
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      this.displays(),
    );
    const moved = { ...box, x: box.x + dx, y: box.y + dy };
    const point = display === null ? moved : clampToArea(moved, box, display.workArea);
    this.savePosition({ ...box, ...point });
    this.render();
  }

  private resetPosition(): void {
    const box = this.ensurePetBox();
    const display = displayAt(
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      this.displays(),
    );
    if (display === null) return;
    this.positions = forgetCatPetPosition(this.positions, catPetDisplayKey(display));
    this.deps.writePositions(this.positions);
    this.petBox = null;
    this.setPanel("none");
    this.render();
  }

  private registerShortcut(accelerator: string): void {
    if (this.shortcut?.accelerator === accelerator) return;
    if (this.shortcut?.ok === true) {
      try {
        Electron.globalShortcut.unregister(this.shortcut.accelerator);
      } catch {}
    }
    this.shortcut = null;
    if (accelerator === "") return;
    let ok = false;
    try {
      ok = Electron.globalShortcut.register(accelerator, () => this.toggleHidden());
    } catch (error) {
      this.deps.log("cat pet shortcut rejected", error);
    }
    this.shortcut = { accelerator, ok };
  }
}
