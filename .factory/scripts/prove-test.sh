#!/usr/bin/env bash
# Prove that a test fails when the non-test portion of a committed change is removed.
# The working tree must be clean. The script restores it even when the test command fails.
#
# Usage:
#   ./.factory/scripts/prove-test.sh <base-ref> [--test-path <path>]... [--precheck <command>] -- <test command...>
#
# Order: with the fix, the precheck must pass and the test must pass; then the non-test hunks
# are reverted, the precheck must still pass, and the test must fail. A test that fails with
# the fix, or a precheck that fails on either side, is never reported as PROVEN.
#
# --precheck is a shell command (run with bash -c) that must succeed on both sides before the
# test result counts. Use it whenever the test can fail for reasons other than its assertions,
# for example a Playwright spec, whose web server build fails if the reverted tree does not
# compile: --precheck 'npm --prefix apps/frontend run build'.

set -euo pipefail

usage() {
  echo "usage: $0 <base-ref> [--test-path <path>]... [--precheck <command>] -- <test command...>" >&2
  exit 2
}

BASE="${1:-}"
[ -n "$BASE" ] || usage
shift

test_paths=()
precheck=""
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
  case "$1" in
    --test-path)
      [ "$#" -ge 2 ] || usage
      test_paths+=("$2")
      shift 2
      ;;
    --precheck)
      [ "$#" -ge 2 ] || usage
      precheck="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

if [ "${1:-}" != "--" ] || [ "$#" -lt 2 ]; then
  usage
fi
shift

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "PROOF: status=MISCONFIGURED reason=not-a-git-repository" >&2
  exit 2
}
cd "$ROOT"

git rev-parse --verify "$BASE^{commit}" >/dev/null 2>&1 || {
  echo "PROOF: status=MISCONFIGURED reason=invalid-base-ref base=$BASE" >&2
  exit 2
}

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "PROOF: status=MISCONFIGURED reason=working-tree-not-clean" >&2
  exit 2
fi

patch_file="$(mktemp "${TMPDIR:-/tmp}/factory-proof.XXXXXX.patch")"
reverted=0

restore() {
  if [ "$reverted" -eq 1 ] && [ -s "$patch_file" ]; then
    git apply "$patch_file" >/dev/null 2>&1 || {
      echo "PROOF: restore failed; patch retained at $patch_file" >&2
      return
    }
  fi
  rm -f "$patch_file"
}
trap restore EXIT INT TERM

non_test_files=()
while IFS= read -r -d '' path; do
  is_test=0
  for test_path in "${test_paths[@]}"; do
    if [ "$path" = "$test_path" ] || [[ "$path" == "$test_path"/* ]]; then
      is_test=1
      break
    fi
  done
  if [ "${#test_paths[@]}" -eq 0 ]; then
    case "$path" in
      test/*|tests/*|*/test/*|*/tests/*|*/__tests__/*|*.test.*|*.spec.*|test_*|*_test.*|spec_*|*_spec.*) is_test=1 ;;
    esac
  fi
  [ "$is_test" -eq 1 ] || non_test_files+=("$path")
done < <(git diff --name-only -z "$BASE"...HEAD)

if [ "${#non_test_files[@]}" -eq 0 ]; then
  echo "PROOF: status=MISCONFIGURED reason=no-non-test-change" >&2
  exit 2
fi

git diff --binary "$BASE"...HEAD -- "${non_test_files[@]}" > "$patch_file"
if [ ! -s "$patch_file" ]; then
  echo "PROOF: status=MISCONFIGURED reason=empty-revert-patch" >&2
  exit 2
fi

run_precheck() {
  [ -n "$precheck" ] || return 0
  echo "PROOF: precheck ($1): $precheck" >&2
  bash -c "$precheck"
}

# 1. With the fix: the precheck and the test must both pass.
set +e
run_precheck "with fix"
precheck_status=$?
set -e
if [ "$precheck_status" -ne 0 ]; then
  echo "PROOF: status=MISCONFIGURED reason=precheck-failed-with-fix precheck_exit=$precheck_status"
  exit 2
fi

set +e
"$@"
fixed_status=$?
set -e
if [ "$fixed_status" -ne 0 ]; then
  echo "PROOF: status=FAILED reason=test-fails-with-fix test_exit=$fixed_status"
  exit 1
fi

# 2. Without the fix: the precheck must still pass, and the test must fail.
git apply -R "$patch_file"
reverted=1

set +e
run_precheck "without fix"
precheck_status=$?
set -e
if [ "$precheck_status" -ne 0 ]; then
  git apply "$patch_file"
  reverted=0
  echo "PROOF: status=MISCONFIGURED reason=precheck-failed-without-fix precheck_exit=$precheck_status"
  exit 2
fi

set +e
"$@"
test_status=$?
set -e

git apply "$patch_file"
reverted=0

if [ "$test_status" -eq 0 ]; then
  echo "PROOF: status=FAILED reason=test-passed-without-fix"
  exit 1
fi

echo "PROOF: status=PROVEN test_exit=$test_status"
