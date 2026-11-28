export interface CatPetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CatPetDisplay {
  readonly id: number;
  readonly label: string;
  readonly scaleFactor: number;
  readonly bounds: CatPetRect;
  readonly workArea: CatPetRect;
}

/** Where the pet sat on one display, as fractions of its work area, so it survives resolution changes. */
export interface CatPetSavedSpot {
  readonly xFrac: number;
  readonly yFrac: number;
}

export interface CatPetSavedPositions {
  readonly spots: Readonly<Record<string, CatPetSavedSpot>>;
  readonly lastDisplayKey: string | null;
}

export const EMPTY_CAT_PET_POSITIONS: CatPetSavedPositions = { spots: {}, lastDisplayKey: null };

const EDGE = 24;

/** A display's id is not stable across reboots everywhere, so its label and shape name it. */
export function catPetDisplayKey(display: CatPetDisplay): string {
  const { width, height } = display.bounds;
  return display.label.trim() !== ""
    ? display.label.trim()
    : `${width}x${height}@${display.scaleFactor}`;
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

export function clampToArea(
  point: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  area: CatPetRect,
): { readonly x: number; readonly y: number } {
  return {
    x: clampNumber(point.x, area.x, area.x + area.width - size.width),
    y: clampNumber(point.y, area.y, area.y + area.height - size.height),
  };
}

/** The display under a point, or the nearest one. */
export function displayAt(
  point: { readonly x: number; readonly y: number },
  displays: readonly CatPetDisplay[],
): CatPetDisplay | null {
  let best: CatPetDisplay | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    const dx = Math.max(x - point.x, 0, point.x - (x + width));
    const dy = Math.max(y - point.y, 0, point.y - (y + height));
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Where the pet's box goes: the saved spot on the display she last used if it is still there,
 * else the primary display's saved spot, else its bottom-right corner.
 */
export function resolveCatPetPosition(
  saved: CatPetSavedPositions,
  displays: readonly CatPetDisplay[],
  primary: CatPetDisplay,
  size: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  const byKey = new Map(displays.map((display) => [catPetDisplayKey(display), display] as const));
  const last = saved.lastDisplayKey === null ? undefined : byKey.get(saved.lastDisplayKey);
  const display = last ?? primary;
  const spot = saved.spots[catPetDisplayKey(display)];
  const area = display.workArea;
  if (spot === undefined) {
    return clampToArea(
      {
        x: area.x + area.width - size.width - EDGE,
        y: area.y + area.height - size.height - EDGE,
      },
      size,
      area,
    );
  }
  return clampToArea(
    {
      x: area.x + spot.xFrac * Math.max(1, area.width - size.width),
      y: area.y + spot.yFrac * Math.max(1, area.height - size.height),
    },
    size,
    area,
  );
}

/** Records where she dropped the pet, on the display under its centre. */
export function rememberCatPetPosition(
  saved: CatPetSavedPositions,
  box: CatPetRect,
  displays: readonly CatPetDisplay[],
): { readonly saved: CatPetSavedPositions; readonly clamped: { x: number; y: number } } {
  const display = displayAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, displays);
  if (display === null) return { saved, clamped: { x: box.x, y: box.y } };
  const area = display.workArea;
  const clamped = clampToArea(box, box, area);
  const fraction = (offset: number, room: number) =>
    room <= 0 ? 0 : Math.min(1, Math.max(0, offset / room));
  const key = catPetDisplayKey(display);
  return {
    saved: {
      spots: {
        ...saved.spots,
        [key]: {
          xFrac: fraction(clamped.x - area.x, area.width - box.width),
          yFrac: fraction(clamped.y - area.y, area.height - box.height),
        },
      },
      lastDisplayKey: key,
    },
    clamped,
  };
}

/** Forgets the spot on the display the pet is on, so it goes back to the corner. */
export function forgetCatPetPosition(
  saved: CatPetSavedPositions,
  displayKey: string,
): CatPetSavedPositions {
  const { [displayKey]: _dropped, ...spots } = saved.spots;
  return { spots, lastDisplayKey: displayKey };
}

const GAP = 6;

/**
 * The window around the pet and its open bubble or tray. The pet stays where it is on screen;
 * the panel goes above it when there is room, else below, kept inside the work area.
 */
export function layoutCatPetWindow(
  pet: CatPetRect,
  panel: { readonly width: number; readonly height: number } | null,
  area: CatPetRect,
): {
  readonly window: CatPetRect;
  readonly pet: { readonly x: number; readonly y: number };
  readonly panel: { readonly x: number; readonly y: number; readonly above: boolean } | null;
} {
  if (panel === null) {
    return { window: pet, pet: { x: 0, y: 0 }, panel: null };
  }
  const above = pet.y - area.y >= panel.height + GAP;
  const panelX = clampNumber(
    pet.x + pet.width / 2 - panel.width / 2,
    area.x,
    area.x + area.width - panel.width,
  );
  const panelY = above ? pet.y - GAP - panel.height : pet.y + pet.height + GAP;
  const left = Math.min(pet.x, panelX);
  const top = Math.min(pet.y, panelY);
  const right = Math.max(pet.x + pet.width, panelX + panel.width);
  const bottom = Math.max(pet.y + pet.height, panelY + panel.height);
  return {
    window: { x: left, y: top, width: right - left, height: bottom - top },
    pet: { x: pet.x - left, y: pet.y - top },
    panel: { x: panelX - left, y: panelY - top, above },
  };
}
