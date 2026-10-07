#!/usr/bin/env bash
set -euo pipefail

tarballs=${1:?usage: check-tarball-contents.sh <tarballs-dir>}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pnpm ls -r --depth=-1 --json | jq -r '.[] | select(.private != true) | "\(.name)\t\(.path)"' >"$work/members.tsv"

failures=0
checked=0
while IFS=$'\t' read -r name file; do
  dir=$(awk -F'\t' -v n="$name" '$1 == n { print $2 }' "$work/members.tsv")
  if [ -z "$dir" ]; then
    echo "error[TARBALL-CONTENTS]: $file names $name, which is not a publishable workspace package" >&2
    failures=$((failures + 1))
    continue
  fi
  tar -tzf "$tarballs/$file" | sed 's,^package/,,' | grep -v '/$' | sort >"$work/packed"
  (cd "$dir" && pnpm pack --dry-run --json) | jq -r '.files[].path' | sort >"$work/source"
  if ! diff -u --label "$name source" --label "$name tarball" "$work/source" "$work/packed" >&2; then
    echo "error[TARBALL-CONTENTS]: $name: tarball file list differs from pnpm pack of the source tree" >&2
    failures=$((failures + 1))
  fi
  if ! tar -xzOf "$tarballs/$file" package/CHANGELOG.md | cmp -s - "$dir/CHANGELOG.md"; then
    echo "error[TARBALL-CONTENTS]: $name: tarball CHANGELOG.md differs from $dir/CHANGELOG.md" >&2
    failures=$((failures + 1))
  fi
  checked=$((checked + 1))
done < <(jq -r '.[] | "\(.name)\t\(.file)"' "$tarballs/index.json")

if [ "$failures" -ne 0 ]; then
  echo "check-tarball-contents: $failures violation(s)" >&2
  exit 1
fi
echo "check-tarball-contents: $checked tarball(s) match pnpm pack of the source tree"
