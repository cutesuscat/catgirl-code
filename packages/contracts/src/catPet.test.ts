import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { CatPetSettings, CatPetSnapshot, DEFAULT_CAT_PET_SETTINGS } from "./catPet.ts";
import { ClientSettingsPatch, ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "./settings.ts";

const decodeClientSettings = Schema.decodeSync(ClientSettingsSchema);
const decodePatch = Schema.decodeSync(ClientSettingsPatch);
const decodePetSettings = Schema.decodeUnknownSync(CatPetSettings);
const decodeSnapshot = Schema.decodeUnknownSync(CatPetSnapshot);

describe("CatPetSettings", () => {
  it("is off by default, with the documented defaults", () => {
    expect(DEFAULT_CAT_PET_SETTINGS).toEqual({
      enabled: false,
      placement: "desktop",
      petId: "marmalade",
      size: "medium",
      showWhen: "always",
      hideWhenAppFocused: false,
      overFullScreen: false,
      motion: "system",
      showTitles: true,
      shortcut: "",
      customPets: true,
    });
    expect(DEFAULT_CLIENT_SETTINGS.catPet).toEqual(DEFAULT_CAT_PET_SETTINGS);
  });

  it("fills missing fields of a stored value and keeps the rest", () => {
    const settings = decodeClientSettings({
      catPet: { enabled: true, petId: "meowtase" },
    });
    expect(settings.catPet).toEqual({
      ...DEFAULT_CAT_PET_SETTINGS,
      enabled: true,
      petId: "meowtase",
    });
    expect(decodePatch({ catPet: settings.catPet })).toEqual({
      catPet: settings.catPet,
    });
  });

  it("rejects values outside the choices", () => {
    expect(() => decodePetSettings({ size: "huge" })).toThrow();
    expect(() => decodePetSettings({ shortcut: "x".repeat(65) })).toThrow();
  });
});

describe("CatPetSnapshot", () => {
  it("caps the thread list it accepts", () => {
    const thread = {
      environmentId: "e",
      threadId: "t",
      title: "T",
      machine: "m",
      kind: "working",
    };
    const snapshot = {
      mood: "working",
      celebrateSeq: 0,
      unreadDone: 0,
      idleSince: null,
      working: 1,
      needsYou: 0,
      limited: 0,
      failed: 0,
      limit: null,
      machines: { total: 1, connected: 1, offline: [] },
      threads: [thread],
    };
    expect(decodeSnapshot(snapshot)).toEqual(snapshot);
    expect(() =>
      decodeSnapshot({ ...snapshot, threads: Array.from({ length: 13 }, () => thread) }),
    ).toThrow();
  });
});
