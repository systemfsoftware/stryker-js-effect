#!/bin/sh
set -eu

package=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH='' cd -- "$package/../.." && pwd)
oracle="$package/tests/__fixtures__/lockfile-closure/oracle"

pinned=$(node -p "require('$repo/package.json').packageManager.replace(/^pnpm@/, '')")
running=$(pnpm --version)
if [ "$pinned" != "$running" ]; then
  echo "lockfile-oracle: pnpm $running is on PATH but the repository pins pnpm $pinned. Next: run this from the repository's dev shell." >&2
  exit 1
fi

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT INT TERM

lock_of() {
  dir="$scratch/$1.$2"
  mkdir -p "$dir/vendor"
  cp -R "$oracle/workspace/." "$dir/"
  if [ -d "$oracle/variants/$1" ]; then
    cp -R "$oracle/variants/$1/." "$dir/"
  fi
  node -e "const f='$dir/package.json', m=JSON.parse(require('fs').readFileSync(f)); m.packageManager='pnpm@$pinned'; require('fs').writeFileSync(f, JSON.stringify(m, null, 2) + '\n')"
  (cd "$dir/vendor-src/package" && npm pack --silent --pack-destination "$dir/vendor" >/dev/null)
  mv "$dir"/vendor/local-tgz-*.tgz "$dir/vendor/local-tgz.tgz"
  (cd "$dir" && pnpm install --lockfile-only --silent)
}

mkdir -p "$oracle/locks"
for variant in base $(ls "$oracle/variants"); do
  lock_of "$variant" first
  lock_of "$variant" second
  if ! cmp -s "$scratch/$variant.first/pnpm-lock.yaml" "$scratch/$variant.second/pnpm-lock.yaml"; then
    echo "lockfile-oracle: two pnpm runs for variant $variant wrote different locks. Next: diff them in $scratch before trusting either." >&2
    trap - EXIT INT TERM
    exit 1
  fi
  cp "$scratch/$variant.first/pnpm-lock.yaml" "$oracle/locks/$variant.pnpm-lock.yaml"
  echo "lockfile-oracle: $variant reproduced byte-identically with pnpm $pinned"
done
node -e "const f='$oracle/workspace/package.json', m=JSON.parse(require('fs').readFileSync(f)); m.packageManager='pnpm@$pinned'; require('fs').writeFileSync(f, JSON.stringify(m, null, 2) + '\n')"
