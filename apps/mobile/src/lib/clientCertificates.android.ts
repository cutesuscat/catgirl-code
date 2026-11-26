import { requireOptionalNativeModule } from "expo";

import type {
  ClientCertificateChoice,
  ClientCertificateSubscription as Subscription,
  ClientCertificateTransferInput,
} from "./clientCertificates.types";

interface CertificateModule {
  getAlias(url: string): string | null;
  choose(url: string, alias: string | null): Promise<string | null>;
  listChoices(): ReadonlyArray<ClientCertificateChoice>;
  restore(url: string, alias: string): Promise<boolean>;
  remove(url: string): Promise<void>;
  createTransfer(url: string): string;
  transfer(
    id: string,
    fileUri: string,
    upload: boolean,
    contentType: string,
  ): Promise<{ status: number }>;
  cancel(id: string): void;
  addListener(
    name: "transferProgress",
    listener: (event: { id: string; bytesSent: number; totalBytes: number }) => void,
  ): Subscription;
  addListener(name: "changed", listener: (event: { origin: string }) => void): Subscription;
}

// Android installs the transport in MainApplication before Expo/React Native create clients.
// Preferences are read natively, so cold-start reconnect does not race JS hydration.
const native = requireOptionalNativeModule<CertificateModule>("T3ClientCertificates");

export const clientCertificatesAvailable = native !== null;
export const selectedClientCertificate = (url: string): string | null =>
  native?.getAlias(url) ?? null;
export const onClientCertificateChange = (listener: () => void): Subscription =>
  native?.addListener("changed", listener) ?? { remove() {} };
/** `alias` is offered first in the system picker when no choice is saved for `url` yet. */
export const chooseClientCertificate = (
  url: string,
  alias: string | null = null,
): Promise<string | null> => {
  if (!native)
    return Promise.reject(new Error("Client certificates require the Android custom build."));
  return native.choose(url, alias);
};
/** Every saved choice: the address it is for and the certificate's name, never the certificate. */
export const clientCertificateChoices = (): ReadonlyArray<ClientCertificateChoice> =>
  native?.listChoices() ?? [];
/** Saves a choice without asking when Android already lets this app use that certificate. */
export const restoreClientCertificate = (url: string, alias: string): Promise<boolean> =>
  native?.restore(url, alias) ?? Promise.resolve(false);
export const removeClientCertificate = (url: string): Promise<void> => {
  if (!native)
    return Promise.reject(new Error("Client certificates require the Android custom build."));
  return native.remove(url);
};

/** Returns null for ordinary destinations; callers retain their existing Expo transfer path. */
export async function transferWithClientCertificate(
  input: ClientCertificateTransferInput,
): Promise<{ status: number } | null> {
  if (!native || !selectedClientCertificate(input.url)) return null;
  if (input.signal.aborted) throw new Error("Transfer cancelled.");
  const id = native.createTransfer(input.url);
  const cancel = () => native.cancel(id);
  let subscription: Subscription | null = null;
  try {
    subscription = input.onProgress
      ? native.addListener("transferProgress", (event) => {
          if (event.id === id && event.totalBytes > 0)
            input.onProgress?.(event.bytesSent / event.totalBytes);
        })
      : null;
    input.signal.addEventListener("abort", cancel, { once: true });
    if (input.signal.aborted) throw new Error("Transfer cancelled.");
    const result = await native.transfer(
      id,
      input.fileUri,
      input.upload ?? false,
      input.contentType ?? "application/octet-stream",
    );
    if (input.signal.aborted) throw new Error("Transfer cancelled.");
    return result;
  } finally {
    input.signal.removeEventListener("abort", cancel);
    native.cancel(id);
    subscription?.remove();
  }
}
