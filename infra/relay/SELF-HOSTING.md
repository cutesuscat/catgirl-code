# Hosting your own Catgirl Connect instance

Catgirl Connect is the relay that lets the apps reach your machines. Anyone can run one. An
instance publishes one signed document at `https://<relay>/.well-known/catgirl-connect.json`
that tells the apps everything instance-specific: its name, how to sign in, and which
diagnostics it offers to collect. People add your instance in the app with its address, or
with a setup link that also carries your key's fingerprint.

## What you need

| Thing                                            | Needed for                                                                            | Cost                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A Cloudflare account                             | Everything: the relay is a Cloudflare Worker                                          | Free plan works (see the limits below)                                                                                                        |
| A Clerk application                              | Signing in from the apps and from `t3 connect`                                        | Free Hobby plan: 50,000 monthly retained users ([clerk.com/pricing](https://clerk.com/pricing))                                               |
| A Postgres database the internet can reach       | Linking machines, notifications, anything with an account                             | Neon's free plan: 1 GB storage and 100 compute hours a month per project ([neon.com/pricing](https://neon.com/pricing)). Optional for a trial |
| A domain on your Cloudflare account              | Machines reached through Cloudflare tunnels, and a nicer address than `*.workers.dev` | A domain costs about $10 a year to register; Cloudflare DNS and tunnels are free. Optional                                                    |
| Node 26 and pnpm on the computer you deploy from | Running the deploy command                                                            | Free                                                                                                                                          |
| An Apple Developer account                       | Push notifications to iPhones only                                                    | $99 a year. Optional                                                                                                                          |
| A Firebase project                               | Push notifications to Android phones only                                             | Free. Optional                                                                                                                                |
| An Axiom account                                 | The relay's own request traces and alerts                                             | Personal plan free: 500 GB a month ingest, 30 days kept ([axiom.co/pricing](https://axiom.co/pricing)). Optional; off by default              |

What the deploy creates on Cloudflare, and the free plan's daily limits that matter
([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)):

| Resource                                                             | Free plan                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The relay Worker                                                     | 100,000 requests a day, 10 ms CPU per request, 3 MB compressed script (this one is about 2 MB) |
| Two SQLite Durable Objects (held webhooks; collected diagnostics)    | 5 GB storage in total, 1 GB per object                                                         |
| Four Queues (phone notification delivery and dead letters)           | 10,000 operations a day                                                                        |
| Hyperdrive, only with a database                                     | 100,000 queries a day                                                                          |
| Rate limits, a 5-minute cron, a scoped API token for tunnels and DNS | Included                                                                                       |
| A state-store Worker, `catgirl-connect-state`                        | Holds the deploy state, including your signing key                                             |

The free plan's 10 ms CPU limit has not been measured against this relay; if requests fail with
"exceeded CPU", the Workers Paid plan ($5 a month) lifts it.

The Cloudflare API token needs, for the account: Workers Scripts Edit, Queues Edit, Hyperdrive
Edit, Cloudflare Tunnel Edit, Account API Tokens Edit (the deploy makes a narrower token for the
Worker), Secrets Store Edit (for the state store), Account Settings Read; the token that deployed
the first instance also had Workers KV Storage Edit. With a domain, for that zone: Zone Read,
DNS Edit, Workers Routes Edit.

## Clerk

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. API keys: copy the publishable key and the secret key.
3. JWT templates: add one named `t3-relay` whose claims include `"aud": "t3-code-relay"`.
4. Optional, for `t3 connect` in a terminal: an OAuth application; copy its client ID.

A development instance (`pk_test_...`) works in every app. A production instance (`pk_live_...`)
only works in a browser on its own domain. More in
[the Connect setup notes](../../docs/operations/02_connect-setup.md).

## Deploy

```sh
pnpm install                                  # once, from the repository root
cd infra/relay
cp selfhost.env.example .env.selfhost        # then fill it in
node scripts/self-host.ts deploy --smoke
```

The command checks the inputs, applies the database migrations, deploys, then fetches your
document and checks its signature the way the apps do. `--smoke` also sends one test event
through the collectors. It ends with:

```
Instance     https://catgirl-connect.<you>.workers.dev
Service      My cats
Fingerprint  3f2a 91bc 0d4e 77aa
Setup link   https://catgirl-connect.<you>.workers.dev/#fp=3f2a91bc0d4e77aa
Operator     https://catgirl-connect.<you>.workers.dev/operator (...)
```

Give people the setup link (or its QR code). The app shows your instance's name and fingerprint
before anyone trusts it, and refuses a different key than the link names.

`--trial` deploys without a database or Clerk secret key: the document, the collectors and the
operator page work, and sign-in and machine links are refused until you add them and deploy
again. `--dry-run` shows what would be created. `node scripts/self-host.ts status` checks a
running instance; deploying again with the same inputs changes nothing.

### An existing database

Migrations are recorded in the table `catgirl_relay_migrations`. A database that already has
the relay's tables from another deploy tool needs to be told how far it is:
`deploy --baseline <migration folder name>` marks every migration up to that one as applied
without running it.

## The signing key

The deploy generates an Ed25519 key once and keeps it in the state store; your fingerprint
stays the same across deploys. To rotate it, raise `CONNECT_SIGNING_KEY_GENERATION` by one and
deploy: the document is then signed by the new key and endorsed by the old one, and apps move to
the new key by themselves. Apps that missed a whole generation see "identity changed" and ask
their owner. To bring an existing key, set `CONNECT_SIGNING_KEY` (64 hex digits or base64url of
the 32-byte seed).

If the state store is lost, the next deploy makes a new key, and everyone sees "identity
changed". `RELAY_STATE=local` keeps the state in `infra/relay/.alchemy` instead; then back that
folder up.

## Diagnostics

The document offers three collectors; none of them is ever switched on by the document. Each
person decides per device whether to send usage data, crash reports or traces to you.

- `POST /v1/collect/token`: a signed-in app or machine trades the credential it already holds
  for a one-hour write key (`{ "token", "expiresAt" }`). Rate-limited per account.
- `POST /v1/collect/analytics` (and `/batch/`): PostHog batch JSON, as the server sends it. The
  write key goes in `Authorization: Bearer` or in the body's `api_key`.
- `POST /v1/collect/otlp/v1/{logs,traces,metrics}` and `/v1/collect/otlp/<project>/v1/<signal>`:
  OTLP/HTTP JSON, as the phone's crash reporter and OpenTelemetry exporters send it.

What is stored: the random install or device id the sender already puts in its events, a UTC
day, the event or record name, the app version, and the payload capped at 2 KB (usage), 8 KB
(crash reports) or 1 KB (traces and metrics), with fields that could name an account removed.
Never the account, the machine, or the write key. Rows older than 30 days are deleted daily;
at most 20,000 rows a day are kept (`CONNECT_COLLECT_MAX_ROWS_PER_DAY`).
`CONNECT_DIAGNOSTICS=none` removes the offers and the collectors.

## The operator page

`https://<relay>/operator` shows counts per day, kind, event and app version. Your browser asks
for a password: any user name, and the key the deploy saved in
`infra/relay/.alchemy/self-host/<stage>/operator-key`. `/operator/summary.json` is the same as
JSON. Without that file the page does not exist.

## t3gate mode

Set `T3GATE_SECRET`, `T3GATE_GATE` and `T3GATE_PROXY_IP` (and optionally `T3GATE_PINS`,
`T3GATE_TRUSTED`, `T3GATE_MAX_TUNNELS`) to reach machines through your own TLS gateway instead
of Cloudflare tunnels, so Cloudflare never terminates their traffic. The relay then hands
machines t3gate tokens and points their hostnames at the gateway with DNS-only A records. It
needs a domain. Unset, the relay uses Cloudflare tunnels.

## Update and remove

Update: pull, `pnpm install`, deploy again. Remove: `node scripts/self-host.ts destroy`, which
deletes everything the deploy created except the state-store Worker; delete
`catgirl-connect-state` and its two secrets (Secrets Store, named after it) in the dashboard.
