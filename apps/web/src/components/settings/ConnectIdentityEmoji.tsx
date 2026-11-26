/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Connect version 2, English only: upstream's catalogs stay untouched */
import { connectFingerprintEmoji } from "@t3tools/shared/connectFingerprintEmoji";

import { cn } from "../../lib/utils";

/**
 * A Connect service's identity as Matrix shows a key: emoji large enough to compare, each name
 * under its emoji, then the hex fingerprint a setup link carries. Two rows of four when narrow.
 */
export function ConnectIdentity({
  fingerprint,
  compact = false,
  className,
}: {
  readonly fingerprint: string;
  /** Smaller emoji, for lists such as "Recent changes". */
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const row = connectFingerprintEmoji(fingerprint);
  return (
    <div
      data-testid="connect-identity"
      className={cn("@container/connect-identity flex w-full min-w-0 flex-col gap-1", className)}
    >
      {row === null ? null : (
        <ol
          aria-label="Identity"
          className="grid w-fit grid-cols-4 gap-x-1 gap-y-2 @min-[34rem]/connect-identity:grid-cols-8"
        >
          {row.map(({ emoji, name }, position) => (
            // oxlint-disable-next-line react/no-array-index-key -- 8 fixed cells that never move, and an emoji can repeat
            <li key={`${position}-${name}`} className="flex w-16 flex-col items-center gap-0.5">
              <span
                aria-hidden="true"
                className={cn("leading-none", compact ? "text-lg" : "text-3xl")}
              >
                {emoji}
              </span>
              <span className="text-center text-xs leading-tight text-muted-foreground">
                {name}
              </span>
            </li>
          ))}
        </ol>
      )}
      <code
        data-testid="connect-fingerprint"
        className={cn(
          "font-mono text-xs",
          row === null ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {fingerprint}
      </code>
    </div>
  );
}

/** Inside a sentence: the emoji alone, with their names for a screen reader, and the hex. */
export function ConnectIdentityInline({ fingerprint }: { readonly fingerprint: string }) {
  const row = connectFingerprintEmoji(fingerprint);
  return (
    <span data-testid="connect-identity-inline" className="whitespace-nowrap">
      {row === null ? null : (
        <span role="img" aria-label={row.map(({ name }) => name).join(", ")}>
          {row.map(({ emoji }) => emoji).join("")}
        </span>
      )}{" "}
      <code data-testid="connect-fingerprint" className="font-mono">
        {fingerprint}
      </code>
    </span>
  );
}
