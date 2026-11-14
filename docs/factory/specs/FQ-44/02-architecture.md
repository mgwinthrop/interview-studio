# FQ-44 Gate 2 - Architecture

Implements the approved product gate: an optional per-interviewer display name; the session
panel and transcript show it (fallback "Interviewer"); the transcript's "speaking" label
follows the same signal as the panel.

## Systems touched

| Area | Change | Load-bearing |
|---|---|---|
| Interviewer record (`apps/backend/src/interviewer/schema.ts`) | New optional field `displayName` on `InterviewerDefinition`/`InterviewerInput`; limit and validation added | **yes** |
| Presets (`apps/backend/src/interviewer/presets/*.ts`, four files) | Each gets its approved role name; `version` bumped 1 → 2 so the stored rows update | no |
| Preset sync (`interviewerStore.ts`) | None. `syncPresets` already rewrites a row when `definitionJson` or `version` differs | no |
| Docs (`docs/interviewers.md`) | Document the field, its limit and its fallback | no |
| Frontend types and form (`app/lib/interviewers.ts`, `app/lib/interviewerForm.ts`, `app/interviewers/edit/*`) | Field on the input/detail types, the limits copy, the sessionStorage shape check, one optional editor field | no |
| Session UI (`app/components/AgentPanel.tsx`, `app/components/LiveTranscript.tsx`, `app/session/page.tsx`) | Panel heading and tagline from the interviewer; transcript labels; "speaking" gated by the existing `aiSpeaking` prop | no |
| New helper (`app/lib/speakerLabels.ts`) | Pure display-name/initial/fallback logic, unit-tested | no |

## Data structures

No new endpoint, no route change, no database schema change, no migration.

- `InterviewerDefinition.displayName?: string`, at most 40 characters, same text rules as
  `name` (trimmed, no control characters). Optional, and absent is valid.
- It is stored inside the existing `Interviewer.definitionJson` column and travels inside
  the existing `Session.interviewerJson` snapshot. Neither column changes.
- `GET /api/interviewers/:id` returns the full definition, so the field appears in its
  response automatically. `GET /api/interviewers` (the summary list) is unchanged.
- An exported type gains an optional field. Under the charter that is a `NEEDS_SPEC` item,
  which is why it is here.

## Call flow

1. **Startup.** `syncPresets` sees version 2 for each preset and rewrites the four rows with
   the new `definitionJson`. The hidden designer preset is unchanged.
2. **Create or edit.** Editor form → `POST`/`PUT /api/interviewers` → `parseInterviewerInput`
   accepts the optional `displayName` → stored in `definitionJson`.
3. **Draft hand-off** (designer, describe-it, calls). The draft travels through
   `sessionStorage` and `parseShape`, which rebuilds the object field by field. It must carry
   `displayName` through when present. The generators (`designer.ts`, `callsRoutes.ts`) do
   not produce it in this scope, so their drafts fall back to "Interviewer" until a person
   types one in the editor.
4. **Session.** The page loads `InterviewerDetail` (already the case) → passes
   `displayName` and `purpose` to the panel and the transcript → the helper resolves
   `displayName.trim() || "Interviewer"` and its initial.
5. **Speaking label.** The transcript already receives `aiSpeaking`, the same server
   `tts_start`/`tts_end` state that drives the panel's speaking/listening switch. The
   current-question label appends "speaking" only while it is true.

## External dependencies

None added.

## Load-bearing paths

- `apps/backend/src/interviewer/schema.ts`: required for the new field. Forces `deep` gates
  and a human read on that slice.
- Explicitly **not** touched: `interviewer/prompt.ts` (the interviewer is not told its name,
  per gate 1), `prisma/**`, `persistence.ts`, `wsServer.ts`, `wsMessages.ts`,
  `callsRoutes.ts`, `providers/**`, `docs/websocket-protocol.md`.

## What could break elsewhere

1. **Strict validation in both directions.** `schema.ts` rejects unknown keys. If the
   frontend sends `displayName` before the backend accepts it, every save fails. The backend
   field must ship first, or in the same slice.
2. **Old snapshots and old drafts.** Sessions stored before this change have no
   `displayName` in their snapshot, and neither do drafts in a browser tab. Both must still
   parse. Optional plus fallback covers it; tests must pin it.
3. **Preset version bump.** Bumping `version` changes what the editor's version check sees
   for presets. Presets are read-only and cannot be updated through `PUT`, so the risk is
   low, but a test should confirm the sync rewrites the rows exactly once.
4. **Duplicate.** Duplicating an interviewer copies its definition. A duplicated preset keeps
   "Practice interviewer", which is probably right, but the person may not notice. Accepted.
5. **The Playwright smoke test.** It waits for text on the session page. It must not depend on
   "AI interviewer" or "Interviewer speaking" (checked: it does not).
6. **The speaking signal.** The panel's "speaking" state comes from `aiSpeaking`, while the
   microphone's barge-in logic uses `aiSpeaking || audioPlaying`. Matching the panel meets the
   gate 1 criterion. Any gap between the server's `tts_end` and the end of local playback
   already exists and is not widened here.

## Oracle

Not a migration. The existing unit and keyless conversation tests are the regression
baseline. New tests pin: an old definition without the field still parses, the limit is
enforced, presets sync to version 2, the label helper's fallback, and the speaking label
following `aiSpeaking`.
