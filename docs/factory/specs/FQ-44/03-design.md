# FQ-44 Gate 3 - Program design

Signatures and contracts only, no implementations. Paths are relative to the repository root.

## Files

### Backend

| File | New/modified | Change |
|---|---|---|
| `apps/backend/src/interviewer/schema.ts` | modified, **load-bearing** | `displayName?: string` on `InterviewerDefinition`; `INTERVIEWER_LIMITS.displayName = 40`; optional key in the input and definition zod objects, using the same text rule as `name` |
| `apps/backend/src/interviewerStore.ts` | modified | `inputFields` copies `displayName` when defined |
| `apps/backend/src/interviewer/presets/explainAnIdea.ts` | modified | `displayName: "Curious newcomer"` |
| `apps/backend/src/interviewer/presets/rehearseAnInterview.ts` | modified | `displayName: "Practice interviewer"` |
| `apps/backend/src/interviewer/presets/tellAStory.ts` | modified | `displayName: "Story listener"` |
| `apps/backend/src/interviewer/presets/workOutAPointOfView.ts` | modified | `displayName: "Thinking partner"` |
| `apps/backend/src/interviewer/presets/designer.ts` | modified | `displayName: "Design partner"` |
| `apps/backend/src/__tests__/interviewerSchema.test.ts` | modified, **approved at gate 2 (C)** | add `displayName: 40` to the exact `INTERVIEWER_LIMITS` assertion, and nothing else |
| `apps/backend/src/__tests__/displayName.test.ts` | new | see test list |
| `apps/backend/src/__tests__/server.displayName.test.ts` | new | HTTP and WebSocket round trips via the shared server harness |
| `docs/interviewers.md` | modified | field, limit, fallback, roll-forward note |

### Frontend

| File | New/modified | Change |
|---|---|---|
| `apps/frontend/app/lib/speakerLabels.ts` | new | pure label helpers |
| `apps/frontend/app/lib/interviewers.ts` | modified | `displayName?: string` on `InterviewerInput` (and so on `InterviewerDetail`) |
| `apps/frontend/app/lib/interviewerForm.ts` | modified | `INTERVIEWER_LIMITS.displayName = 40`; `inputFromDetail` and `parseShape` carry it |
| `apps/frontend/app/interviewers/edit/formState.ts` | modified | form field; omitted when blank; `TOP_LABELS` entry "Display name" |
| `apps/frontend/app/interviewers/edit/page.tsx` | modified | one text field after Name, with a hint ("Who the person talks to, shown during the session. Optional.") |
| `apps/frontend/app/session/page.tsx` | modified | derive `displayedOrbState` and `interviewerSpeaking` once; pass `displayName` and `purpose` |
| `apps/frontend/app/components/AgentPanel.tsx` | modified | props `displayName`, `purpose`; heading and tagline from them |
| `apps/frontend/app/components/LiveTranscript.tsx` | modified | props `interviewerName`, `interviewerSpeaking` replace the label literals; the dim stays on `aiSpeaking` |
| `apps/frontend/app/globals.css` | modified | clamp `.interviewer-heading p` to 3 lines |
| `apps/frontend/tests/unit/speakerLabels.test.ts` | new | see test list |
| `apps/frontend/tests/unit/interviewerFormDisplayName.test.ts` | new | see test list |

## Contracts

```ts
// apps/backend/src/interviewer/schema.ts
export interface InterviewerDefinition { /* existing fields */ displayName?: string }
export const INTERVIEWER_LIMITS: { /* existing */ displayName: 40 }
// parseInterviewerInput / parseInterviewerDefinition: unchanged signatures.
//   displayName absent      -> ok, key absent in value
//   displayName "Ada"       -> ok
//   displayName ""          -> error "This field is required." (existing text() rule)
//   displayName > 40 chars  -> error at path "displayName"

// apps/backend/src/interviewerStore.ts (internal)
function inputFields(input: InterviewerInput): InterviewerInput
//   copies displayName iff input.displayName !== undefined

// apps/frontend/app/lib/speakerLabels.ts
export const FALLBACK_INTERVIEWER_LABEL = "Interviewer";
export function interviewerLabel(displayName: string | undefined): string
//   trimmed displayName, or FALLBACK_INTERVIEWER_LABEL if absent or blank
export function speakerLabel(role: "user" | "assistant", displayName: string | undefined): string
//   "You" for user; interviewerLabel(displayName) for assistant
export function speakerBadge(role: "user" | "assistant", displayName: string | undefined): string
//   first whole code point of speakerLabel(...), upper-cased ("Y" for user)

// apps/frontend/app/session/page.tsx (local, not exported)
const displayedOrbState: OrbState  // = audioPlaying && orbState !== "interrupted" ? "speaking" : orbState
const interviewerSpeaking: boolean // = displayedOrbState === "speaking"

// apps/frontend/app/components/AgentPanel.tsx
interface AgentPanelProps { /* existing */ displayName?: string; purpose: string }
//   <h2>{interviewerLabel(displayName)}</h2><p>{purpose}</p>; eyebrow unchanged

// apps/frontend/app/components/LiveTranscript.tsx
interface LiveTranscriptProps {
  entries: TranscriptEntry[];
  aiSpeaking: boolean;          // opacity dim only (#43 owns it)
  interviewerSpeaking: boolean; // "••• Speaking" badge and "<name> speaking" label
  interviewerName?: string;     // displayName
}
```

## Main call stack (live session, listening after a reply)

1. `SessionPageInner` loads `InterviewerDetail` → `interviewer.displayName`, `interviewer.purpose`.
2. `useWebSocket` → `tts_end` → `aiSpeaking = false`. `audioQueue` still playing → `audioPlaying = true`.
3. `page.tsx`: `displayedOrbState = "speaking"` → `interviewerSpeaking = true`. The panel and
   transcript both say speaking.
4. Playback ends → `audioPlaying = false` → `displayedOrbState = "listening"` →
   `interviewerSpeaking = false`. Both change in the same render.
5. `LiveTranscript` → `speakerLabel("assistant", interviewerName)` + (`interviewerSpeaking`
   ? " speaking" : "") on the current question.

## Test list

Backend, new files:

| Test | Proves |
|---|---|
| `displayName.test.ts`: definition without the field parses | old snapshots, rows and drafts still load |
| same: 40 chars accepted, 41 rejected at `displayName`, `""` rejected | limit and text rule |
| same: each of the 5 synced presets has its approved display name | presets carry the decision |
| same: `syncPresets` on a database holding version-1 presets without the field rewrites them, and a second sync updates 0 | sync without a version bump, idempotent |
| `server.displayName.test.ts`: POST then GET round-trips `displayName`; PUT changes it; duplicate keeps it | the `inputFields` allowlist is fixed (fails on main: field dropped or rejected) |
| same: `session_start` with a `draft` carrying `displayName` starts a trial; with 41 chars it closes 1008 | the Try it path (load-bearing at runtime) |

Frontend, new files:

| Test | Proves |
|---|---|
| `speakerLabels.test.ts`: "You"/"Y"; name and initial; blank or absent gives "Interviewer"/"I"; non-BMP first character | labels and fallback |
| `interviewerFormDisplayName.test.ts`: `inputFromDetail` keeps the field; `parseShape` keeps it and still accepts a draft without it; the form omits it when blank | editor and hand-off do not erase it |

Not automated, checked by hand in mock mode with screenshots in the PR: panel heading and
tagline for a preset, a custom interviewer without a name, and design mode; the speaking
label clearing at the same moment as the panel.

Existing test changed: only the approved `INTERVIEWER_LIMITS` assertion.

## The three decisions I am least confident about

1. **The panel's speaking state becomes the transcript's.** It includes local playback after
   `tts_end`, which is right for gate 1. But "Speaking" in the transcript header now lasts as
   long as audio plays. If the audio queue ever sticks (`audioPlaying` stays true), both now
   stick together instead of disagreeing. That is better for consistency, but the defect is
   more visible. It is not testable in unit tests, because the session page has no component
   tests, so this rests on the manual check.
2. **Purpose as the panel tagline.** Purposes are written as instructions to the person
   ("Practise answering interview questions…"). They read well for presets, but a custom
   purpose can be 200 characters of anything. A 3-line clamp hides the overflow but may cut
   mid-sentence. The alternative is to keep the fixed tagline and change only the heading.
3. **No server test for preset sync against real old rows.** The sync test seeds rows in the
   current format without the field. It does not replay a real database from before this
   change. Because `definitionJson` comparison is a string compare, I believe it is
   equivalent, but `interviewerMigration.test.ts` may hold a better fixture to reuse, and I
   have not confirmed that.
