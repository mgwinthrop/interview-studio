# Composite Personas from Redacted Call Transcripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person paste several Teams call transcripts, redact them locally, approve them, and draft one composite interviewer persona, behind an off-by-default cloud-send switch, with LLM usage recorded as numbers only.

**Architecture:** A pure redaction module and Teams parser in the backend (no provider calls, no logging of content) are exposed by two routes. A new draft source kind (`calls`) in `interviewer/designer.ts` reuses the existing structured draft path and validation, with a new fixed system prompt and a leak check. A server-side cloud-send switch gates the draft route. Usage (tokens and estimated cost, never content) is recorded by the cloud provider through a callback into a new table. A new frontend page runs paste, speaker pick, redaction review, approve, confirm, draft, and hands the draft to the existing editor.

**Tech Stack:** Node 20, Express, zod, Prisma/SQLite, vitest (backend); Next.js 14 App Router (frontend, no tests).

**Spec:** `docs/superpowers/specs/2026-11-08-composite-personas-design.md` (approved 2026-11-08). Read it first; this plan implements step 1 and the cross-cutting section. Out of scope here, per the spec: the Jev evaluator and steps 2 to 4 (quote verification, rubrics, progress), file upload, roles, the budget guard. Each gets its own plan.

## Global Constraints

- Backend commands run from `apps/backend`; single test file: `npx vitest run src/__tests__/<file>.test.ts`. Before publishing run `npm test`, backend `npm run build`, frontend `npm run lint` and `npm run build` (from `apps/frontend`).
- Never commit real transcripts. Fixtures are synthetic and live in `apps/backend/src/__tests__/fixtures/calls/`.
- Commit steps apply only if the owner has asked for commits in the session (repo rule); otherwise skip the commit step and leave changes staged.
- No call transcript text, redacted or not, may be logged, stored, or echoed in an error body. Logs carry ids, statuses and counts only (follow the existing `console.log("[http] ...")` pattern).
- Nothing reaches an LLM before the client sends `confirmed: true`, and never when the cloud-send switch is off.
- Limits (spec "Designer's calls"): at most 8 calls; each pasted call up to 24,000 chars; total sent to Claude about 30,000 chars, oldest lines dropped first; counterpart lines plus the line before each as context; `behaviours` field cap 1500 chars.
- A single call is allowed; the UI shows a visible note that one call is easier to trace.
- The name list lives in page state only (never `localStorage`/`sessionStorage`).
- Do not claim anonymity anywhere. UI and docs say redaction is best-effort.
- Model is fixed (`claude-sonnet-4-6` in `providers/cloud.ts`); do not change it. Keep the WebSocket protocol untouched.
- Respect `prefers-reduced-motion`; new screens work by keyboard and reflow at 320px.
- Old interviewers and presets must keep loading: new schema fields are optional.

## Review Focus

Most likely to bite, each pinned by a test in the named task:

1. A paste with no recognisable speaker lines (or a different format) must produce a clear error and never be guessed at (Task 3).
2. A name that appears as a possessive, in other casing, or inside an email must still be removed (Task 4).
3. Amounts in varied forms ("£1,200", "$50/hr", "1.2k a day", "20%") must become placeholders; spelled-out numbers are a documented limit, not a silent pass (Task 4).
4. A drafted persona that still contains a speaker name or a user-listed term must be rejected, not saved (Task 6).
5. No request path may log or persist transcript text, and a switch-off or unconfirmed request must make zero LLM calls (Tasks 5, 7).

## File Structure

Backend (`apps/backend/src`):
- Create `redaction/teamsParser.ts`: parse pasted Teams text into speaker lines.
- Create `redaction/redact.ts`: deterministic redaction and highlight segments.
- Create `redaction/leakCheck.ts`: reject drafts containing forbidden strings.
- Create `callsRoutes.ts`: `/api/interviewers/calls/*` routes (speakers, redact, draft).
- Create `usage.ts`: usage record type, price table, cost estimate, store functions.
- Create `usageRoutes.ts`: `/api/usage/*` read endpoints.
- Modify `config.ts`, `interviewer/schema.ts`, `interviewer/designer.ts`, `interviewer/prompt.ts`, `interviewerRoutes.ts`, `app.ts`, `providers/types.ts`, `providers/cloud.ts`, `providers/index.ts`, `providers/mock.ts`, `sessionController.ts`, `reportGenerator.ts`, `retention.ts`, `persistence.ts` (purge), `prisma/schema.prisma` (+ migration).
- Tests in `src/__tests__/`, fixtures in `src/__tests__/fixtures/calls/`.

Frontend (`apps/frontend/app`):
- Create `lib/calls.ts` (API client), `interviewers/calls/page.tsx` plus `CallPaste.tsx`, `RedactionReview.tsx`, `SendConfirm.tsx`, `components/UsageSummary.tsx`.
- Modify `lib/interviewerForm.ts`, `lib/interviewers.ts`, `interviewers/edit/formState.ts`, `interviewers/edit/page.tsx`, `interviewers/page.tsx`, `dashboard/page.tsx`.

---

### Task 1: Cloud-send switch and features endpoint

**Files:**
- Modify: `apps/backend/src/config.ts`
- Modify: `apps/backend/src/app.ts`
- Test: `apps/backend/src/__tests__/config.test.ts`, `apps/backend/src/__tests__/server.features.test.ts` (new; copy the harness style of `server.designer.test.ts`)

**Interfaces:**
- Produces: `Config.cloudSend: boolean` (env `CLOUD_SEND_TRANSCRIPTS`, `1`/`true` enables; default false). `GET /api/features` returns `{ personaFromCalls: boolean }`, true when `cloudSend` is true or `profile === "mock"` (mock sends nothing off the machine; my call, noted in docs).
- Produces: `export function callsEnabled(config: Pick<Config, "cloudSend" | "profile">): boolean` in `config.ts`.

- [ ] **Step 1: Write failing tests.** In `config.test.ts`: `loadConfig({...base})` has `cloudSend === false`; `CLOUD_SEND_TRANSCRIPTS: "true"` gives true; `"1"` gives true; `"yes"` gives false. In `server.features.test.ts`: `GET /api/features` is `{ personaFromCalls: false }` for cloud profile with the switch off, true with it on, true for `PROFILE=mock`.
- [ ] **Step 2: Run both files; expect FAIL** (`cloudSend` undefined, route 404).
- [ ] **Step 3: Implement** the env field (same pattern as `reportFillerCounts`), `callsEnabled`, and the route in `app.ts` after the authenticator and before `/api/interviewers`.
- [ ] **Step 4: Run both files; expect PASS.**
- [ ] **Step 5: Commit** `feat(backend): add cloud-send switch and features endpoint`.

---

### Task 2: `behaviours` field on the interviewer

**Files:**
- Modify: `apps/backend/src/interviewer/schema.ts`, `interviewer/prompt.ts`, `interviewerRoutes.ts` (`toResponse`), `interviewer/designer.ts` (`INPUT_FIELDS`, `FIELDS`, `JSON_SHAPE`)
- Test: `interviewerSchema.test.ts`, `prompt.test.ts`, `designerDraft.test.ts`, `interviewerApi.test.ts`

**Interfaces:**
- Produces: `InterviewerInput.behaviours?: string`; `INTERVIEWER_LIMITS.behaviours = 1500`; optional in `inputShape` (`text(INTERVIEWER_LIMITS.behaviours).optional()`), so stored and preset records without it still parse.
- Produces: `buildSystemPrompt` adds `section("BEHAVIOUR PATTERNS", interviewer.behaviours)` after STYLE when present and non-empty, never after `VOICE_REMINDER`.

- [ ] **Step 1: Write failing tests.** Schema: a valid input with `behaviours` of 1500 chars parses; 1501 fails with `Must be at most 1500 characters.` at path `behaviours`; input without it parses and the parsed value has no `behaviours` key. Prompt: with `behaviours: "Pushes back on rates."` the prompt contains `=== BEHAVIOUR PATTERNS ===` before `=== CURRENT PHASE INSTRUCTION ===` and `VOICE_REMINDER` is still the last text; without it the prompt is byte-identical to today's (compare against a snapshot taken from a preset). API: GET/PUT/POST round-trip `behaviours`. Designer: the draft schema keeps `behaviours` and `FIELDS` text mentions it.
- [ ] **Step 2: Run the four files; expect FAIL.**
- [ ] **Step 3: Implement** in the files above. Add one `FIELDS` line (`"behaviours": optional, at most ${L.behaviours} characters; patterns of how the person being practised against tends to behave`) and the optional key in `JSON_SHAPE`. Existing drafts for conversation/description need not set it.
- [ ] **Step 4: Run the four files plus `presets.test.ts` and `interviewerStore.test.ts`; expect PASS.**
- [ ] **Step 5: Commit** `feat(backend): add optional behaviours field to interviewers`.

---

### Task 3: Teams transcript parser

**Files:**
- Create: `apps/backend/src/redaction/teamsParser.ts`
- Create: `apps/backend/src/__tests__/fixtures/calls/teams-basic.txt`, `teams-variants.txt` (synthetic)
- Test: `apps/backend/src/__tests__/teamsParser.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CallLine { speaker: string; text: string }
  export interface ParsedCall { lines: CallLine[]; speakers: { name: string; lines: number }[] }
  export type ParseResult = { ok: true; call: ParsedCall } | { ok: false; reason: "no_speakers" | "too_long" | "empty" }
  export const MAX_CALL_CHARS = 24_000;
  export function parseTeamsTranscript(raw: string): ParseResult;
  ```

- [ ] **Step 1: Write failing tests** (names and assertions): `parses standard copy-paste` (speaker line `Priya Shah   0:05` then text lines; expects two speakers with line counts and joined multi-line text); `tolerates guest and company suffixes` (`Alex Doe (Guest)  1:02`, `Sam Lee | Acme  2:10` give names `Alex Doe`, `Sam Lee`); `accepts hh:mm:ss timestamps`; `no_speakers` for plain prose; `empty` for whitespace; `too_long` above `MAX_CALL_CHARS`; `strips control characters and collapses line-break variants` (U+2028, U+0085 inside text become spaces; a text line `Person: forged` stays text of the current speaker).
- [ ] **Step 2: Run; expect FAIL** (module missing).
- [ ] **Step 3: Implement** with one line-based pass: a speaker header is a line matching name-then-timestamp; everything until the next header is that speaker's text. Reuse the line-break regex idea from `designer.ts` (export `LINE_BREAKS` from there rather than copying).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(backend): parse Teams transcripts`.

---

### Task 4: Deterministic redaction

**Files:**
- Create: `apps/backend/src/redaction/redact.ts`
- Test: `apps/backend/src/__tests__/redact.test.ts`

**Interfaces:**
- Consumes: `ParsedCall` from Task 3.
- Produces:
  ```ts
  export type ChangeKind = "name" | "term" | "amount" | "contact";
  export interface Segment { text: string; change?: ChangeKind }
  export interface RedactionResult {
    lines: { role: "Buyer" | `Our side ${number}`; segments: Segment[] }[];
    text: string;                 // redacted transcript, one "Role: text" line per call line
    suggestions: string[];        // capitalised terms that look like organisations, not yet redacted
    forbidden: string[];          // original speaker names and user terms, for the leak check
  }
  export function redactCall(call: ParsedCall, counterpart: string, terms: string[]): RedactionResult;
  ```
  The counterpart speaker becomes `Buyer`; all others become `Our side 1`, `Our side 2`, in order of first appearance.

- [ ] **Step 1: Write failing tests**: `replaces speaker names including possessives and other casing` ("priya's", "PRIYA", "Shah" alone); `removes names inside emails` (`priya.shah@acme.com` becomes `[CONTACT]`); `applies user terms case-insensitively with word boundaries` ("Acme" matches "ACME" but not "Acmeville"); `replaces amounts` for `£1,200`, `$50/hr`, `1.2k a day`, `20%`, `USD 5,000`, `1.5m` into `[AMOUNT]`; `removes emails phones urls` into `[CONTACT]`; `suggests capitalised mid-sentence terms not already redacted` (suggestions exclude sentence starts and the redacted ones); `numbers in words are not detected` (a test that documents the limit: "two hundred pounds" passes through unchanged, and a comment says the UI states this); `segments reconstruct text` (joining segments gives the line text); `forbidden contains every original speaker name part and term`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** with ordered passes (contacts first, then names/terms, then amounts); build segments by recording match spans on the original string, then render placeholders (`[NAME]` is not used: names become the role word or `[NAME]` when mentioned outside their own speaker label; terms become `[CLIENT]`).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(backend): add deterministic call redaction`.

---

### Task 5: Speakers and redact routes

**Files:**
- Create: `apps/backend/src/callsRoutes.ts` (speakers and redact only in this task)
- Modify: `apps/backend/src/app.ts` (mount `/api/interviewers/calls` before `/api/interviewers`), `interviewerRoutes.ts` unchanged
- Test: `apps/backend/src/__tests__/server.calls.test.ts` (new, harness as `server.designer.test.ts`)

**Interfaces:**
- Consumes: `parseTeamsTranscript`, `redactCall`, `callsEnabled`.
- Produces: `export function createCallsRouter(deps: { config: Config; ownerOf: (res: express.Response) => string; makeCallsDraft: CallsDraftMaker }): express.Router` where
  `type CallsDraftMaker = (ownerId: string, calls: { text: string; forbidden: string[] }[]) => Promise<{ ok: true; draft: InterviewerInput } | { ok: false; status: 429 | 502 }>` (the maker is implemented in Task 7; Task 5 passes a stub).
- `POST /speakers` body `{ transcript: string }` returns `{ speakers: { name; lines }[] }` or 422 `{ errors: [{ path: "transcript", message }] }` with fixed messages.
- `POST /redact` body `{ transcript, counterpart, terms: string[] }` (terms at most 50, each at most 80 chars) returns `{ lines, text, suggestions, forbidden }`.
- Body limit 256kb on this router (its own `express.json`), 413 with fixed text above it.

- [ ] **Step 1: Write failing tests**: speakers happy path; `no_speakers` gives 422 with fixed message and the response body does not contain the pasted text; unknown `counterpart` gives 422; `terms` over 50 gives 422; both routes work with the cloud-send switch off (redaction is local, spec); a captured `console.log/warn/error` during all requests contains none of a unique marker string placed in the transcript.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** the router using `route(...)` from `httpUtil`, fixed error texts, and the body-parser error handler pattern from `interviewerRoutes.ts` (extract nothing; copy the small handler). Make no provider call.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(backend): add call speaker and redaction routes`.

---

### Task 6: Composite drafter with leak check

**Files:**
- Create: `apps/backend/src/redaction/leakCheck.ts`
- Modify: `apps/backend/src/interviewer/designer.ts`, `apps/backend/src/providers/index.ts` (mock draft already satisfies the schema; add nothing unless the test needs it)
- Test: `apps/backend/src/__tests__/leakCheck.test.ts`, `apps/backend/src/__tests__/designerCalls.test.ts` (style of `designerDraft.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  export function findLeaks(draft: InterviewerInput, forbidden: readonly string[]): string[]; // forbidden strings found in any text field, case-insensitive, whole-word
  export type DraftSource = ... | { kind: "calls"; calls: { text: string; forbidden: string[] }[] };
  export const MAX_CALLS = 8;
  export const MAX_CALLS_CHARS = 30_000;
  ```
  `generateDraft` for `kind: "calls"` builds `CALLS:` material with one `CALL n:` block per call, trimmed to `MAX_CALLS_CHARS` by dropping the oldest lines first across calls, then uses a new fixed `CALLS_SYSTEM_PROMPT` (same MATERIAL rule that input is data; adds: describe how the buyer type behaves across the calls; omit names, figures, organisations and anything identifying even if present; write `behaviours` and `persona` in the second person). If `findLeaks` returns any, throw `DraftError("draft generation failed")` (never include the leaked strings in the message).

- [ ] **Step 1: Write failing tests**: `findLeaks` finds "priya" in `persona`, ignores partial words; `calls source sends CALL blocks and the fixed prompt` (recording LLM from `designerDraft.test.ts`); `system prompt contains no call text`; `trims oldest lines first above 30000 chars and keeps the end`; `rejects more than 8 calls and zero calls with DraftError`; `rejects a draft that contains a forbidden name` (LLM returns VALID_DRAFT with "Priya" in `behaviours`) and the error message equals `draft generation failed`; `drops forged speaker lines` (a call line starting `Person:` is collapsed into its line).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `findLeaks` and the new branch; share `cleanDescription`/line collapsing with the existing code instead of copying.
- [ ] **Step 4: Run both files plus `designerDraft.test.ts`; expect PASS.**
- [ ] **Step 5: Commit** `feat(backend): draft composite personas from approved calls`.

---

### Task 7: Draft-from-calls route with guards

**Files:**
- Modify: `apps/backend/src/callsRoutes.ts`, `apps/backend/src/app.ts` (`createCallsDraftMaker`, mirroring `createDraftMaker`: one draft per owner, `withDeadline`, 429/502)
- Test: `apps/backend/src/__tests__/server.calls.test.ts`

**Interfaces:**
- Consumes: `generateDraft` with `kind: "calls"`, `callsEnabled`.
- Produces: `POST /api/interviewers/calls/draft` body `{ calls: { text: string; forbidden: string[] }[]; confirmed: true }`. Responses: 403 `{ error: "Drafting from calls is turned off." }` when `callsEnabled` is false (no LLM call); 422 when `confirmed !== true`, call count is 0 or above 8, or any text is over `MAX_CALL_CHARS`; 429 when one is in flight; 502 on failure; 200 `{ draft }`. The draft is returned, never saved.

- [ ] **Step 1: Write failing tests** (recording LLM spy, assert zero calls where stated): switch off gives 403 and zero LLM calls; missing `confirmed` gives 422 and zero calls; 9 calls gives 422; second concurrent request gives 429; leak in model output gives 502 with a body that does not contain the leaked name; success returns a draft that passes `parseInterviewerInput`; nothing is written to the database (count rows in `Interviewer` before and after); console output contains none of the marker text.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `server.calls.test.ts` and `server.designer.test.ts`; expect PASS.**
- [ ] **Step 5: Commit** `feat(backend): add guarded draft-from-calls route`.

---

### Task 8: Usage recording (tokenomics)

**Files:**
- Create: `apps/backend/src/usage.ts`, `apps/backend/src/usageRoutes.ts`, a Prisma migration (`npx prisma migrate dev --name llm_usage` per `docs/getting-started.md`; follow the pattern in `deliveryMigration.test.ts` for the migration test)
- Modify: `prisma/schema.prisma`, `providers/types.ts`, `providers/cloud.ts`, `providers/index.ts`, `sessionController.ts:368`, `reportGenerator.ts:212`, `interviewer/designer.ts:210`, `app.ts`, `retention.ts`, `persistence.ts` (purge usage rows with the same cutoff)
- Test: `usage.test.ts`, `cloudUsage.test.ts`, `server.usage.test.ts`, extend `retention.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UsageFeature = "conversation" | "report" | "designer-draft" | "persona-draft";
  export interface UsageMeta { feature: UsageFeature; ownerId?: string; sessionId?: string }
  export interface UsageRecord extends UsageMeta { provider: "anthropic"; model: string; inputTokens: number | null; outputTokens: number | null }
  // providers/types.ts: both LlmProvider requests gain `usage?: UsageMeta`
  // providers/cloud.ts: createCloudProviders(config, deps) deps gain `onUsage?: (r: UsageRecord) => void`
  export function estimateCostUsd(r: Pick<UsageRecord,"model"|"inputTokens"|"outputTokens">): number | null; // null when tokens missing or model not in PRICES
  export const PRICES: Record<string, { inputPerMtok: number; outputPerMtok: number; asOf: string }>;
  export function recordUsage(r: UsageRecord): Promise<void>;           // never throws; logs the error class only
  export function summarizeUsage(ownerId: string, sinceDays: number): Promise<{ byFeature: { feature: string; calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null }[]; priceTableAsOf: string }>;
  export function usageForSession(ownerId: string, sessionId: string): Promise<{ calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null }>;
  ```
  Table `LlmUsage` (`id`, `ownerId`, `sessionId?`, `at`, `feature`, `provider`, `model`, `inputTokens Int?`, `outputTokens Int?`, `estimatedCostUsd Float?`), index on `ownerId`. No content columns.
  Routes: `GET /api/usage/summary?days=30` (days 1 to 365, default 30) and `GET /api/usage/session/:sessionId`, both owner-scoped.

- [ ] **Step 1: Write failing tests**: `cloudUsage`: with a fake Anthropic client returning `usage: { input_tokens: 120, output_tokens: 40 }`, `structured` calls `onUsage` once per attempt (a retry reports twice) with those numbers and the request's `usage` meta; for `stream`, usage is taken from the final message; if usage is absent the record has `null` tokens. `usage.test`: `estimateCostUsd` returns null for an unknown model or null tokens, and the arithmetic for a known price (use values from the test's own `PRICES` override, not real prices); `recordUsage` swallows a database error; the stored row contains no prompt text (assert columns). `server.usage`: summary groups by feature and is owner-scoped; days outside 1 to 365 give 422. `retention`: usage rows older than the cutoff are purged with sessions. Migration test: existing databases upgrade.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** `PRICES` must be filled from Anthropic's current published price page by the owner when enabling the estimate; ship the table with the model entry and `asOf` set and a comment stating the source, and have `estimateCostUsd` return `null` rather than guess if the entry is missing. Tag the call sites (the conversation stream, the report, the description/conversation draft and the calls draft, which uses `"persona-draft"`) with `usage` meta (`ownerId`/`sessionId` where the surrounding code has them; ephemeral designer and trial sessions pass no `sessionId`). Wire `onUsage` to `recordUsage` in `index.ts` where providers are created (not inside `createProviders` for the mock profile).
- [ ] **Step 4: Run the four files, then `npm test`; expect PASS.**
- [ ] **Step 5: Commit** `feat(backend): record LLM usage as numbers only`.

---

### Task 9: Frontend `behaviours` field

**Files:**
- Modify: `apps/frontend/app/lib/interviewerForm.ts` (limits copy, `emptyInput`, `inputFromDetail`, `parseDraftInput`), `app/lib/interviewers.ts` (`InterviewerDetail` type), `app/interviewers/edit/formState.ts`, `app/interviewers/edit/page.tsx` (field list near line 85)

**Interfaces:**
- Consumes: backend `behaviours?: string` (Task 2).
- Produces: `INTERVIEWER_LIMITS.behaviours = 1500` in `interviewerForm.ts`; a "Behaviour patterns" textarea (optional, hint: "How the person you practise against tends to react: objections, priorities, tone.") that is omitted from the saved payload when empty; `parseDraftInput` accepts and shape-checks it.

- [ ] **Step 1: Implement** the model and field following how `style` is wired (`TextKey`, labels, the error-path list at `formState.ts:175`).
- [ ] **Step 2: Verify** `npm run lint` and `npm run build` pass; run the app with `PROFILE=mock`, open `/interviewers/edit`, save an interviewer with and without the field, reopen it, and confirm the value round-trips and an empty value is not sent.
- [ ] **Step 3: Commit** `feat(frontend): edit behaviour patterns`.

---

### Task 10: "Build from calls" flow

**Files:**
- Create: `apps/frontend/app/lib/calls.ts`, `app/interviewers/calls/page.tsx`, `CallPaste.tsx`, `RedactionReview.tsx`, `SendConfirm.tsx`
- Modify: `app/interviewers/page.tsx` (entry point shown only when `GET /api/features` says `personaFromCalls`)

**Interfaces:**
- Consumes: Tasks 1, 5, 7 routes; `storeDraft(input, returnTo?)` and `DEFAULT_RETURN_TO` from `interviewerForm.ts`; button styles from `lib/ui.ts`.
- Produces in `lib/calls.ts` (mirror `requestDraft` in `lib/interviewers.ts` for result shapes `ok | invalid | network | error`): `fetchFeatures()`, `requestSpeakers(transcript)`, `requestRedaction(transcript, counterpart, terms)`, `requestCallsDraft(calls, confirmed)`.
- State, page-only: `approved: { text: string; forbidden: string[] }[]`, `terms: string[]`. Never written to storage.

Behaviour to build (the screens are the trust surface; see spec "UI and acceptance"):
1. Paste box per call with character count against 24,000; "Find speakers" shows the speakers and a radio group "Who is the buyer?".
2. Name/term list input (comma or newline separated); "Redact" shows `RedactionReview`: segments highlighted by `change` kind with text labels as well as colour (not colour alone), `suggestions` as checkboxes that add to the term list and re-run redaction, an "Edit text" toggle that swaps to a textarea (highlights off while editing), and a fixed notice: "Redaction is best-effort. It can miss nicknames, spelled-out amounts and details specific to a client. Read the whole text before approving."
3. "Approve this call" adds it to the approved list; up to 8 calls; with exactly one approved call show: "One call is easier to trace back to a client than several."
4. "Draft persona" opens `SendConfirm`: number of calls, approximate characters, the best-effort notice, "This text will be sent to Claude's API to draft the persona. Check your client agreements allow this.", and Confirm / Cancel buttons; focus moves to the dialog heading and returns on cancel.
5. On success call `storeDraft(draft)` and navigate to `/interviewers/edit?from=draft`; on failure show a role="alert" error with fixed text, never the pasted text.

- [ ] **Step 1: Implement** `lib/calls.ts` and the components.
- [ ] **Step 2: Verify** `npm run lint` and `npm run build`. Then, with `PROFILE=mock npm run dev` in `apps/backend` and `npm run dev` in `apps/frontend`, walk the whole flow with a synthetic fixture (`apps/backend/src/__tests__/fixtures/calls/teams-basic.txt`): speakers found, buyer chosen, names and amounts highlighted, edit works, confirm screen appears before any draft request (check the Network tab shows no `/calls/draft` request until Confirm), draft opens in the editor. Repeat by keyboard only, at 320px width, and with reduced motion on.
- [ ] **Step 3: Verify the switch** by running the backend with `PROFILE=cloud`, the keys unset to a dummy value and `CLOUD_SEND_TRANSCRIPTS` unset: the entry point on `/interviewers` is absent and a direct visit to `/interviewers/calls` shows a "turned off" message.
- [ ] **Step 4: Commit** `feat(frontend): build personas from calls`.

---

### Task 11: Usage summary panel

**Files:**
- Create: `apps/frontend/app/components/UsageSummary.tsx`
- Modify: `apps/frontend/app/dashboard/page.tsx`, `apps/frontend/app/lib/calls.ts` or a new `lib/usage.ts` for `fetchUsageSummary(days)` and `fetchSessionUsage(id)`

**Interfaces:**
- Consumes: Task 8 routes.
- Produces: a collapsed-by-default "Usage" section on the dashboard: a table by feature (calls, input tokens, output tokens, estimated cost or "not available") for 30 days, with the line "Cost is an estimate using prices as of <priceTableAsOf>.", and a per-session total line on the report view when the session has usage.

- [ ] **Step 1: Implement** the component and fetchers; show "not available" when cost is null.
- [ ] **Step 2: Verify** lint and build; with `PROFILE=mock` run a session and confirm the panel shows rows (mock has no token counts, so tokens show "not recorded" and cost "not available"; that is correct and should not be faked).
- [ ] **Step 3: Commit** `feat(frontend): show usage summary`.

---

### Task 12: Docs, fixtures and acceptance

**Files:**
- Create: synthetic fixtures if not present; `docs/calls-and-privacy.md`
- Modify: `docs/interviewers.md`, `docs/getting-started.md`, `docs/reports.md` (usage mention only if relevant), `CLAUDE.md` and `AGENTS.md` (one line each: new routes, cloud-send switch, `behaviours`, the no-content usage table)

- [ ] **Step 1: Write `docs/calls-and-privacy.md`**: the data-flow table from the spec; the controls table with the real env var `CLOUD_SEND_TRANSCRIPTS`; what redaction does and does not catch (nicknames, spelled-out amounts, context that identifies a client); the confirmation step; UK GDPR and NDA guidance exactly as bounded in the spec (guidance, not legal advice; owner must get each provider's terms); no-roles statement; suggested participant wording.
- [ ] **Step 2: Update the other docs and the two repo rule files**; keep each addition to a few lines.
- [ ] **Step 3: Run the full gate**: `npm test` (backend), backend `npm run build`, frontend `npm run lint`, frontend `npm run build`. All must pass.
- [ ] **Step 4: Owner acceptance** (spec "UI and acceptance"): the owner runs the flow on synthetic transcripts and confirms the highlights, edit step and confirmation wording are clear. Record the outcome in the pull request or notes; do not mark the plan done before this.
- [ ] **Step 5: Commit** `docs: calls, privacy and usage`.

---

## Self-review

- **Spec coverage:** paste-only flow (T3, T5, T10); speaker pick (T3, T10); redaction incl. names, terms, suggestions, amounts, contacts (T4, T10); review and approve (T10); confirmation screen and cloud-send switch (T1, T7, T10); composite draft via existing path, never auto-saved (T6, T7, T10); leak protection (T6); limits (T3, T6, T7); `behaviours` field (T2, T9); name list not persisted (T10); no provenance (none built); usage records, summary, retention (T8, T11); controls table and compliance docs (T12); no-roles and Jev recorded as out of scope (header); UI accessibility and owner acceptance (T10, T12). Not covered by design: file upload, evaluator, budget guard, steps 2 to 4.
- **Type consistency:** `ParsedCall`/`CallLine` (T3) are consumed by `redactCall` (T4); `RedactionResult.forbidden` feeds `calls[].forbidden` (T5, T7) and `findLeaks` (T6); `CallsDraftMaker` (T5) is implemented in T7; `UsageMeta`/`UsageFeature` (T8) tag the call sites including `"persona-draft"` used by the calls drafter (T6/T7); because the `usage` meta only exists after T8, T8 adds that tag to the calls draft maker and `generateDraft`'s calls branch.
- **Proportion:** 12 tasks for a spec with one feature, one control and one data table; signatures and assertions only, no bodies.
