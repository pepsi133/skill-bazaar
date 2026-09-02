#!/usr/bin/env bash
#
# vendor-sync.sh — report drift between a vendored plugin and an upstream commit.
#
#   usage: scripts/vendor-sync.sh <plugin-dir> [<sha>]
#   e.g.   scripts/vendor-sync.sh plugins/caveman
#          scripts/vendor-sync.sh plugins/caveman df2ccd85c94ec3c8289cb62ac020d241ccfb0c60
#
# THIS SCRIPT NEVER APPLIES ANYTHING. It prints diffs and exits non-zero; a human reads
# them, applies changes by hand, re-runs the plugin's security review, and updates
# UPSTREAM.md / UPSTREAM.json in the same commit. It never writes into <plugin-dir>.
#
# IT NEVER EXECUTES UPSTREAM CODE. Upstream is reached with `git` plumbing only —
# `git fetch` into a throwaway bare-ish repo, then `git cat-file` to extract individual
# blobs. There is no checkout of the upstream tree, no build, no install script, no
# interpreter ever pointed at an upstream file.
#
# Config comes from <plugin-dir>/UPSTREAM.json (the machine-readable twin of UPSTREAM.md):
#
# This is a MAINTAINER tool, not a shipped hook: it deliberately contacts the upstream host
# named in UPSTREAM.json, because that is the pin-bump review gate AGENTS.md requires. A
# file:// URL is also accepted so the whole thing can be exercised against a local mirror
# with no network at all. Nothing is ever sent outward — it is a fetch, never a push.
#
# Environment:
#   VENDOR_SYNC_REPO  overrides the manifest's `repo` for this run ONLY — the remote to
#                     fetch from, nothing else. The pin, the vendored set and every hash
#                     still come from UPSTREAM.json, so the check stays exactly as strict.
#                     It takes the same https:// / file:// URLs the manifest field takes and
#                     is validated the same way. Use it to rehearse offline against a local
#                     file:// mirror, or to point the check at a fork, without editing the
#                     manifest. The effective remote is printed on the `upstream :` line and
#                     marked `(override)`, so no run can hide which remote it read.
#
#   { "repo": "https://github.com/owner/name",   # upstream remote (or file:// mirror)
#     "sha":  "<40-hex>",                        # currently pinned commit
#     "vendored_dirs": ["hooks", "skills"],      # roots scanned for new upstream files
#     "modified": ["path"],                      # vendored files we knowingly patched
#     "excluded": ["path-or-dir"],               # upstream paths deliberately left out
#     "local": ["path-or-dir"],                  # this repo's own files living beside the vendored ones (not checked)
#     "files": { "<path>": "<sha256>", ... } }   # the vendored set + expected hashes
#
# UPSTREAM.md must list the same paths; a mismatch between the two is itself an error,
# so the human-readable table cannot quietly drift from the one the tooling reads.
#
# Exit codes:
#   0  no drift — every vendored file matches upstream at <sha>, nothing new upstream
#   1  drift found (diffs printed), or a local file no longer matches its recorded hash
#   2  usage / environment / config error
#
# Requires: bash, git, python3 (to read our own JSON; jq is not required).
# Generic across plugins: any plugins/<name>/ with an UPSTREAM.json works.

set -uo pipefail

die() { printf 'vendor-sync: %s\n' "$*" >&2; exit 2; }

[ $# -ge 1 ] && [ $# -le 2 ] || die "usage: $0 <plugin-dir> [<sha>]"

command -v git >/dev/null 2>&1 || die "git not found on PATH"
command -v python3 >/dev/null 2>&1 || die "python3 not found on PATH"

PLUGIN_DIR=${1%/}
[ -d "$PLUGIN_DIR" ] || die "not a directory: $PLUGIN_DIR"
PLUGIN_DIR=$(cd "$PLUGIN_DIR" && pwd)

MANIFEST="$PLUGIN_DIR/UPSTREAM.json"
[ -f "$MANIFEST" ] || die "no UPSTREAM.json in $PLUGIN_DIR"

# ---------------------------------------------------------------- read our own manifest
# Emits shell-safe lines: REPO=…, PINNED=…, DIR=…, MOD=…, FILE=<sha256> <path>
read_manifest() {
  python3 - "$MANIFEST" <<'PY'
import json, sys, re
m = json.load(open(sys.argv[1], encoding='utf-8'))
for key in ('repo', 'sha', 'files'):
    if key not in m:
        sys.exit(f"UPSTREAM.json missing required key: {key}")
if not re.fullmatch(r'[0-9a-f]{40}', m['sha']):
    sys.exit("UPSTREAM.json 'sha' must be a full 40-hex commit id")
if not re.fullmatch(r'(https|file)://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+', m['repo']):
    sys.exit("UPSTREAM.json 'repo' must be an https:// (or, for an offline mirror, file://) URL")
print("REPO=" + m['repo'])
print("PINNED=" + m['sha'])
for d in m.get('vendored_dirs', []):
    print("DIR=" + d)
for p in m.get('modified', []):
    print("MOD=" + p)
for p in m.get('excluded', []):
    print("EXC=" + p.rstrip('/'))
for p in m.get('local', []):
    print("LOC=" + p.rstrip('/'))
for p, h in sorted(m['files'].items()):
    if p.startswith('/') or '..' in p.split('/'):
        sys.exit(f"UPSTREAM.json unsafe path: {p}")
    print(f"FILE={h} {p}")
PY
}

MANIFEST_LINES=$(read_manifest) || die "could not parse $MANIFEST"

REPO=""; PINNED=""
declare -a VPATHS=() VDIRS=() VMODIFIED=() VEXCLUDED=() VLOCAL=()
declare -A VHASH=()
while IFS= read -r line; do
  case $line in
    REPO=*)   REPO=${line#REPO=} ;;
    PINNED=*) PINNED=${line#PINNED=} ;;
    DIR=*)    VDIRS+=("${line#DIR=}") ;;
    MOD=*)    VMODIFIED+=("${line#MOD=}") ;;
    EXC=*)    VEXCLUDED+=("${line#EXC=}") ;;
    LOC=*)    VLOCAL+=("${line#LOC=}") ;;
    FILE=*)   rest=${line#FILE=}; VHASH["${rest#* }"]=${rest%% *}; VPATHS+=("${rest#* }") ;;
  esac
done <<<"$MANIFEST_LINES"

# ------------------------------------------------------- repo override (this run, remote only)
# Same rule as the manifest's own `repo` field: https:// for a real remote, file:// for an
# offline mirror. Nothing else about the check is overridable.
REPO_RE='^(https|file)://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$'
REPO_OVERRIDDEN=0
if [ -n "${VENDOR_SYNC_REPO:-}" ]; then
  [[ $VENDOR_SYNC_REPO =~ $REPO_RE ]] ||
    die "VENDOR_SYNC_REPO must be an https:// (or, for an offline mirror, file://) URL"
  REPO_OVERRIDDEN=1
fi
EFFECTIVE_REPO=${VENDOR_SYNC_REPO:-$REPO}

TARGET_SHA=${2:-$PINNED}
case $TARGET_SHA in
  [0-9a-f]*) [ ${#TARGET_SHA} -eq 40 ] || die "sha must be a full 40-hex commit id" ;;
  *) die "sha must be a full 40-hex commit id" ;;
esac

is_modified() {
  local p=$1 m
  for m in ${VMODIFIED+"${VMODIFIED[@]}"}; do [ "$m" = "$p" ] && return 0; done
  return 1
}

# An excluded entry matches the path itself or anything beneath it, so a directory-level
# decision ("never vendor skills/caveman-setup") keeps covering files added to it later.
is_excluded() {
  local p=$1 e
  for e in ${VEXCLUDED+"${VEXCLUDED[@]}"}; do
    [ "$e" = "$p" ] && return 0
    case $p in "$e"/*) return 0 ;; esac
  done
  return 1
}

printf 'plugin   : %s\n' "$PLUGIN_DIR"
if [ "$REPO_OVERRIDDEN" -eq 1 ]; then
  printf 'upstream : %s  (override via VENDOR_SYNC_REPO; UPSTREAM.json says %s)\n' \
    "$EFFECTIVE_REPO" "$REPO"
else
  printf 'upstream : %s\n' "$EFFECTIVE_REPO"
fi
printf 'pinned   : %s\n' "$PINNED"
printf 'target   : %s%s\n' "$TARGET_SHA" \
  "$([ "$TARGET_SHA" = "$PINNED" ] && echo '  (same as pin — checking the pin still matches)' || echo '  (candidate bump)')"
printf 'vendored : %d files\n\n' "${#VPATHS[@]}"

drift=0

# ------------------------------------------------- 0. local integrity + UPSTREAM.md sync
for p in "${VPATHS[@]}"; do
  if [ ! -f "$PLUGIN_DIR/$p" ]; then
    printf 'MISSING LOCALLY  %s  (listed in UPSTREAM.json, absent from the plugin)\n' "$p"
    drift=1
    continue
  fi
  have=$(sha256sum "$PLUGIN_DIR/$p" | cut -d' ' -f1)
  if [ "$have" != "${VHASH[$p]}" ]; then
    printf 'LOCAL HASH DRIFT %s\n  recorded %s\n  actual   %s\n' "$p" "${VHASH[$p]}" "$have"
    drift=1
  fi
done

# every file present in the plugin dir must be accounted for
while IFS= read -r p; do
  case $p in UPSTREAM.md|UPSTREAM.json|README.md) continue ;; esac
  is_local=0
  for l in "${VLOCAL[@]}"; do
    if [ "$p" = "$l" ] || [ "${p#"$l"/}" != "$p" ]; then is_local=1; break; fi
  done
  [ "$is_local" = 1 ] && continue
  [ -n "${VHASH[$p]+x}" ] || { printf 'UNTRACKED LOCALLY %s  (present in the plugin, not in UPSTREAM.json; add to "files" or to "local")\n' "$p"; drift=1; }
done < <(cd "$PLUGIN_DIR" && find . -type f | sed 's#^\./##' | sort)

# UPSTREAM.md must mention every tracked path, so the two manifests cannot diverge
if [ -f "$PLUGIN_DIR/UPSTREAM.md" ]; then
  for p in "${VPATHS[@]}"; do
    grep -qF -- "$p" "$PLUGIN_DIR/UPSTREAM.md" ||
      { printf 'MANIFEST DRIFT   %s is in UPSTREAM.json but not mentioned in UPSTREAM.md\n' "$p"; drift=1; }
  done
else
  printf 'MANIFEST DRIFT   UPSTREAM.json exists but UPSTREAM.md does not\n'; drift=1
fi

# ------------------------------------------------------------------ 1. fetch upstream
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/vendor-sync.XXXXXXXX") || die "mktemp failed"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT INT TERM

printf '\nfetching %s at %s (git only, no checkout, nothing executed)...\n' "$EFFECTIVE_REPO" "$TARGET_SHA"
git init -q --bare "$SCRATCH/up" || die "git init failed"
G=(git --git-dir="$SCRATCH/up")
"${G[@]}" remote add origin "$EFFECTIVE_REPO" || die "git remote add failed"
if ! "${G[@]}" fetch -q --depth 1 origin "$TARGET_SHA" 2>/dev/null; then
  printf 'shallow fetch by sha refused by the remote; retrying with a full fetch...\n'
  "${G[@]}" fetch -q origin '+refs/heads/*:refs/remotes/origin/*' ||
    die "git fetch failed — check the URL and your network"
fi
"${G[@]}" cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null ||
  die "commit $TARGET_SHA not found in $EFFECTIVE_REPO after fetch"

upstream_show() { "${G[@]}" cat-file -p "$TARGET_SHA:$1" 2>/dev/null; }

# --------------------------------------------------------------- 2. diff the vendored set
printf '\n--- vendored files vs upstream ---\n'
for p in "${VPATHS[@]}"; do
  [ -f "$PLUGIN_DIR/$p" ] || continue
  if ! "${G[@]}" cat-file -e "$TARGET_SHA:$p" 2>/dev/null; then
    printf '\nGONE UPSTREAM    %s  (vendored here, absent at %s — moved or deleted; find where it went before bumping)\n' "$p" "${TARGET_SHA:0:12}"
    drift=1
    continue
  fi
  up="$SCRATCH/blob"
  upstream_show "$p" > "$up"
  if cmp -s "$up" "$PLUGIN_DIR/$p"; then
    continue
  fi
  if is_modified "$p"; then
    printf '\nEXPECTED PATCH   %s  (listed in UPSTREAM.json "modified" — verify the patch is still only what UPSTREAM.md documents)\n' "$p"
  else
    printf '\nCHANGED          %s\n' "$p"
    drift=1
  fi
  diff -u --label "upstream/$p" --label "vendored/$p" "$up" "$PLUGIN_DIR/$p"
done

# ------------------------------------------- 3. new upstream files under vendored roots
if [ ${#VDIRS[@]} -gt 0 ]; then
  printf '\n--- new upstream files under vendored roots (reported, never pulled in) ---\n'
  found_new=0
  excluded_seen=0
  while IFS= read -r p; do
    [ -n "${VHASH[$p]+x}" ] && continue
    case $p in */__pycache__/*) continue ;; esac
    if is_excluded "$p"; then
      excluded_seen=$((excluded_seen + 1))
      continue
    fi
    printf 'NEW UPSTREAM     %s  (not currently vendored — decide, do not auto-add)\n' "$p"
    found_new=1
  done < <("${G[@]}" ls-tree -r --name-only "$TARGET_SHA" -- "${VDIRS[@]}" 2>/dev/null | sort)
  [ "$found_new" -eq 0 ] && printf '(none)\n'
  [ "$excluded_seen" -gt 0 ] &&
    printf '(%d further upstream path(s) skipped: excluded by decision, see UPSTREAM.md)\n' "$excluded_seen"
  # A new upstream file is information, not drift on its own: it does not change any byte
  # we ship. It is printed so the human decides, and never silently vendored.
fi

# ---------------------------------------------------- 4. license reclassification guard
# Upstream may relicense a directory (caveman's LICENSING.md moves engine-linked modules to
# BSL-1.1, and says NEW engine-linked modules default to BSL). Redistributing a BSL file in
# this marketplace is exactly what its Additional Use Grant withholds, so refuse outright.
if "${G[@]}" cat-file -e "$TARGET_SHA:LICENSING.md" 2>/dev/null; then
  printf '\n--- license guard (upstream LICENSING.md) ---\n'
  bsl_hit=0
  while IFS= read -r bsl_path; do
    [ -n "$bsl_path" ] || continue
    for p in "${VPATHS[@]}"; do
      case "$p/" in
        "$bsl_path"/*|"$bsl_path"*)
          printf 'BSL VIOLATION    %s falls under LICENSING.md row "%s" — do NOT vendor\n' "$p" "$bsl_path"
          bsl_hit=1 ;;
      esac
    done
  done < <(upstream_show LICENSING.md |
             grep -i 'BSL' |
             grep -oE '`[A-Za-z0-9_./-]+/`' |
             tr -d '`' | sed 's#/$##' | sort -u)
  if [ "$bsl_hit" -eq 1 ]; then
    printf 'A vendored path is BSL-licensed upstream. Refusing.\n'
    drift=1
  else
    printf '(no vendored path matches a BSL row — still re-read LICENSING.md by hand)\n'
  fi
fi

printf '\n'
if [ "$drift" -eq 0 ]; then
  printf 'RESULT: no drift. Pin %s is current for %s.\n' "${TARGET_SHA:0:12}" "$PLUGIN_DIR"
  exit 0
fi
printf 'RESULT: drift found. Nothing was changed — %s is untouched.\n' "$PLUGIN_DIR"
printf 'Read every diff above in full context, then follow the update policy in %s/UPSTREAM.md.\n' "$PLUGIN_DIR"
exit 1
