// Catgirl Code: the one place that says where this fork's builds come from. Apps and servers fetch
// and offer builds through here, never through T3 Code's releases or its npm package.
// Plain TypeScript with no imports: build scripts load it directly.

/** The GitHub repository whose releases hold this fork's builds. Rename it here and nowhere else. */
export const CATGIRL_RELEASE_REPOSITORY = "nickypro/catgirl-code";

export const CATGIRL_RELEASES_PAGE_URL = `https://github.com/${CATGIRL_RELEASE_REPOSITORY}/releases`;
/** Each release carries its own installer, so `latest` always installs the newest server. */
const CATGIRL_INSTALL_SCRIPT_URL = `${CATGIRL_RELEASES_PAGE_URL}/latest/download/install.sh`;
export const CATGIRL_INSTALL_COMMAND = `curl -fsSL ${CATGIRL_INSTALL_SCRIPT_URL} | sh`;
