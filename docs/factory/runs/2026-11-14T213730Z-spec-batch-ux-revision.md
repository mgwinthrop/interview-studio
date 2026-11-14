---
run_id: 2026-11-14T213730Z-spec-batch-ux-revision
stage: spec
started_at: 2026-11-14T21:37:30Z
finished_at: 2026-11-14T21:41:59Z
status: succeeded
issue: 47, 57, 59
pull_request: none
gate_level: none
gate_status: not-run
verifier: not-run
human_required: true
---

Interactive follow-up to `2026-11-14T211948Z-spec-batch-ux.md` (PR #88), run by the owner in
the same session. It raises #47, #57 and #59 from medium to high confidence. That record stays
as written; this one supersedes its confidence column for these three items. Only the
`factory-handoff:v1` comments changed; labels are unchanged. No product code changed.

## #47 Confirm before ending (ready-to-implement, medium to high)

Owner decision: speech must not reach the interviewer while the dialog is open, because a
person reading the dialog is distracted. The earlier "no resume logic" constraint stands, so the
dialog reuses the session's existing client-side `handlePause` and `handleResume`. It resumes
only if the dialog itself paused the session, and the paused overlay is hidden while the dialog
is open. No protocol change; files unchanged.

The spec now names every assertion in `e2e/end-confirm.spec.ts`: no audio frame sent while
open, Escape and Keep talking both restore focus and resume, an already paused session stays
paused, and confirm sends `session_end`. If the microphone does not reopen on resume, the
existing FQ-79 notice covers it.

## #57 Phone navigation (wait-to-implement on #56, medium to high)

Measurement spike in Chromium with the font the app loads (GeistVF, exposed as
`--font-manrope`). Widths of a row with the logo, three links, the gear and 44px tap targets:

| Link styling | Needs | 320px | 360px | 375px |
|---|---|---|---|---|
| Current (13px, 10px padding, 4px gaps) | 359px | overflows | fits, 1px spare | fits |
| 13px, 6px padding, no gaps | 323px | overflows | fits | fits |
| 12px, 6px padding, no gaps (pinned) | 309px | fits, 11px spare | fits | fits |

The spec pins the last row and tests at 320x568 and 375x667. The owner rule stands: an
overflow at 320px is a PR review item, not a stop. The spike corrected an earlier rough
estimate of about 365px. The spike's HTML was a scratch file and is not committed.

## #59 Embedded report (ready-to-implement, medium to high)

Verified that the dashboard and the report page are client components that fetch in the
browser, so Playwright `page.route` can stub them. Corrected the spec: the two pages use
different report endpoints (`/api/session/:id/report` and `/report/:id`), and both are now
named, plus `/api/sessions`. Stub bodies come from the fixtures in `tests/unit/report.test.ts`
(read only) and must pass `parseReport`, so a wrong shape fails instead of passing on an
error page.

## State after this run

| Issue | Label | Confidence |
|---|---|---|
| 43 | factory:ready-to-implement | high |
| 46 | factory:ready-to-implement | high |
| 47 | factory:ready-to-implement | high |
| 56 | factory:ready-to-implement | high |
| 57 | factory:wait-to-implement (on #56) | high |
| 59 | factory:ready-to-implement | high |

The gap from the first record still applies: the proving Playwright specs are not part of
`gates.sh`, so implementation PRs must quote the failing run on main and the passing run on
the branch.
