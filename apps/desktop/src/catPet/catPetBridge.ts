import type { CatgirlPetBridge, CatPetCommand } from "@t3tools/contracts";
import { ipcRenderer } from "electron";

import {
  CAT_PET_COMMAND_CHANNEL,
  CAT_PET_LIST_CHANNEL,
  CAT_PET_SNAPSHOT_CHANNEL,
  CAT_PET_STATUS_CHANNEL,
} from "./catPetChannels.ts";

/** Exposed to the app window as `window.catgirlPet`, beside upstream's `desktopBridge`. */
export const catPetBridge: CatgirlPetBridge = {
  setSnapshot: (snapshot) => ipcRenderer.invoke(CAT_PET_SNAPSHOT_CHANNEL, snapshot),
  listPets: (options) => ipcRenderer.invoke(CAT_PET_LIST_CHANNEL, options),
  getStatus: () => ipcRenderer.invoke(CAT_PET_STATUS_CHANNEL),
  onCommand: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, command: unknown) => {
      if (typeof command === "object" && command !== null && "type" in command) {
        listener(command as CatPetCommand);
      }
    };
    ipcRenderer.on(CAT_PET_COMMAND_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(CAT_PET_COMMAND_CHANNEL, wrapped);
  },
};
