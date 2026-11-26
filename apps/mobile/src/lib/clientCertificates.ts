import type {
  ClientCertificateChoice,
  ClientCertificateSubscription,
  ClientCertificateTransferInput,
} from "./clientCertificates.types";

// Client certificates are Android-only (clientCertificates.android.ts). Elsewhere every
// destination keeps its existing transport.
const unsupported = () =>
  Promise.reject(new Error("Client certificates are only supported on Android."));

export const clientCertificatesAvailable = false;
export const selectedClientCertificate = (_url: string): string | null => null;
export const onClientCertificateChange = (
  _listener: () => void,
): ClientCertificateSubscription => ({
  remove() {},
});
export const chooseClientCertificate = (
  _url: string,
  _alias: string | null = null,
): Promise<string | null> => unsupported();
export const clientCertificateChoices = (): ReadonlyArray<ClientCertificateChoice> => [];
export const restoreClientCertificate = (_url: string, _alias: string): Promise<boolean> =>
  Promise.resolve(false);
export const removeClientCertificate = (_url: string): Promise<void> => unsupported();
export const transferWithClientCertificate = async (
  _input: ClientCertificateTransferInput,
): Promise<{ status: number } | null> => null;
