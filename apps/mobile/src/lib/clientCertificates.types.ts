export interface ClientCertificateSubscription {
  remove(): void;
}

export interface ClientCertificateChoice {
  /** `https://host/`, or `https://*.parent/` for every machine under a domain. */
  readonly origin: string;
  readonly alias: string;
}

export interface ClientCertificateTransferInput {
  readonly url: string;
  readonly fileUri: string;
  readonly upload?: boolean;
  readonly contentType?: string;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}
