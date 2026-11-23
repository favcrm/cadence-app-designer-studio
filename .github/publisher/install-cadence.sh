#!/usr/bin/env bash
# Install one exact Cadence CLI release for the canonical bundle checker and
# credential scanner. Usage: install-cadence.sh <version>
#
# "latest" is refused: a check against whatever release is newest is not
# reproducible. Prints the bin directory on stdout.
set -euo pipefail
version="${1:-}"
version="${version#v}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "install-cadence: an exact X.Y.Z Cadence release is required (got '${1:-}')" >&2
  exit 2
fi
archive="cadence-v${version}-x86_64-linux.tar.gz"
dest="${RUNNER_TEMP:-/tmp}/cadence-${version}"
rm -rf -- "$dest"
mkdir -p "$dest"
base="https://github.com/favcrm/cadence/releases/download/v${version}"
curl --fail --silent --show-error --location --retry 3 "$base/${archive}" --output "$dest/${archive}"
curl --fail --silent --show-error --location --retry 3 "$base/${archive}.sha256" --output "$dest/${archive}.sha256"
# The release's own checksum file names the archive; verify before extracting.
(cd "$dest" && sha256sum --check --strict --quiet "${archive}.sha256") >&2 ||
  { echo "install-cadence: ${archive} does not match its release sha256" >&2; exit 1; }
tar -xzf "$dest/${archive}" -C "$dest"
bin=$(find "$dest" -name cadence -type f | head -1)
if [[ -z "$bin" ]]; then
  echo "install-cadence: ${archive} has no cadence binary" >&2
  exit 1
fi
chmod +x "$bin"
reported=$("$bin" --version | head -1)
if [[ "$reported" != "cadence ${version}" && "$reported" != "cadence ${version}+"* ]]; then
  echo "install-cadence: expected cadence ${version}, binary reports '${reported}'" >&2
  exit 1
fi
dirname "$bin"
