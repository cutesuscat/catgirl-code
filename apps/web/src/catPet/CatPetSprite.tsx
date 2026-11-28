import { CatPetPlayer, type CatPetSpec, type CatPetState } from "@t3tools/shared/catPetSprite";
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";

/**
 * One pet, drawn from its sheet with a timeout per frame. Reduced motion draws a still.
 * The sheet is a background stepped by position: one cell-sized box, never a sheet-sized layer.
 */
export function CatPetSprite(props: {
  readonly spec: CatPetSpec;
  readonly sheetUrl: string;
  readonly state: CatPetState;
  readonly width: number;
  readonly reduced: boolean;
  readonly className?: string;
}) {
  const { spec, sheetUrl, state, width, reduced } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<{ url: string; width: number; height: number } | null>(null);
  const scale = width / spec.cell.width;
  const height = Math.round(width * (spec.cell.height / spec.cell.width));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the sheet's pixel size from the image itself, an outside resource.
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.addEventListener("load", () => {
      if (!cancelled)
        setSheet({ url: sheetUrl, width: image.naturalWidth, height: image.naturalHeight });
    });
    image.src = sheetUrl;
    return () => {
      cancelled = true;
    };
  }, [sheetUrl]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Steps the sprite on its own frame timers, an outside clock, and stops them on unmount.
  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const player = new CatPetPlayer(
      {
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      (animation, frame) => {
        const x = -Math.round(frame * spec.cell.width * scale);
        const y = -Math.round(animation.row * spec.cell.height * scale);
        box.style.backgroundPosition = `${x}px ${y}px`;
      },
    );
    player.play(spec.animations[state], { reduced });
    return () => player.stop();
  }, [spec, state, scale, reduced]);

  const ready = sheet !== null && sheet.url === sheetUrl;
  return (
    <div
      ref={boxRef}
      className={cn("shrink-0 select-none", props.className)}
      aria-hidden
      style={{
        width,
        height,
        backgroundImage: ready ? `url("${sheetUrl}")` : undefined,
        backgroundRepeat: "no-repeat",
        backgroundSize: ready
          ? `${Math.round(sheet.width * scale)}px ${Math.round(sheet.height * scale)}px`
          : undefined,
        imageRendering: spec.imageRendering === "pixelated" ? "pixelated" : "auto",
        opacity: spec.animations[state].dim === true ? 0.7 : undefined,
      }}
    />
  );
}
