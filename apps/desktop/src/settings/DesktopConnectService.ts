import { ConnectServiceSettings } from "@t3tools/contracts";
import {
  connectServiceEnvironment,
  connectServiceNeedsRestart,
  parseConnectServiceSettings,
  readConnectServiceSettings,
} from "@t3tools/shared/connectService";
import { clerkFrontendApiHostnameFromPublishableKey } from "@t3tools/shared/relayAuth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export class DesktopConnectServiceWriteError extends Schema.TaggedError<DesktopConnectServiceWriteError>()(
  "DesktopConnectServiceWriteError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not save the T3 Connect service at ${this.path}.`;
  }
}

/**
 * The T3 Connect service this device saved in place of the build's. Read once at startup: the
 * window's security policy, the sign-in library and the local server all take it at launch,
 * so a change applies by relaunching.
 */
export class DesktopConnectService extends Context.Service<
  DesktopConnectService,
  {
    readonly saved: ConnectServiceSettings | null;
    /** Undefined when nothing is saved, so callers fall back to the build's hostname. */
    readonly clerkFrontendApiHostname: string | undefined;
    readonly backendEnvironment: Readonly<Record<string, string>>;
    readonly save: (
      settings: ConnectServiceSettings | null,
    ) => Effect.Effect<void, DesktopConnectServiceWriteError>;
    /** What a renderer reads now: the startup record plus later checks of its signed document. */
    readonly current: () => ConnectServiceSettings | null;
    /** Saves a later check of the same service. Refused when it would change sign-in values. */
    readonly update: (
      settings: ConnectServiceSettings,
    ) => Effect.Effect<boolean, DesktopConnectServiceWriteError>;
  }
>()("@t3tools/desktop/settings/DesktopConnectService") {}

const encodeSettingsJson = Schema.encodeEffect(Schema.fromJsonString(ConnectServiceSettings));

const hostnameOf = (saved: ConnectServiceSettings | null): string | undefined => {
  if (saved === null) return undefined;
  try {
    return clerkFrontendApiHostnameFromPublishableKey(saved.clerkPublishableKey);
  } catch {
    return undefined;
  }
};

const of = (
  saved: ConnectServiceSettings | null,
  methods: Pick<DesktopConnectService["Service"], "save" | "current" | "update">,
) =>
  DesktopConnectService.of({
    saved,
    clerkFrontendApiHostname: hostnameOf(saved),
    backendEnvironment: connectServiceEnvironment(saved),
    ...methods,
  });

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const settingsPath = environment.path.join(environment.stateDir, "connect-service.json");

  // An unreadable or invalid file means "nothing saved", so a bad value can never block startup.
  const saved = yield* fileSystem.readFileString(settingsPath).pipe(
    Effect.map((raw) => readConnectServiceSettings(parseConnectServiceSettings(raw))),
    Effect.orElseSucceed(() => null),
  );

  const write = (settings: ConnectServiceSettings | null) => {
    const tempPath = `${settingsPath}.${process.pid}.tmp`;
    const written =
      settings === null
        ? fileSystem.remove(settingsPath, { force: true })
        : encodeSettingsJson(settings).pipe(
            Effect.tap(() => fileSystem.makeDirectory(environment.stateDir, { recursive: true })),
            Effect.flatMap((json) => fileSystem.writeFileString(tempPath, `${json}\n`)),
            Effect.andThen(fileSystem.rename(tempPath, settingsPath)),
            Effect.ensuring(fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore)),
          );
    return written.pipe(
      Effect.mapError(
        (cause) => new DesktopConnectServiceWriteError({ path: settingsPath, cause }),
      ),
    );
  };
  let current = saved;

  return of(saved, {
    save: Effect.fn("desktop.connectService.save")(function* (settings) {
      yield* write(settings);
    }),
    current: () => current,
    update: Effect.fn("desktop.connectService.update")(function* (settings) {
      if (connectServiceNeedsRestart(saved, settings)) return false;
      yield* write(settings);
      current = settings;
      return true;
    }),
  });
});

export const layer = Layer.effect(DesktopConnectService, make);

/**
 * For code whose own tests build no settings layers. The app provides this service in the same
 * layer as its other settings, so it is missing only in those tests, where nothing is saved.
 */
export const optional = Effect.serviceOption(DesktopConnectService).pipe(
  Effect.map(Option.getOrUndefined),
);
