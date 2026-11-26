<p align="center">
  <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="Catgirl Code icon: an orange cat-head planet with three small moons" />
</p>

<h1 align="center">Catgirl Code</h1>

<p align="center">A personal, unofficial fork of T3 Code.</p>

> [!IMPORTANT]
> **Catgirl Code is not T3 Code.** It is an unofficial fork based on the T3 Code source code. It is not affiliated with, endorsed by, maintained by or supported by T3 Tools, Inc. Please do not report its problems to T3 Code.
>
> The official project is [github.com/pingdotgg/t3code](https://github.com/pingdotgg/t3code).

Catgirl Code runs the coding agents on your machines and gives them one interface on the desktop, the web and the phone. All of that is T3 Code's work. This fork changes a few things for one person's setup and publishes its own builds so those machines never pick up another project's.

## What is different

- **Its own builds.** The apps install and update the server from this repository's [releases](../../releases), never from T3 Code's releases or its npm package.
- **Nothing is reported by default.** Usage analytics, connection traces, crash reports and the sign-in library's own telemetry are off until you turn them on. [What a build sends](./docs/user/telemetry.md) has the list.
- **A busy machine is not updated under you.** When an app would replace an older server it started over SSH and that server has threads running, it keeps the server and updates it on a later connection, once the machine is idle.
- **The phone can reach a machine over SSH**, and present a client certificate, on Android.
- **Your own Connect service.** The relay and sign-in service are a setting, not a constant.
- **A different look.** Its own name and icon, and your machines as cat planets in the sidebar.

The server's command is `catcode` (`catgirlcode` and `catgirl-code` work too), and it keeps its state in `~/.catcode`. The first time it runs on a machine it moves an older `~/.t3` there and leaves `~/.t3` as a link to it, so threads, projects and worktrees carry over and a T3 Code server sharing the machine finds them too. An older `t3` command is left as it is.

## Versions

A release is named after the T3 Code release it is based on, with a letter for the fork's own build: the first build on T3 Code 0.1.12 is **0.1.12a**, the second **0.1.12b**, and after **0.1.12z** comes **0.1.12aa**. That is what the apps, Settings › About and the release titles show.

Machines need a number that sorts above T3 Code's own 0.1.12, so underneath each release has a plain version too: 0.1.12a is **1.12.1** and 0.1.12b is **1.12.2** (the T3 Code release's minor and patch, then the build). The release tag is that plain version, `v1.12.1`, and so are the server archive's name, `catcode --version` and the version `catcode update` takes. Each release's notes give both.

## Install

Everything is on the [releases page](../../releases). Nothing here is signed or notarized.

### Mac

Download `Catgirl-Code-<version>-arm64.dmg` (Apple Silicon, for example `Catgirl-Code-0.1.12a-arm64.dmg`), open it and drag the app to Applications. macOS blocks an unsigned app the first time, so run this once:

```bash
xattr -cr "/Applications/Catgirl Code.app"
```

The Mac app does not update itself: an unsigned app cannot install an update. Download the next version the same way.

### Android

Download the `.apk` from the release and open it. Android asks once whether your browser may install apps. Later versions install over the old one.

### A server on a Linux machine or a Mac

You usually do not need to. Add the machine in the Mac or Android app with **Connect over SSH**, and the app downloads the server onto it and starts it.

To install it by hand, or to use the web app without a desktop app:

```bash
curl -fsSL https://github.com/cutesuscat/catgirl-code/releases/latest/download/install.sh | sh
```

This installs the `catcode` command under `~/.catcode` and `~/.local/bin`, with `catgirlcode` and `catgirl-code` as links to it (`T3CODE_INSTALL_ALIASES=0` leaves them out). Run `catcode` to start the server and open the web app. Later, `catcode update` moves the machine to the newest release. The installer needs only `sh`, `tar`, and `curl` or `wget`. Every release has a Linux x64 archive; Linux arm64 and Apple Silicon archives are attached when their builds pass.

### Moving a machine from T3 Code, or from Catgirl Code 0.1.12c or older

Their `t3 update` looks for archives named `t3-…`, and releases from 0.1.12d on are named `catcode-…`, so it reports that no release archive was published, even pointed at this repository (`T3CODE_RELEASE_BASE_URL=https://github.com/cutesuscat/catgirl-code/releases/download t3 update <version>`, which moved machines up to 0.1.12c). Run the installer above instead: it installs `catcode` beside the old `t3`, moves `~/.t3` to `~/.catcode` and leaves the old command alone. A machine the Mac or Android app started a server on over SSH needs nothing: the app installs the new server itself. Then stop the old server and start `catcode` (or the background service, with `catcode service install`); that ends the threads running on it, so pick a quiet moment.

### Sign in to an agent

Catgirl Code needs one agent that is installed and signed in on the machine, exactly as T3 Code does. [Provider setup](./docs/user/install.md#providers) has the steps.

## Report a problem

Open an [issue in this repository](../../issues). Say which version you run (Settings › About) and what you did.

Problems with Catgirl Code are not T3 Code's to fix. If you can show the same problem in an official T3 Code build, report it there with that build.

## Build it yourself

The [development runbook](./docs/operations/00_development.md#first-checkout) applies as written. A release is made by [`.github/workflows/catgirl-release.yml`](./.github/workflows/catgirl-release.yml) when a version tag is pushed. The version and the repository the apps fetch from are in [`packages/shared/src/catgirlRelease.ts`](./packages/shared/src/catgirlRelease.ts).

The other documents in this repository, under [`docs/`](./docs/README.md), are T3 Code's and describe T3 Code. Most of it applies. Where they tell you to install from `t3.codes`, npm or an app store, use this page instead.

## License and trademarks

The source code is licensed under the [MIT License](./LICENSE). It is copyright T3 Tools Inc. and its contributors, with this fork's changes under the same licence.

The MIT licence covers the code only. "T3 Code", "T3 Connect", "T3 Tools" and the T3 logos are trademarks of T3 Tools, Inc., and are used here only to say what this project is a fork of. See [TRADEMARK.md](./TRADEMARK.md) for T3 Tools' policy on forks.
