import { CatPetPlayer, type CatPetSpec, type CatPetState } from "@t3tools/shared/catPetSprite";
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";

/** One pet, drawn from its sheet with a timeout per frame. Reduced motion draws a still. */
export function CatPetSprite(props: {
  readonly spec: CatPetSpec;
  readonly sheetUrl: string;
  readonly state: CatPetState;
  readonly width: number;
  readonly reduced: boolean;
  readonly className?: string;
}) {
  const { spec, sheetUrl, state, width, reduced } = props;
  const sheetRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const scale = width / spec.cell.width;
  const height = Math.round(width * (spec.cell.height / spec.cell.width));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Steps the sprite on its own frame timers, an outside clock, and stops them on unmount.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheet === null) return;
    const player = new CatPetPlayer(
      {
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      (animation, frame) => {
        const x = -Math.round(frame * spec.cell.width * scale);
        const y = -Math.round(animation.row * spec.cell.height * scale);
        sheet.style.transform = `translate(${x}px, ${y}px)`;
      },
    );
    player.play(spec.animations[state], { reduced });
    return () => player.stop();
  }, [spec, state, scale, reduced]);

  const dim = spec.animations[state].dim === true;
  return (
    <div
      className={cn("shrink-0", props.className)}
      // Inline so the sheet is clipped to one cell even without the app stylesheet.
      style={{ position: "relative", overflow: "hidden", width, height }}
      aria-hidden
    >
      <img
        ref={sheetRef}
        src={sheetUrl}
        alt=""
        draggable={false}
        onLoad={(event) =>
          setNatural({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        className={cn("max-w-none select-none", dim && "opacity-70")}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
          width: natural === null ? undefined : Math.round(natural.width * scale),
          height: natural === null ? undefined : Math.round(natural.height * scale),
          imageRendering: spec.imageRendering === "pixelated" ? "pixelated" : "auto",
          visibility: natural === null ? "hidden" : "visible",
        }}
      />
    </div>
  );
}
