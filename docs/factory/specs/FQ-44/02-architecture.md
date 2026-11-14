# FQ-44 Gate 2 - Architecture (revision 2, amended)

> **Amendment 2026-11-14 (post-approval, implementation finding):** slice 1 (#66, PR #70) found a
> third field allowlist, `toResponse` in `interviewerRoutes.ts`, which this document did not list.
> It is added to "Systems touched" below. No decision changed. Slice 2 should check the frontend
> for further allowlists beyond `inputFromDetail` and `parseShape` before claiming done.

Implements the approved product gate: an optional per-interviewer display name; the session
panel and transcript show it (fallback "Interviewer"); the transcript's "speaking" wording
follows the same state as the panel.

Revision 2 incorporates the `factory-critic` review of revision 1 (see "Critic review" at
the end). The critic's file and line claims were checked against the code before this
revision.

## Systems touched

| Area | Change | Load-bearing |
|---|---|---|
| Interviewer record (`apps/backend/src/interviewer/schema.ts`) | Optional `displayName` on the definition and input types, plus its limit (40) in `INTERVIEWER_LIMITS` | **yes** |
| Interviewer store (`apps/backend/src/interviewerStore.ts`) | `inputFields` is an allowlist used by create, update and duplicate. It must copy `displayName`, or saves succeed and silently drop it | no |
| Interviewer routes (`apps/backend/src/interviewerRoutes.ts`) | `toResponse` is a third allowlist: without it the field is stored but never returned. **Added after approval** (found by slice 1's tests, PR #70; missed by revision 2 and the critic) | no |
| Presets (`apps/backend/src/interviewer/presets/*.ts`) | Four presets get their approved role names. **No version bump**: `syncPresets` already rewrites a row whose `definitionJson` differs | no |
| Docs (`docs/interviewers.md`) | Document the field, limit, fallback and the rollback note below | no |
| Frontend types and form (`app/lib/interviewers.ts`, `app/lib/interviewerForm.ts`, `app/interviewers/edit/*`) | Field on the types and the limits copy. `inputFromDetail` (an allowlist: opening and saving would erase the name) and `parseShape` (draft hand-off) carry it. The editor gets one optional field and omits it when blank, as it already does for `behaviours` | no |
| Session UI (`app/session/page.tsx`, `app/components/AgentPanel.tsx`, `app/components/LiveTranscript.tsx`) | One derived `interviewerSpeaking` value feeds both components. The panel shows the display name and purpose. The transcript labels "You" and the display name | no |
| New helper (`app/lib/speakerLabels.ts`) | Pure label, initial and fallback logic | no |

## Reached at runtime without editing (stated so a reviewer sees them)

These load-bearing contracts are widened by the schema change, though their files do not
change:

- **POST/PUT `/api/interviewers` bodies** accept one more optional key.
- **WebSocket `session_start.draft`** (Try it) is validated by the same strict schema
  (`wsMessages.ts:68-74`). `docs/websocket-protocol.md:73` defines it as "the same shape and
  rules as the body of POST /api/interviewers", so the protocol doc stays accurate without an
  edit. It gains the field by reference.
- **Session snapshots** (`Session.interviewerJson`) can now contain the field.

## Data structures

No new endpoint, no database schema change, no migration.

- `displayName?: string`: at most 40 characters, same text rules as `name`. Absent is valid;
  `""` is rejected by the schema, so clients omit a blank value.
- Stored inside `Interviewer.definitionJson` and snapshotted into `Session.interviewerJson`.
- `GET /api/interviewers/:id` returns it. The summary list is unchanged.

## Call flow

1. **Startup.** `syncPresets` sees a changed `definitionJson` for four presets and rewrites
   them. The version stays 1.
2. **Create, edit, duplicate.** Editor → `POST`/`PUT` → `parseInterviewerInput` →
   `inputFields` (now copies `displayName`) → `definitionJson`. Duplicate also goes through
   `inputFields`, so a duplicated preset keeps its display name.
3. **Draft hand-off.** `parseShape` carries the field through `sessionStorage`.
   `detailFromDraft` already spreads the input, so Try it shows the name. The generators
   (`designer.ts`, `callsRoutes.ts`) keep only their listed fields, so generated drafts fall
   back to "Interviewer" until a person types a name.
4. **Session display.** `page.tsx` already loads `InterviewerDetail`. It passes `displayName`
   and `purpose` to the panel and `displayName` to the transcript.
5. **Speaking state, the corrected flow.** Today the panel shows speaking when
   `audioPlaying && orbState !== "interrupted"`, or when `orbState` is speaking
   (`page.tsx:476`). `audioPlaying` includes buffered speech after `tts_end`. The transcript
   gets only `aiSpeaking` (`page.tsx:493`), which is the root of the contradiction. The page
   will compute the panel's displayed state **once** and derive
   `interviewerSpeaking = displayedState === "speaking"`. That one value drives:
   - the panel (unchanged behaviour)
   - the current-question label ("<name> speaking" versus "<name>")
   - the transcript header's "••• Speaking" badge (`LiveTranscript.tsx:104`)

   The transcript's opacity dim (`LiveTranscript.tsx:75`) stays on `aiSpeaking`. Changing it
   is #43.

## Ordering

The backend must accept the field before any client sends it. Otherwise saves fail with
"Unknown field", and Try it of a draft carrying the field closes the socket with 1008
"invalid draft". The schema, `inputFields` and preset changes therefore ship together in the
first slice, and the frontend form follows.

## Existing tests that must change (needs your explicit approval)

`TESTS_ARE_LOAD_BEARING: true`. One existing test must change:

- `apps/backend/src/__tests__/interviewerSchema.test.ts:419-433` pins `INTERVIEWER_LIMITS`
  with an exact `toEqual`. Adding `displayName: 40` requires adding that key.
  `docs/interviewers.md:127` already says this test moves with the limits. The slice that
  makes this change is a draft PR with a human read.

Revision 1's version bump would have forced a second edit, to `presets.test.ts:34`. It is
dropped.

## Load-bearing paths

- Edited: `apps/backend/src/interviewer/schema.ts` only. That slice uses `deep` gates and gets
  a human read.
- Not edited: `prompt.ts`, `prisma/**`, `persistence.ts`, `wsServer.ts`, `wsMessages.ts`,
  `callsRoutes.ts`, `providers/**`, `docs/websocket-protocol.md`.

## What could break elsewhere

1. **Rollback is one-way.** The definition schema is `.strict()`. If this is reverted after
   any interviewer or snapshot contains `displayName`, those interviewers drop out of the
   list (`toRecord` returns null) and their past reports show "Earlier interview"
   (`parseSnapshot` returns null). Mitigation: roll forward rather than revert. A revert must
   first strip the key, or must keep the field in the schema while removing the UI.
2. **Old snapshots and drafts** without the field still parse, because it is optional.
   Pinned by new tests.
3. **Design mode.** The hidden designer preset has no display name, so the panel would read
   "Interviewer" plus the designer's purpose. See decision B.
4. **Tagline length.** A custom purpose can be 200 characters. The panel column is about 240px
   wide. Clamping or truncation is decided at gate 3.
5. **Playwright smoke test.** `/Listening/` is case-sensitive and does not match "Story
   listener". No e2e assertion uses the changed strings.

## Oracle

Not a migration. The existing unit and keyless conversation tests are the baseline. New test
files will pin:

- an old definition without the field parses
- the limit is enforced
- create, update and duplicate keep the field
- a Try it draft with the field is accepted, and a too-long one is rejected with 1008
- presets carry their role names after sync
- the label helper's fallback
- the speaking label and badge follow `interviewerSpeaking`, including after `tts_end` while
  audio is still playing

## Decisions (owner, gate 2, 2026-11-14): A You/Y; B "Design partner"; C test edit approved; D roll-forward accepted

## Decisions as asked at this gate

- **A. User label.** Gate 1 said the person's turns "stay You", but today they are
  "Participant"/"U". Proposed: change to "You"/"Y", as the approved mockup shows.
- **B. Design mode.** Proposed: the hidden designer preset gets the display name "Design
  partner". The alternative is the fallback "Interviewer".
- **C. Test edit.** Approve the one `INTERVIEWER_LIMITS` test edit above.
- **D. Rollback.** Accept that rollback is roll-forward only.

## Critic review (revision 1)

Verdict: needs changes before approval. Findings and how revision 2 resolves them:

1. HIGH, speaking signal wrong → call flow step 5 rewritten around the panel's real state.
   The header badge is covered.
2. HIGH, `inputFields` and `inputFromDetail` allowlists drop the field → both moved into
   "touched".
3. MEDIUM, existing test edits unstated; version bump unnecessary → bump dropped, one test
   edit listed for approval.
4. MEDIUM, Try it and the protocol reached via the schema → "Reached at runtime", ordering and
   oracle updated.
5. MEDIUM, "You" label undecided → decision A.
6. LOW, one-way rollback → risk 1 and decision D.
7. LOW, design mode, blank field, tagline length, eyebrow, stale status file → decision B,
   omit-when-blank, gate 3, eyebrow kept as "YOUR AI INTERVIEWER", status file already
   updated.
