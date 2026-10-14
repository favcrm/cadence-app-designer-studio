#!/usr/bin/env bash
# Build the limited prerelease kit; never install or approve an app here.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/dist/release"}
KIT=designer-studio-v0.1.0-preview.1
mkdir -p "$OUT"
STAGE=$(mktemp -d)
trap 'rm -rf -- "$STAGE"' EXIT
mkdir "$STAGE/$KIT"
# Native validation is offline: no daemon, provider, approval or installation.
cadence app check "$ROOT/package" --json > "$STAGE/check.json"
DIGEST=$(python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); assert r["ok"] is True; print(r["digest"])' "$STAGE/check.json")
cp -R "$ROOT/package" "$STAGE/$KIT/package"
cp "$STAGE/check.json" "$STAGE/$KIT/package-check.json"
cat > "$STAGE/$KIT/run.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT"
sha256sum --check SHA256SUMS
case "${1:-check}" in
  check) exec cadence --org local app check "$ROOT/package" --json ;;
  install) exec cadence --org local app catalog install "$ROOT/package" --expected-digest "@@DIGEST@@" ;;
  *) printf 'Usage: ./run.sh [check|install]\n' >&2; exit 2 ;;
esac
SH
python3 - "$STAGE/$KIT/run.sh" "$DIGEST" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); p.write_text(p.read_text().replace('@@DIGEST@@',sys.argv[2]))
PY
chmod 755 "$STAGE/$KIT/run.sh"
cat > "$STAGE/$KIT/INSTALL.md" <<'MD'
# Designer Studio — limited v0.1 prerelease

Requires a Cadence host containing CAD-1440 media-only context admission
(qualified against 0.1.1, source b182c4a8b032adc074a77bfc6390b87358ec09c8).
Earlier build 0b36010fdd0ed660ab3a7145f3d1d80ee8b43bbf does not support this
zero-tool-alias package. Edit, video and reuse are unavailable.
Generation, workspace library curation and original download require the
host's current permissions, declarations, bindings and consumed mount.

From an operator terminal, inspect `./run.sh check`, then run
`./run.sh install`. Installation is unapproved and grants nothing. Keep the
returned installation ID and digest. Explicit approval, image connection
binding and context setup are separate supported host actions; no paid
execution or automatic consent is performed by this kit.

If the same app is already installed, stop: do not remove it or install a
second copy. Use the supported catalog upgrade-check/upgrade flow with its
current digest and generation. Rollback is an operator decision using a
retained previous bundle through that same pinned catalog upgrade flow.
Never delete workspace assets, jobs or history to resolve an install refusal.
MD
(cd "$STAGE/$KIT" && find package -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
 sha256sum run.sh INSTALL.md package-check.json >> SHA256SUMS)
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$STAGE" -cf - "$KIT" | gzip -n > "$OUT/$KIT.tar.gz"
(cd "$OUT" && sha256sum "$KIT.tar.gz" > "$KIT.tar.gz.sha256")
printf 'Kit: %s/%s.tar.gz\nBundle digest: %s\nNo app installed or approved.\n' "$OUT" "$KIT" "$DIGEST"
