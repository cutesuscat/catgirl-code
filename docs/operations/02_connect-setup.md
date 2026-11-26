# T3 Connect setup

Deployment and client configuration for T3 Connect. See [T3 Connect](../internals/06_t3-connect.md) for trust boundaries and [infra/relay/README.md](../../infra/relay/README.md#deployment) for relay provisioning.

## Public application configuration

T3 Connect is disabled in a fresh clone. Copy `.env.example` to `.env` for production, or set these public identifiers in `.env` / `.env.local` (process env > `.env.local` > `.env`):

```dotenv
T3CODE_CLERK_PUBLISHABLE_KEY=<publishable key>
T3CODE_CLERK_JWT_TEMPLATE=<JWT template name>
T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=<public OAuth application client ID>
T3CODE_RELAY_URL=https://relay.example.com
```

`CLERK_SECRET_KEY` belongs only in relay secrets, never in client config. Client and bundled-server builds embed these values at build time; EAS preview/production environments need the publishable key, JWT template, and relay URL.

### Changing the service without a rebuild

The built-in values are a default. Each app can save its own service under **Settings > Connections > T3 Connect service** (mobile: **Settings > T3 Connect service**), which replaces all four values on that device until it is reset. The app reads the saved service once at startup, so saving signs out of the old service and restarts the app; a saved value the app cannot read is ignored, never an error. The desktop app also hands its saved service to its local server through the `T3CODE_*` variables above. A standalone server needs none of them when it is linked from an app, which gives it the relay address; only `t3 connect` on the machine itself reads them, from the environment, the service saved with `t3 connect --relay` (below), or the build.

Saving takes one address. The app checks that `/.well-known/oauth-authorization-server` there names the same address as its `issuer`, then reads the sign-in values from the relay:

```http
GET /.well-known/t3-connect.json
```

```json
{
  "version": 1,
  "relayUrl": "https://relay.example.com",
  "clerk": {
    "publishableKey": "pk_live_...",
    "jwtTemplate": "t3-relay",
    "cliOAuthClientId": "..."
  }
}
```

`relayUrl` must equal the address the document was fetched from, and `cliOAuthClientId` may be absent. New optional fields keep `version` at 1; a change an older app cannot read raises it, and that app then asks for the values by hand, as it does on a 404. The relay serves the document once it is deployed with `CLERK_JWT_TEMPLATE` (and optionally `CLERK_CLI_OAUTH_CLIENT_ID`); see [`infra/relay/.env.example`](../../infra/relay/.env.example). Everything in it is a public identifier.

### Signed service document (Catgirl Connect version 2)

Apps and machines read `GET /.well-known/catgirl-connect.json` first and fall back to version 1 above. It is an envelope `{ payload, signature, key }`: the payload's UTF-8 bytes in base64url, an Ed25519 signature over exactly those bytes, and the 32-byte public key. Apps check the signature before reading the payload, then that `version` is 2, `relayUrl` is the address it came from, and `expiresAt` is at most 60 days after `issuedAt` and not past. The schema is `ConnectDocumentPayload` in `packages/contracts/src/connectService.ts`; the checks are in `packages/shared/src/connectDocument.ts`.

- **Pinning.** Saving a service pins its key; the app shows the fingerprint (first 16 hex of SHA-256 over the key, in groups of four). A setup link `https://<relay>/#fp=<16 hex>` (or the same link as a QR code) must match, or nothing is saved.
- **Emoji.** Every surface also shows the fingerprint as 8 emoji with their names: the first 48 bits of the same digest, 6 bits each, from a table based on Matrix's SAS emoji with the cat 🐈 at 0 (`packages/shared/src/connectFingerprintEmoji.ts`). Keys the relay's deploy generates start with the cat, so by eye only the other 7 (42 bits) tell instances apart. That is for people comparing; apps compare whole keys, and setup links keep the 64-bit check.
- **Later checks** (Save, app start at most daily, server start) apply a document from the pinned key, or from a new key whose `keyRotation.endorsement` the pinned key signed. Any other key changes nothing: the app keeps the last good document and asks; a machine warns, and `t3 connect --relay <address>` asks. Sign-in changes apply on restart.
- **Diagnostics are offers.** Usage data is a per-machine yes (Settings > Diagnostics > Usage analytics, `observability.connectAnalytics`), connection traces a per-phone yes; each then sends with a token from `POST /v1/collect/token`, asked for with the device's or machine's existing Connect credential. Every existing "no" still wins. Phone crash reports keep their compiled address.
- **Machines.** `t3 connect --relay <address or setup link>` checks and saves the service in `<T3 home>/userdata/connect-service.json`, the file the desktop app writes; environment variables still win over it. `--relay none` removes it. Without `signIn.hostedAppUrl`, machines sign in with a code.

Nothing in a document chooses where code is downloaded from or turns data collection on.

## Clerk setup

### CLI OAuth application

Create a public OAuth application in Clerk (authorization code + PKCE):

1. Redirect URI: `http://127.0.0.1:34338/callback`
2. Scopes: `openid`, `profile`, `email`, `offline_access`
3. Enable **Device authorization grant** (required for headless/SSH login; Clerk enables it per account on request).
4. Set `T3CODE_CLERK_CLI_OAUTH_CLIENT_ID` to its public client ID.

### JWT template

Create a Clerk JWT template named `t3-relay` with `{ "aud": "t3-code-relay" }`. Set `T3CODE_CLERK_JWT_TEMPLATE=t3-relay` on clients and `CLERK_JWT_AUDIENCE=t3-code-relay` on the relay.

### Desktop OAuth redirects

Enable Clerk's Native API, add `t3code-dev://app/` and `t3code://app/` to the SSO redirect allowlist, and add `t3code-dev://app` and `t3code://app` to `allowed_origins` via `PATCH https://api.clerk.com/v1/instance` (preserving existing entries).

### Android native sign-in redirects

In Clerk **Native applications > Allowlist for mobile SSO redirect**, allow each variant's callback:

| Variant     | Callback                                      |
| ----------- | --------------------------------------------- |
| Development | `clerk://com.t3tools.t3code.dev.callback`     |
| Preview     | `clerk://com.t3tools.t3code.preview.callback` |
| Production  | `clerk://com.t3tools.t3code.callback`         |

### Restricting sign-ups

Use Clerk's allowlist or Restricted mode for new sign-ups (an enabled empty allowlist blocks all sign-ups). Ban the account in Clerk to revoke existing sessions.

### Account deletion webhook

Under Clerk **Webhooks**, add an endpoint at `https://<relay domain>/v1/webhooks/clerk` subscribed to `user.deleted`, and set its signing secret as `CLERK_WEBHOOK_SIGNING_SECRET` on the relay. Deleting a user in Clerk then records the deletion, and the relay's five-minute cron tears down their managed tunnels and deletes their relay rows, retrying until a pass succeeds after the user's relay tokens have expired. Each deletion is a row in `relay_account_deletions`: pending while `completed_at` is null (`attempts` climbing means it keeps failing), then kept as the record of which account was deleted and when. Before restoring the relay database from a backup, export `relay_account_deletions`: the backup may predate some requests. After the restore, insert the exported rows that are missing, then set `completed_at` back to null on every row so the restored data is deleted again. Without the secret the route answers 404.

## Android FCM push setup

The relay sends Android push notifications directly via FCM HTTP v1 (no Expo Push account required):

1. Register each Android package (`com.t3tools.t3code.{dev,preview}` / `com.t3tools.t3code`) in Firebase and download `google-services.json`.
2. Pass `T3CODE_ANDROID_GOOGLE_SERVICES_FILE=/abs/path/google-services.json` when prebuilding/building locally or as an EAS file variable (available to fingerprint generation as well).
3. Enable the FCM API and store the Firebase service-account JSON only in the relay's `FCM_SERVICE_ACCOUNT` secret (never in EAS app env or the repo). Set `APNS_ENABLED=false` for an Android-only relay stage.
4. For local smoke/watch verification without deploying a relay, use `vp run push:android:smoke` and `vp run push:android:watch` from `infra/relay`.

## Desktop passkeys

For a signed macOS build (`com.t3tools.t3code`):

1. Create an explicit macOS App ID with **Associated Domains** and a matching distribution provisioning profile.
2. In Clerk Native API settings, add an iOS app with the same Apple Team ID and bundle ID, and verify `https://<frontend-api>/.well-known/apple-app-site-association` includes `<TEAM_ID>.com.t3tools.t3code`.
3. Configure signing per [Apple signing and notarization](./03_release.md#apple-signing-and-notarization-macos). Local signed builds use `T3CODE_APPLE_TEAM_ID`, `T3CODE_MACOS_PROVISIONING_PROFILE`, and optionally `T3CODE_CLERK_PASSKEY_RP_DOMAINS`. Bump the build version after changing Associated Domains so macOS refreshes cached Shared Web Credentials.

Unsigned `dev:desktop` cannot exercise passkeys. For renderer HMR with passkeys, launch an installed signed build against `vp run dev:web`:

```sh
VITE_DEV_SERVER_URL=http://127.0.0.1:5733 T3CODE_PORT=13773 \
  "/Applications/T3 Code (Alpha).app/Contents/MacOS/T3 Code (Alpha)"
```
