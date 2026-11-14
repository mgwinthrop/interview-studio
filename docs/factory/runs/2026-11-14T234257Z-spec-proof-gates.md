---
run_id: 2026-11-14T234257Z-spec-proof-gates
stage: spec
started_at: 2026-11-14T21:50:00Z
finished_at: 2026-11-14T23:42:57Z
status: succeeded
issue: 43, 46, 47, 56, 57, 59
pull_request: 91, 92
gate_level: full
gate_status: GREEN
verifier: not-run
human_required: true
---

Interactive follow-up to `2026-11-14T211948Z-spec-batch-ux.md` and
`2026-11-14T213730Z-spec-batch-ux-revision.md`, run with the owner present. It closes the
gap both records carried: the UX items could only be proven by Playwright specs, which the
gates did not run and the proof script could not prove reliably.

## Gate change (PR #91, written and committed by the owner)

`e2e` is a required gate at `full` and `deep`. The root `package.json` runs the frontend
Playwright suite; `gates.sh` first checks that the pinned Chromium launches and that ports
3000 and 3001 are free, and skips the gate (MISCONFIGURED when required) if not, so an
environment problem never reads as a red test. Claude prepared the patch; the repository's
settings deny agent edits to `gates.sh` and `gates.conf`, so the owner applied it. Owner's
local runs:

- `FACTORY_GATES: level=full status=GREEN passed=5 failed=0 failing=none skipped=none misconfigured=none` (28 Playwright tests, 1.2 min)
- With port 3000 held: `status=MISCONFIGURED`, `misconfigured=e2e`, exit 2

## Proof script change (PR #92, applied and committed by the owner)

`prove-test.sh` gains `--precheck '<command>'`, which must pass with and without the fix, and
now requires the test to pass with the fix (`test-fails-with-fix`). Before this, a reverted
tree that did not build made a Playwright spec fail and read as PROVEN. The verifier agent and
the factory-verify skill gained the Playwright rules: frontend build as precheck, spec only as
`--test-path`, failures must be `expect(...)` assertions.

Checks before the patch was handed over:

- Throwaway repo in the shape of #46: the old script reported PROVEN on a base that did not
  build; the new one reported `MISCONFIGURED reason=precheck-failed-without-fix`. The
  passes-without-fix, fails-with-fix, failing precheck, dirty tree, bad usage and old call
  forms behaved as specified, and the tree was restored after every run.
- FQ-79's commit `bad3b52` with the real frontend build as precheck: build passed on both
  sides, spec 3/3 with the fix and 2/3 failing on `expect(...)` without it,
  `PROOF: status=PROVEN`, about 2 minutes.

## Cloud environment (owner-approved changes to the interview-studio environment)

- The pinned `@playwright/test` 1.65.0 needs Chromium build 1254; the image ships 1243, so
  every browser test failed at launch in cloud sessions.
- Added the allowed host `cdn.playwright.dev`; installed build 1254 in this session (28/28
  Playwright tests passed, 1.3 min).
- Added `npx playwright install chromium` to the setup script. The full script ran cleanly
  here, but its download step was a no-op because the browser was already installed, so it is
  unproven until a fresh session runs `gates.sh full` with `e2e` passing.

## Handoffs

The six handoff comments were updated in place: `done_when` now requires the verifier's
`prove-test.sh` PROVEN line (spec-only `--test-path`, frontend build as `--precheck`,
`expect(...)` failures) and `gates.sh full` GREEN, instead of quoted manual runs on main and
the branch. #46 also proves its new unit test in its own run. Labels are unchanged: #43, #46,
#47, #56 and #59 `factory:ready-to-implement`; #57 `factory:wait-to-implement` on #56.

## Found along the way

- #90: the factory hook blocks read-only commands that mention a protected path together with
  `>`, `sed`, `cp` and similar tokens, and labels every such block as a merge attempt. It
  blocked the first attempt to write this record. Left for the owner; the hook path is
  load-bearing.
- This session cannot delete or force-push its own branch on GitHub, so the carrier branch
  `claude/fervent-faraday-24sep2` was cleaned with an ordinary commit and is behind `main`.

## Front matter notes

`gate_level` and `gate_status` are the owner's local `gates.sh full` result on PR #91; this
session did not run the patched gate itself. `verifier: not-run`: no implementation was
verified, and both factory changes were applied and read by the owner.
