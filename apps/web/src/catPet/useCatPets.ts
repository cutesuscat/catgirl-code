import { BUILT_IN_CAT_PET_IDS, type CatPetListEntry } from "@t3tools/contracts";
import { parseCatPetManifest, type CatPetSpec } from "@t3tools/shared/catPetSprite";
import { useEffect, useState } from "react";

export interface CatPetChoice {
  readonly id: string;
  readonly source: CatPetListEntry["source"];
  readonly displayName: string;
  readonly spec: CatPetSpec;
  readonly sheetUrl: string;
}

const petAssetUrl = (id: string, file: string) => `${import.meta.env.BASE_URL}pets/${id}/${file}`;

async function loadBuiltInPets(): Promise<CatPetChoice[]> {
  const pets = await Promise.all(
    BUILT_IN_CAT_PET_IDS.map(async (id): Promise<CatPetChoice | null> => {
      const response = await fetch(petAssetUrl(id, "pet.json")).catch(() => null);
      if (response === null || !response.ok) return null;
      const parsed = parseCatPetManifest(await response.json().catch(() => null), id);
      if (!parsed.ok) return null;
      return {
        id,
        source: "built-in",
        displayName: parsed.spec.displayName,
        spec: parsed.spec,
        sheetUrl: petAssetUrl(id, parsed.spec.sheetPath),
      };
    }),
  );
  return pets.filter((pet): pet is CatPetChoice => pet !== null);
}

/** Built-in pets come from the app's own `/pets/`; custom ones from the desktop app, as data URLs. */
async function loadCatPetChoices(customPets: boolean): Promise<CatPetChoice[]> {
  const bridge = window.catgirlPet;
  if (bridge === undefined) return loadBuiltInPets();
  const entries = await bridge.listPets({ customPets });
  return entries.map((entry) => ({
    id: entry.id,
    source: entry.source,
    displayName: entry.displayName,
    spec: entry.spec as CatPetSpec,
    sheetUrl: entry.sheetUrl ?? petAssetUrl(entry.id, (entry.spec as CatPetSpec).sheetPath),
  }));
}

const cache = new Map<boolean, Promise<CatPetChoice[]>>();

export function useCatPetChoices(customPets: boolean, refresh = 0): CatPetChoice[] | null {
  const [loaded, setLoaded] = useState<{ key: string; pets: CatPetChoice[] } | null>(null);
  const key = `${customPets}:${refresh}`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the pet folders through the desktop app (or the web bundle), an outside source.
  useEffect(() => {
    let cancelled = false;
    if (refresh > 0) cache.delete(customPets);
    const pending = cache.get(customPets) ?? loadCatPetChoices(customPets);
    cache.set(customPets, pending);
    void pending
      .then((pets) => {
        if (!cancelled) setLoaded({ key, pets });
      })
      .catch(() => {
        cache.delete(customPets);
        if (!cancelled) setLoaded({ key, pets: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [customPets, refresh, key]);
  return loaded?.key === key ? loaded.pets : null;
}
