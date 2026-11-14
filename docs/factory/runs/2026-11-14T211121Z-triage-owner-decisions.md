---
run_id: 2026-11-14T211121Z-triage-owner-decisions
stage: triage
started_at: 2026-11-14T21:05:00Z
finished_at: 2026-11-14T21:20:00Z
status: succeeded
issue: none
pull_request: none
gate_level: fast
gate_status: GREEN
verifier: not-run
human_required: true
---

Interactive re-triage from owner decisions made in this session. No code changed. Every
existing `factory-handoff:v1` comment was updated in place; none were added.

Earlier in the same session (recorded here so a silent record isn't mistaken for no record):
- `gates.sh fast` on e326411: `FACTORY_GATES: level=fast status=GREEN passed=2 failed=0 failing=none skipped=none misconfigured=none`
- An independent review of PR #83 (FQ-79), posted as a comment-only review. Finding 1 was
  filed as #86 (ready-to-spec, load-bearing `useVAD.ts`). The owner merged #83, and #79's
  leftover `factory:awaiting-review` label was removed.
- The weekly monitor is now a scheduled task the owner created on the scheduled-tasks page
  (Mondays 05:43 Europe/London, repo and GitHub connector attached). A copy this session
  created was deleted because it had no repository or connectors attached.

Owner decisions, 2026-11-14:

| Issue | Decision | Label change |
|---|---|---|
| #53 | No: device-only recording does not fit "audio is never stored" | needs-info → closed, not planned |
| #54 | No: typed brief text is not new third-party data | needs-info → ready-to-spec |
| #60 | CSS variables in the inline styles, not a Tailwind theme | needs-info → ready-to-spec (more than 5 files; slice per component) |
| #61 | Blocker (#60) resolved; glow change is visible | wait-to-implement → ready-to-spec |
| #57 | Blocker (#56) settled by decision | wait-to-implement → ready-to-spec |
| #43 | Yes, stop dimming | stays ready-to-spec; product gate recorded |
| #46 | `?debug=1` in the URL | stays ready-to-spec; product gate recorded |
| #47 | Confirm dialog, not undo | stays ready-to-spec; product gate recorded |
| #56 | Settings/gear menu | stays ready-to-spec; product gate recorded |
| #59 | Yes, remove the second sidebar | stays ready-to-spec; product gate recorded |

Why the five product decisions are not ready-to-implement: the charter's NEEDS_SPEC covers
user-visible and interaction changes, and an implementation run needs `done_when` and
`files_expected` from an approved spec. The product gate is now settled for each, so the
remaining spec work is short.

Queue after this run (live labels): ready-to-implement 0, ready-to-spec 16, needs-info 0,
wait-to-implement 1 (#51 on #50), in-progress 0, awaiting-review 0. Review queue: 0 of 3.
Unlabelled: #80 (constraint question for factory-tune).

Charter gaps still open (owner-only edits): a definition of "new data" (the working definition
behind #54 is a new kind of personal data or a new provider), layout-only changes (#59), and
whether a helper file added only for a test counts as a component. #80 proposes counting test
lines separately in the 400-line STOP_IF.

Not done: `QUEUE.md` was not regenerated; it remains a snapshot from the 16:32Z triage run.

Next owner: the repo owner. Either run a batch factory-spec for #43, #46, #47, #56 + #57 and
#59 to move them to ready-to-implement, or make the charter edits above.
