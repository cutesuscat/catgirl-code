import { ConnectServiceSettings } from "@t3tools/contracts";
import { readConnectServiceSettings } from "@t3tools/shared/connectService";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopConnectService from "../../settings/DesktopConnectService.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod, makeSyncIpcMethod } from "../DesktopIpc.ts";

export class ConnectServiceRejectedError extends Schema.TaggedError<ConnectServiceRejectedError>()(
  "ConnectServiceRejectedError",
  {},
) {
  override get message(): string {
    return "The T3 Connect service is not valid and was not saved.";
  }
}

export const getConnectService = makeSyncIpcMethod({
  channel: IpcChannels.GET_CONNECT_SERVICE_CHANNEL,
  result: Schema.NullOr(ConnectServiceSettings),
  handler: Effect.fn("desktop.ipc.connectService.get")(function* () {
    return (yield* DesktopConnectService.optional)?.current() ?? null;
  }),
});

// Saving relaunches desktop; null goes back to the service the build ships with.
export const setConnectService = makeIpcMethod({
  channel: IpcChannels.SET_CONNECT_SERVICE_CHANNEL,
  payload: Schema.NullOr(ConnectServiceSettings),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.connectService.set")(function* (requested) {
    const connectService = yield* DesktopConnectService.optional;
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    const settings = requested === null ? null : readConnectServiceSettings(requested);
    if (connectService === undefined || (requested !== null && settings === null)) {
      return yield* new ConnectServiceRejectedError();
    }
    yield* connectService.save(settings);
    yield* lifecycle.relaunch(`connectService=${settings?.source ?? "built-in"}`);
  }),
});

// A later check of the same signed service: saved in place, sign-in values unchanged, no relaunch.
export const updateConnectService = makeIpcMethod({
  channel: IpcChannels.UPDATE_CONNECT_SERVICE_CHANNEL,
  payload: ConnectServiceSettings,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.connectService.update")(function* (requested) {
    const connectService = yield* DesktopConnectService.optional;
    const settings = readConnectServiceSettings(requested);
    if (connectService === undefined || settings === null) {
      return yield* new ConnectServiceRejectedError();
    }
    if (!(yield* connectService.update(settings))) return yield* new ConnectServiceRejectedError();
  }),
});
