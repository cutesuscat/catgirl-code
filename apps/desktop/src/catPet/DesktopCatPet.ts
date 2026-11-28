// @effect-diagnostics nodeBuiltinImport:off - The pet reads small JSON and image files outside Effect's callbacks.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { CatPetSnapshot, DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { catPetFolderOf, listCatPets, loadCatPetFolder, type CatPetFiles } from "./catPetAssets.ts";
import {
  CAT_PET_LIST_CHANNEL,
  CAT_PET_SNAPSHOT_CHANNEL,
  CAT_PET_STATUS_CHANNEL,
} from "./catPetChannels.ts";
import { CatPetController, type CatPetDebugOverride } from "./CatPetController.ts";
import { EMPTY_CAT_PET_POSITIONS, type CatPetSavedPositions } from "./catPetPosition.ts";

const CatPetListEntry = Schema.Struct({
  id: Schema.String,
  source: Schema.Literals(["built-in", "catcode", "codex"]),
  displayName: Schema.String,
  spec: Schema.Unknown,
  /** Null for built-in pets, which the app window loads from its own `/pets/`. */
  sheetUrl: Schema.NullOr(Schema.String),
});

const CatPetStatusSchema = Schema.Struct({
  placement: Schema.Literals(["desktop", "in-app", "off"]),
  reason: Schema.NullOr(Schema.String),
  shortcut: Schema.Literals(["unset", "ok", "unavailable"]),
});

const SavedPositions = Schema.Struct({
  spots: Schema.Record(
    Schema.String,
    Schema.Struct({ xFrac: Schema.Finite, yFrac: Schema.Finite }),
  ),
  lastDisplayKey: Schema.NullOr(Schema.String),
});
const decodePositions = Schema.decodeUnknownOption(Schema.fromJsonString(SavedPositions));

export class DesktopCatPet extends Context.Service<
  DesktopCatPet,
  {
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    /** Registers the app window's IPC and puts the pet up from the stored settings. */
    readonly install: Effect.Effect<
      void,
      DesktopIpc.DesktopIpcRegistrationError,
      DesktopIpc.DesktopIpc | import("effect/Scope").Scope
    >;
  }
>()("@t3tools/desktop/catPet/DesktopCatPet") {}

const nodeFiles: CatPetFiles = {
  join: (...parts) => NodePath.join(...parts),
  readFile: async (path, maxBytes) => {
    try {
      const stat = await NodeFSP.stat(path);
      if (!stat.isFile() || stat.size > maxBytes) return null;
      return new Uint8Array(await NodeFSP.readFile(path));
    } catch {
      return null;
    }
  },
  listDirectories: async (path) => {
    try {
      const names = await NodeFSP.readdir(path);
      const folders: string[] = [];
      for (const name of names.toSorted()) {
        const stat = await NodeFSP.stat(NodePath.join(path, name)).catch(() => null);
        if (stat?.isDirectory() === true) folders.push(name);
      }
      return folders;
    } catch {
      return [];
    }
  },
};

/** In development the web bundle is the dev server, so built-in pets come over HTTP. */
const devServerFiles = (origin: URL): CatPetFiles => ({
  join: (...parts) => parts.join("/"),
  readFile: async (path, maxBytes) => {
    try {
      const response = await Electron.net.fetch(new URL(path, origin).href);
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength > maxBytes ? null : bytes;
    } catch {
      return null;
    }
  },
  listDirectories: async () => [],
});

function isWaylandSession(platform: NodeJS.Platform): boolean {
  if (platform !== "linux") return false;
  const ozone = Electron.app.commandLine.getSwitchValue("ozone-platform");
  if (ozone === "x11") return false;
  if (ozone === "wayland") return true;
  return (process.env.WAYLAND_DISPLAY ?? "") !== "" || process.env.XDG_SESSION_TYPE === "wayland";
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const runPromise = Effect.runPromiseWith(context);

  const builtIn = Option.isSome(environment.devServerUrl)
    ? { files: devServerFiles(environment.devServerUrl.value), root: "pets" }
    : { files: nodeFiles, root: NodePath.join(environment.clientAssetsDir, "pets") };
  const customRoots = [
    {
      path: NodePath.join(environment.homeDirectory, ".catcode", "pets"),
      source: "catcode" as const,
    },
    { path: NodePath.join(environment.homeDirectory, ".codex", "pets"), source: "codex" as const },
  ];
  const positionsPath = NodePath.join(environment.stateDir, "catgirl-pet.json");
  const log = (message: string, detail?: unknown) =>
    runFork(Effect.logWarning(message, detail === undefined ? "" : String(detail)));

  let controller: CatPetController | null = null;
  let pendingSettings: ClientSettings | null = null;

  const ensureController = () => {
    if (controller !== null) return controller;
    controller = new CatPetController({
      platform: environment.platform,
      wayland: isWaylandSession(environment.platform),
      preloadPath: NodePath.join(environment.dirname, "cat-pet-preload.cjs"),
      createWindow: (options) => runPromise(electronWindow.create(options, { auxiliary: true })),
      activateApp: () =>
        runPromise(desktopWindow.revealOrCreateMain.pipe(Effect.asVoid, Effect.ignore)),
      loadPet: async (id, customPets) => {
        const where = catPetFolderOf(id, {
          builtIn: builtIn.root,
          custom: customPets ? customRoots : [],
        });
        if (where === null) return null;
        const files = where.source === "built-in" ? builtIn.files : nodeFiles;
        const folder = files.join(where.root, where.name);
        const result = await loadCatPetFolder(files, folder, where.name, where.source);
        if (!result.ok) {
          log(`cat pet ${id} skipped: ${result.reason}`);
          return null;
        }
        return result.pet;
      },
      readPositions: () => {
        try {
          return Option.getOrElse(
            decodePositions(NodeFS.readFileSync(positionsPath, "utf8")),
            () => EMPTY_CAT_PET_POSITIONS,
          );
        } catch {
          return EMPTY_CAT_PET_POSITIONS;
        }
      },
      writePositions: (positions: CatPetSavedPositions) => {
        try {
          NodeFS.mkdirSync(environment.stateDir, { recursive: true });
          NodeFS.writeFileSync(positionsPath, `${JSON.stringify(positions, null, 2)}\n`);
        } catch (error) {
          log("cat pet position not saved", error);
        }
      },
      persistSettings: (catPet) =>
        runPromise(
          clientSettings.get.pipe(
            Effect.map((stored) => Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS)),
            Effect.flatMap((stored) => clientSettings.set({ ...stored, catPet })),
            Effect.ignore,
          ),
        ),
      onBattery: () => Electron.powerMonitor.isOnBatteryPower(),
      log,
    });
    controller.start();
    return controller;
  };
  const watchDebugFile = (pet: CatPetController) => {
    const path = process.env.CATCODE_PET_DEBUG_FILE;
    if (path === undefined || path === "") return;
    const read = () => {
      try {
        pet.setDebug(JSON.parse(NodeFS.readFileSync(path, "utf8")) as CatPetDebugOverride);
      } catch {
        pet.setDebug({});
      }
    };
    NodeFS.watchFile(path, { interval: 300 }, read);
    read();
  };

  const configure = (settings: ClientSettings) =>
    Effect.sync(() => {
      if (controller === null) pendingSettings = settings;
      else controller.configure(settings.catPet);
    });

  const snapshotMethod = DesktopIpc.makeIpcMethod({
    channel: CAT_PET_SNAPSHOT_CHANNEL,
    payload: CatPetSnapshot,
    result: Schema.Void,
    handler: (snapshot, event) =>
      Effect.sync(() => {
        const sender = event === undefined ? null : Electron.webContents.fromId(event.sender.id);
        if (sender !== null && sender !== undefined) controller?.setSnapshot(snapshot, sender);
      }),
  });

  const listMethod = DesktopIpc.makeIpcMethod({
    channel: CAT_PET_LIST_CHANNEL,
    payload: Schema.Struct({ customPets: Schema.Boolean }),
    result: Schema.Array(CatPetListEntry),
    handler: ({ customPets }) =>
      Effect.promise(async () => {
        const pets = await listCatPets({
          files: nodeFiles,
          builtIn,
          customRoots: customPets ? customRoots : [],
          onSkip: (folder, reason) => log(`cat pet ${folder} skipped: ${reason}`),
        });
        controller?.setPetChoices(
          pets.map((pet) => ({ id: pet.id, displayName: pet.spec.displayName })),
        );
        return pets.map((pet) => ({
          id: pet.id,
          source: pet.source,
          displayName: pet.spec.displayName,
          spec: pet.spec,
          sheetUrl: pet.source === "built-in" ? null : pet.sheetUrl,
        }));
      }),
  });

  const statusMethod = DesktopIpc.makeIpcMethod({
    channel: CAT_PET_STATUS_CHANNEL,
    payload: Schema.Void,
    result: CatPetStatusSchema,
    handler: () =>
      Effect.sync(
        () =>
          controller?.status() ?? {
            placement: "off" as const,
            reason: null,
            shortcut: "unset" as const,
          },
      ),
  });

  const install = Effect.gen(function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    yield* ipc.handle(snapshotMethod);
    yield* ipc.handle(listMethod);
    yield* ipc.handle(statusMethod);
    const pet = ensureController();
    yield* Effect.addFinalizer(() => Effect.sync(() => pet.dispose()));
    const stored =
      pendingSettings ??
      Option.getOrElse(
        yield* clientSettings.get.pipe(Effect.orElseSucceed(() => Option.none<ClientSettings>())),
        () => DEFAULT_CLIENT_SETTINGS,
      );
    pet.configure(stored.catPet);
    watchDebugFile(pet);
  }).pipe(Effect.withSpan("desktop.catPet.install"));

  return DesktopCatPet.of({ configure, install });
});

export const layer = Layer.effect(DesktopCatPet, make);

/** Missing only in tests that build no pet layer, where there is nothing to install. */
export const optional = Effect.serviceOption(DesktopCatPet).pipe(Effect.map(Option.getOrUndefined));
