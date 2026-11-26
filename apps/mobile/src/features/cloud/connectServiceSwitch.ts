import { getClerkInstance } from "@clerk/expo";
import { runAtomCommand, settlePromise } from "@t3tools/client-runtime/state/runtime";
import * as Updates from "expo-updates";
import { DevSettings } from "react-native";

import { runtime } from "../../lib/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { unregisterAgentAwarenessDeviceForCurrentUser } from "../agent-awareness/remoteRegistration";
import { removeCloudEnvironments } from "./cloud-drafts";
import { resolveCloudPublicConfig, resolveRelayClerkTokenOptions } from "./publicConfig";

/**
 * Signs out of the service in use and forgets what belongs to it. The account service repeats
 * this after a sign-out, but the restart that follows would cut it short, so it runs here first.
 */
export async function leaveConnectService(): Promise<void> {
  const { clerk, relay } = resolveCloudPublicConfig();
  if (!clerk.publishableKey || !relay.url) return;
  const instance = getClerkInstance({ publishableKey: clerk.publishableKey });
  await runAtomCommand(appAtomRegistry, removeCloudEnvironments, instance.user?.id ?? null, {
    reportFailure: false,
    reportDefect: false,
  });
  const session = instance.session;
  if (!session) return;
  await settlePromise(() =>
    runtime.runPromiseExit(
      unregisterAgentAwarenessDeviceForCurrentUser(() =>
        session.getToken(resolveRelayClerkTokenOptions()),
      ),
    ),
  );
  await instance.signOut();
}

export async function restartApp(): Promise<void> {
  // Development builds have no update runtime to reload through.
  if (__DEV__) return DevSettings.reload();
  await Updates.reloadAsync();
}
