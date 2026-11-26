#!/usr/bin/env bash
# Catgirl Code: signs a draft release's SHA256SUMS with the release key, then publishes the release.
# Run on the maintainer's machine, where the key is: it never goes to GitHub.
#
#   scripts/catgirl-sign-release.sh v1.12.4 ~/path/to/catgirl-release-signing [--publish]
#
# Downloads SHA256SUMS and every file it lists, checks that it lists exactly the release's server
# archives and installer, checks each file against it, signs it, checks the signature with the key
# the code embeds and uploads SHA256SUMS.sig. With --publish it then makes the draft the latest
# release, with the release workflow paused so the tag that publishing creates does not rebuild it.
set -euo pipefail

die() {
  printf 'catgirl-sign-release: %s\n' "$1" >&2
  exit 1
}

[[ $# -ge 2 ]] || die "usage: $0 <tag> <private key file> [--publish]"
tag=$1
key=$2
publish=${3:-}
[[ -z "$publish" || "$publish" == --publish ]] || die "unknown option $publish"
[[ -f "$key" ]] || die "no key file at $key"

root=$(cd "$(dirname "$0")/.." && pwd)
repo=$(sed -n 's/^export const CATGIRL_RELEASE_REPOSITORY = "\(.*\)";$/\1/p' "$root/packages/shared/src/catgirlRelease.ts")
signature_module="$root/packages/shared/src/catgirlReleaseSignature.ts"
expected=$(grep -o 'ssh-ed25519 AAAA[A-Za-z0-9+/=]*' "$signature_module" | head -n 1)
namespace=$(sed -n 's/^export const CATGIRL_RELEASE_SIGNATURE_NAMESPACE = "\(.*\)";$/\1/p' "$signature_module")
signer=$(sed -n 's/^export const CATGIRL_RELEASE_SIGNER = "\(.*\)";$/\1/p' "$signature_module")
[[ -n "$repo" && -n "$expected" && -n "$namespace" && -n "$signer" ]] || die "could not read the release constants"
[[ "$(ssh-keygen -y -f "$key" | cut -d' ' -f1,2)" == "$expected" ]] ||
  die "$key is not the release key the code embeds"

[[ "$(gh release view "$tag" -R "$repo" --json isDraft --jq .isDraft)" == "true" ]] ||
  die "$tag is not a draft release in $repo; a published release is never re-signed"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

gh release download "$tag" -R "$repo" -p SHA256SUMS
listed=$(sed -E 's/^[0-9a-f]{64} [ *]//' SHA256SUMS | sort)
# What SHA256SUMS must list: the server archives and the installer, nothing more and nothing less.
assets=$(gh release view "$tag" -R "$repo" --json assets --jq '.assets[].name' |
  grep -E '^((catcode|t3)-.+\.(tar\.gz|zip)|install\.sh)$' | sort)
[[ -n "$assets" && "$listed" == "$assets" ]] ||
  die "SHA256SUMS lists [$(echo $listed)] but the release has [$(echo $assets)]"

while IFS= read -r name; do
  gh release download "$tag" -R "$repo" -p "$name"
done <<< "$listed"
sha256sum --check --strict SHA256SUMS

ssh-keygen -q -Y sign -f "$key" -n "$namespace" SHA256SUMS
printf '%s %s\n' "$signer" "$expected" > allowed_signers
ssh-keygen -Y verify -f allowed_signers -I "$signer" -n "$namespace" -s SHA256SUMS.sig < SHA256SUMS
gh release upload "$tag" -R "$repo" SHA256SUMS.sig --clobber
echo "signed $tag: $(wc -l < SHA256SUMS) files"

if [[ "$publish" == --publish ]]; then
  workflow="Catgirl Code release"
  gh workflow disable "$workflow" -R "$repo"
  trap 'gh workflow enable "$workflow" -R "$repo"; rm -rf "$work"' EXIT
  gh release edit "$tag" -R "$repo" --draft=false --latest
  echo "published $tag"
fi
