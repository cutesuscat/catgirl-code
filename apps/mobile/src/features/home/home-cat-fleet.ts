import {
  CAT_FLEET_RESTING_SHARE,
  arrangeCatFleet,
  catFleetCoat,
  catFleetScatterOf,
  type CatFleetMachine,
} from "@t3tools/client-runtime/state/cat-fleet";

// The app icon's palette: the web client's --color-cat-* tokens.
export const CAT_COLORS = {
  light: "#fdb14f",
  base: "#ee8a2e",
  dark: "#dc6a18",
  cream: "#fbf1dc",
  honey: "#ffd45c",
  rust: "#c9462a",
  shade: "#281608",
  moons: ["#f5b4a2", "#fbf1dc", "#ffd9a8"],
} as const;

// One planet, in the web client's units, so a cat is drawn the same on every screen.
export const CAT_PLANET = { width: 66, height: 42 };
export const CAT_HEAD = { x: 33, y: 20.5, radius: 11.5 };
export const CAT_ORBIT_CENTER = { x: CAT_HEAD.x, y: CAT_HEAD.y + 0.15 * CAT_HEAD.radius };
export const CAT_ORBIT_SQUASH = 68.6 / 207;
export const CAT_ORBITS = [
  { radius: 17.5, tilt: -26 },
  { radius: 23.5, tilt: 9 },
  { radius: 29.5, tilt: -9 },
] as const;
// Stopped threads lie scattered just under the cat, as on the desktop.
const SCATTER = { size: 3.4, arc: 112, drift: 2.4, overlap: 0.5 };

/** A phone draws the planet this much larger than the desktop does. */
export const CAT_SCALE = 1.15;
const CELL_MIN_WIDTH = CAT_PLANET.width * CAT_SCALE;

/**
 * The machines a phone's row draws from, busiest first as on the desktop. A single machine
 * with nothing on it gives no row: there is nothing to compare and nothing to see.
 */
export function rankHomeCatFleet(machines: readonly CatFleetMachine[]): readonly CatFleetMachine[] {
  const only = machines.length === 1 ? machines[0] : undefined;
  if (only?.offline || only?.bodies.length === 0) return [];
  return arrangeCatFleet(machines, machines.length).shown;
}

/** How many cats fit one row of `width`, in cells that share that width evenly. */
export function homeCatFleetCells(width: number): {
  readonly count: number;
  readonly width: number;
} {
  const count = Math.max(0, Math.floor(width / CELL_MIN_WIDTH));
  return { count, width: count > 0 ? width / count : 0 };
}

/**
 * The cats one row holds: the first `count` in rank, and always the machine the list is
 * narrowed to, which takes the last cell when it did not make the row on its own.
 */
export function pickHomeCatFleet(
  ranked: readonly CatFleetMachine[],
  count: number,
  selectedEnvironmentId: string | null,
): readonly CatFleetMachine[] {
  const shown = ranked.slice(0, Math.max(0, count));
  const selected = ranked.find((machine) => machine.environmentId === selectedEnvironmentId);
  if (shown.length === 0 || selected === undefined || shown.includes(selected)) return shown;
  return [...shown.slice(0, -1), selected];
}

/** `share` percent of `color` over `other`, channel by channel: CSS color-mix in srgb. */
export function mixHexColors(color: string, other: string, share: number): string {
  const channel = (hex: string, index: number) =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) =>
    Math.round((channel(color, index) * share + channel(other, index) * (100 - share)) / 100),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** The three stops of a cat's coat, top to bottom, in the shade its machine's id picks. */
export function catCoatStops(environmentId: string, resting: boolean): readonly string[] {
  const { tint, ownShare } = catFleetCoat(environmentId);
  return [CAT_COLORS.light, CAT_COLORS.base, CAT_COLORS.dark].map((stop) => {
    const coat = mixHexColors(stop, CAT_COLORS[tint], ownShare);
    return resting ? mixHexColors(coat, CAT_COLORS.cream, CAT_FLEET_RESTING_SHARE) : coat;
  });
}

/**
 * Where a body sits on its orbit, a `turn` of 0 to 1 round from the orbit's right-hand end.
 * The lower half of an orbit passes in front of the cat and the upper half behind it.
 */
export function catOrbitPoint(
  orbit: { readonly radius: number; readonly tilt: number },
  turn: number,
): { readonly x: number; readonly y: number; readonly near: boolean } {
  const angle = turn * 2 * Math.PI;
  const flatX = orbit.radius * Math.cos(angle);
  const flatY = orbit.radius * Math.sin(angle) * CAT_ORBIT_SQUASH;
  const tilt = (orbit.tilt * Math.PI) / 180;
  return {
    x: CAT_ORBIT_CENTER.x + flatX * Math.cos(tilt) - flatY * Math.sin(tilt),
    y: CAT_ORBIT_CENTER.y + flatX * Math.sin(tilt) + flatY * Math.cos(tilt),
    near: Math.sin(angle) >= 0,
  };
}

/** Where a stopped thread lies under the cat: the desktop's scatter, in the same place. */
export function catStoppedPoint(
  key: string,
  index: number,
  total: number,
): { readonly x: number; readonly y: number; readonly radius: number } {
  const { along, drift } = catFleetScatterOf(key, index, total);
  const angle = ((90 + along * SCATTER.arc) * Math.PI) / 180;
  const distance = CAT_HEAD.radius + SCATTER.size / 2 - SCATTER.overlap + drift * SCATTER.drift;
  return {
    x: CAT_HEAD.x + distance * Math.cos(angle),
    y: CAT_HEAD.y + distance * Math.sin(angle),
    radius: SCATTER.size / 2,
  };
}
