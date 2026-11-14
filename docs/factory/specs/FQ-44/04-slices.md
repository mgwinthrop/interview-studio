# FQ-44 Gate 4 - Slices

Four slices. Each one can ship and be reviewed on its own, and each stays well under the
charter's 400-line limit. Only slice 1 touches a load-bearing path.

```
slice 0 (frontend tracer) ──────────────► ships alone
slice 1 (backend field, load-bearing) ──┬► slice 2 (editor and hand-off)
                                        └► slice 3 (preset and designer names)
```

One adjustment to gate 3, made so the speaking fix can be proven by a unit test: the
displayed-state derivation becomes a pure exported function in the helper module, instead of
a local `const` in `page.tsx`. The helper is renamed from `speakerLabels.ts` to
`sessionDisplay.ts` to fit both jobs. The contracts are otherwise unchanged.

## Slice 0 - Tracer: session display (frontend only)

End to end on the session screen with the display name "mocked" as always absent. Every
interviewer shows the fallback "Interviewer" until slices 1 and 3 land. This alone fixes
the speaking contradiction and the "Participant" label, and replaces the fixed panel
heading and tagline.

- done_when: `apps/frontend/tests/unit/sessionDisplay.test.ts` fails on main (no module) and
  passes. It covers the "You"/"Y" labels, display name and initial, the "Interviewer"/"I"
  fallback for an absent or blank name, a non-BMP initial, and `displayedOrbState` returning
  "speaking" while `audioPlaying` is true after `tts_end` and the incoming state otherwise.
  `LiveTranscript.tsx` contains no "Participant", no literal "M" badge and no
  "Interviewer Speaking", and its speaking badge and label use `interviewerSpeaking` while
  the opacity dim stays on `aiSpeaking`. `AgentPanel.tsx` contains no "AI interviewer"
  heading and no fixed tagline. `gates.sh full` is GREEN. The PR includes mock-mode
  screenshots of listening, after-`tts_end` playback, and design mode.
- files_expected: apps/frontend/app/lib/sessionDisplay.ts, apps/frontend/tests/unit/sessionDisplay.test.ts, apps/frontend/app/lib/interviewers.ts, apps/frontend/app/session/page.tsx, apps/frontend/app/components/AgentPanel.tsx, apps/frontend/app/components/LiveTranscript.tsx, apps/frontend/app/globals.css
- load_bearing: false · gate_level: full · confidence: high
- depends_on: none

## Slice 1 - Backend field (load-bearing, interactive)

- done_when: new `apps/backend/src/__tests__/displayName.test.ts` and
  `server.displayName.test.ts` fail on main and pass. They cover: a definition without the
  field parses; 40 characters accepted and 41 or `""` rejected at `displayName`; POST then
  GET round-trips it; PUT changes it; duplicate keeps it; a `session_start` draft with it
  starts a trial; and a 41-character draft closes 1008. The only edit to an existing test is
  adding `displayName: 40` to the `INTERVIEWER_LIMITS` assertion in
  `interviewerSchema.test.ts` (approved at gate 2 C). `docs/interviewers.md` documents the
  field, limit, fallback and roll-forward note. `gates.sh deep` is GREEN. The PR is draft and
  marked for a human read.
- files_expected: apps/backend/src/interviewer/schema.ts, apps/backend/src/interviewerStore.ts, apps/backend/src/__tests__/interviewerSchema.test.ts, apps/backend/src/__tests__/displayName.test.ts, apps/backend/src/__tests__/server.displayName.test.ts, docs/interviewers.md
- load_bearing: true · gate_level: deep · confidence: medium
- depends_on: none
- Runs interactively, with the owner present. The unattended implement routine stops on
  load-bearing paths by design.

## Slice 2 - Editor and draft hand-off

- done_when: new `apps/frontend/tests/unit/interviewerFormDisplayName.test.ts` fails on main
  and passes. It covers: `inputFromDetail` keeps `displayName`; `parseShape` (via
  `parseDraftInput`) keeps it and still accepts a draft without it; the form omits it when
  blank. The editor shows an optional "Display name" field after Name, with the limit 40.
  `gates.sh full` is GREEN.
- files_expected: apps/frontend/app/lib/interviewerForm.ts, apps/frontend/app/interviewers/edit/formState.ts, apps/frontend/app/interviewers/edit/page.tsx, apps/frontend/tests/unit/interviewerFormDisplayName.test.ts
- load_bearing: false · gate_level: full · confidence: high
- depends_on: slice 1 merged (otherwise a save carrying the field fails with "Unknown field")

## Slice 3 - Preset and designer display names

- done_when: new `apps/backend/src/__tests__/presetDisplayNames.test.ts` fails on main and
  passes. It covers: the four presets carry Curious newcomer, Practice interviewer, Story
  listener and Thinking partner; the designer carries Design partner; `syncPresets` over rows
  without the field rewrites them, and a second sync updates 0; every preset is still at
  version 1. No existing test is modified. `gates.sh full` is GREEN. The PR includes a
  mock-mode screenshot of the session panel for one preset.
- files_expected: apps/backend/src/interviewer/presets/explainAnIdea.ts, apps/backend/src/interviewer/presets/rehearseAnInterview.ts, apps/backend/src/interviewer/presets/tellAStory.ts, apps/backend/src/interviewer/presets/workOutAPointOfView.ts, apps/backend/src/interviewer/presets/designer.ts, apps/backend/src/__tests__/presetDisplayNames.test.ts
- load_bearing: false · gate_level: full · confidence: high
- depends_on: slice 1 merged

## Queue plan (written only after approval)

- Four new issues, one per slice, each with its own `factory-handoff:v1` comment:
  - slices 0 and 1: `factory:ready-to-implement`
  - slices 2 and 3: `factory:wait-to-implement`, naming slice 1 as the blocker
- #44 becomes the umbrella. It is closed as superseded by the slice issues, with links.
- `QUEUE.md` snapshot updated with the four slices.
- A `spec` run record is written under `docs/factory/runs/`.

## Review-queue impact

At most two PRs open at once (slices 0 and 1), which is within the charter's limit of 3.
Slices 2 and 3 open only after slice 1 merges.
