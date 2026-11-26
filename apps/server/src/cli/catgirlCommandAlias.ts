import {
  CATGIRL_COMMAND,
  CATGIRL_COMMAND_ALIASES,
  CATGIRL_COMMAND_ALIASES_ENV,
} from "@t3tools/shared/catgirlRelease";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

// Catgirl Code: `catgirlcode` and `catgirl-code` are links to the `catcode` launcher beside them,
// so they follow it through every update. Windows gets a one-line `.cmd` instead (untested; no
// Windows build ships). Only an alias exactly like that is ours; anything else there is not.
const WINDOWS_ALIAS = `@"%~dp0${CATGIRL_COMMAND}.cmd" %*\r\n`;

const aliasesBeside = Effect.fn("cli.command_alias.beside")(function* (launcher: string) {
  const path = yield* Path.Path;
  const windows = (yield* HostProcess.Platform) === "win32";
  if (path.parse(launcher).name !== CATGIRL_COMMAND) return [];
  return CATGIRL_COMMAND_ALIASES.map((name) =>
    path.join(path.dirname(launcher), windows ? `${name}.cmd` : name),
  );
});

const isOurAlias = Effect.fn("cli.command_alias.is_ours")(function* (alias: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* HostProcess.Platform) === "win32"
    ? yield* fs.readFileString(alias).pipe(
        Effect.map((text) => text === WINDOWS_ALIAS),
        Effect.orElseSucceed(() => false),
      )
    : yield* fs.readLink(alias).pipe(
        Effect.map((target) => target === CATGIRL_COMMAND),
        Effect.orElseSucceed(() => false),
      );
});

/** Makes the aliases beside a `catcode` launcher that `catcode install` or `update` wrote. */
export const writeCommandAliases = Effect.fn("cli.command_alias.write")(function* (
  launcher: string,
) {
  const fs = yield* FileSystem.FileSystem;
  if ((yield* HostProcess.Environment)[CATGIRL_COMMAND_ALIASES_ENV]?.trim() === "0") return;
  const windows = (yield* HostProcess.Platform) === "win32";
  for (const alias of yield* aliasesBeside(launcher)) {
    if (yield* isOurAlias(alias)) continue;
    const taken =
      (yield* fs.exists(alias).pipe(Effect.orElseSucceed(() => true))) ||
      (yield* fs.readLink(alias).pipe(Effect.isSuccess));
    if (taken) {
      yield* Console.error(`Left ${alias}, which is not ours.`);
      continue;
    }
    yield* (
      windows
        ? fs.writeFileString(alias, WINDOWS_ALIAS, { flag: "wx" })
        : fs.symlink(CATGIRL_COMMAND, alias)
    ).pipe(Effect.catch(() => Console.error(`Could not make ${alias}.`)));
  }
});

/** The aliases beside `launcher` that are ours, which go with it. */
export const ownedCommandAliases = Effect.fn("cli.command_alias.owned")(function* (
  launcher: string,
) {
  return yield* Effect.filter(yield* aliasesBeside(launcher), isOurAlias);
});
