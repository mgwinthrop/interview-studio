# Factory queue snapshot

The operational queue lives in GitHub issue labels. This file is a reviewable snapshot
written by `factory-triage` and reported by `/factory`; implementation routines query
GitHub directly.

An unmerged update to this file must never block a later routine from seeing work. Durable
run evidence lives in one file per run under `docs/factory/runs/`.

**Dispositions**

| Disposition | Next stage |
|---|---|
| `ready-to-implement` | factory-implement picks it up |
| `ready-to-spec` | human runs factory-spec |
| `needs-info` | parked, question is on the issue |
| `wait-to-implement` | parked, blocker named below |
| `awaiting-review` | PR open, human owns it |
| `done` | merged by a human |

The corresponding live labels use the `factory:` prefix, for example
`factory:ready-to-implement` and `factory:awaiting-review`. The live issue also carries a
`factory-handoff:v1` comment with the fields needed by implementation.

---

Snapshot from triage run `2026-11-14T163251Z-triage-run`, which re-triaged #40, #41 and #45 (the only open issues untriaged or updated since `2026-11-14T131849Z-triage-run`) and carries the other 18 entries forward from that run unchanged. Live labels on 2026-11-14: ready-to-implement 1, ready-to-spec 13, needs-info 3, wait-to-implement 3, in-progress 0, awaiting-review 0.

## Closed since the 2026-11-14T13:18Z snapshot
- FQ-42: merged in PR #63.
- FQ-44: superseded by spec FQ-44 (docs/factory/specs/FQ-44, PR #69); slices #65, #66, #67, #68 merged in PRs #71, #70, #72, #73.

---

## FQ-45: Use one vocabulary: interviewer, not persona
- disposition: ready-to-implement
- source: https://github.com/mgwinthrop/interview-studio/issues/45
- last_triaged: 2026-11-14
- repro: confirmed ("Persona selection" at FlowStepper.tsx:7; "persona(s) used" at dashboard/page.tsx:501)
- files_expected: apps/frontend/app/components/FlowStepper.tsx, apps/frontend/app/dashboard/page.tsx, apps/frontend/app/lib/interviewerWording.ts, apps/frontend/tests/unit/interviewerWording.test.ts
- load_bearing: false
- gate_level: full
- done_when: new interviewerWording.test.ts fails on main and passes (FLOW_STEPS step 2 is "Choose an interviewer"; interviewersUsedLabel gives "1 interviewer used" / "N interviewers used"); both files render them and contain no "persona" (case-insensitive); gates full GREEN
- confidence: medium
- notes: Narrowed after FQ-44 shipped the panel heading. "Persona" in the calls feature is deliberate (field and feature name) and out of scope; renaming it is an open product question.

## FQ-40: Use the microphone chosen on the mic check in the session
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/40
- last_triaged: 2026-11-14
- repro: confirmed (useVAD.ts getStream calls getUserMedia without deviceId; only the mic-check page reads one, and nothing stores it)
- files_expected: apps/frontend/hooks/useVAD.ts, apps/frontend/app/mic-check/page.tsx, apps/frontend/app/lib/micDevice.ts, apps/frontend/tests/unit/micDevice.test.ts
- load_bearing: true
- gate_level: deep
- done_when: decided at spec
- confidence: high
- notes: Load-bearing (useVAD.ts) and changes an existing interaction. Spec must settle persistence, the missing-device fallback and the auto-select behaviour.

## FQ-41: Serve ONNX Runtime WASM from the app instead of a CDN pinned to 1.24.3
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/41
- last_triaged: 2026-11-14
- repro: confirmed (installed onnxruntime-web 1.31.1; wasmPaths pinned to the jsDelivr 1.24.3 build). One unexplained runtime fetch failure was also seen in FQ-65 mock checks.
- files_expected: apps/frontend/hooks/useVAD.ts, apps/frontend/next.config.mjs
- load_bearing: true
- gate_level: deep
- done_when: decided at spec
- confidence: high
- notes: Suggested priority high. It is the only reliability defect seen in testing, and it means a third-party request on every session.

## FQ-43: Stop dimming the live transcript while the interviewer speaks
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/43
- last_triaged: 2026-11-14
- repro: confirmed (LiveTranscript.tsx:75 sets opacity 0.4 while aiSpeaking)
- files_expected: apps/frontend/app/components/LiveTranscript.tsx
- load_bearing: false
- gate_level: full
- done_when: Decided in spec
- confidence: high
- notes: Charter NEEDS_SPEC: changes an existing interaction (visual focus while the interviewer speaks). One-file change; a short spec suffices.

## FQ-46: Show latency and session ID in the live panel only in debug mode
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/46
- last_triaged: 2026-11-14
- repro: confirmed (AgentPanel.tsx:25-26)
- files_expected: AgentPanel.tsx, session/page.tsx, app/lib/debug.ts
- load_bearing: false
- gate_level: full
- done_when: Decided in spec
- confidence: high
- notes: Charter NEEDS_SPEC: removes visible elements and adds a debug flag, which changes an existing interaction.

## FQ-47: Confirm before ending a session
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/47
- last_triaged: 2026-11-14
- repro: not-attempted (interaction design, nothing to reproduce)
- files_expected: session/ModeParts.tsx, session/page.tsx
- load_bearing: false
- gate_level: full
- done_when: Decided in spec
- confidence: high
- notes: Charter NEEDS_SPEC: new interaction. Spec chooses confirm dialog versus undo.

## FQ-48: Let the speaker control turn-taking
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/48
- last_triaged: 2026-11-14
- repro: not-attempted (needs real microphone speech)
- files_expected: hooks/useVAD.ts, app/session/*, backend interviewer/schema.ts
- load_bearing: true
- gate_level: deep
- done_when: Decided in spec
- confidence: high
- notes: Touches load-bearing useVAD.ts and interviewer/schema.ts. Adopting Smart Turn is a dependency choice (NEVER_AUTOMATE), so the owner decides it inside the spec.

## FQ-49: Show that the mic is hearing you during the session
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/49
- last_triaged: 2026-11-14
- repro: confirmed (useVAD.ts:113 onSpeechStart is a no-op when the interviewer is silent)
- files_expected: hooks/useVAD.ts, AgentPanel.tsx, InterviewerAvatar.tsx, globals.css
- load_bearing: true
- gate_level: deep
- done_when: Decided in spec
- confidence: high
- notes: Touches load-bearing useVAD.ts; new avatar state must follow the avatar contract in CLAUDE.md.

## FQ-50: Render the transcript inside the report
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/50
- last_triaged: 2026-11-14
- repro: confirmed (ReportView.tsx:300 is a download link; transcript route is text/plain)
- files_expected: ReportView.tsx, components/report/*, backend reportRoutes.ts
- load_bearing: false
- gate_level: full
- done_when: Decided in spec
- confidence: high
- notes: Charter NEEDS_SPEC: user-visible feature and a REST route change. #51 depends on its answer cards.

## FQ-52: Show delivery progress across sessions, without scores
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/52
- last_triaged: 2026-11-14
- repro: not-attempted (feature request)
- files_expected: dashboard/page.tsx, new backend route
- load_bearing: false
- gate_level: full
- done_when: Decided in spec
- confidence: high
- notes: Charter NEEDS_SPEC: user-visible feature and a new REST route.

## FQ-55: Make the mic check a one-time step, not a gate
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/55
- last_triaged: 2026-11-14
- repro: confirmed (page.tsx:22-26 redirects when the sessionStorage flag is missing)
- files_expected: app/page.tsx, mic-check/page.tsx, hooks/useVAD.ts
- load_bearing: true
- gate_level: deep
- done_when: Decided in spec
- confidence: high
- notes: Touches load-bearing useVAD.ts and changes the start flow. Pairs with #40 and #54.

## FQ-56: Move Usage and Settings out of the main navigation
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/56
- last_triaged: 2026-11-14
- repro: confirmed (Nav.tsx lists Usage and Settings)
- files_expected: components/Nav.tsx, docs/usage.md
- load_bearing: false
- gate_level: full
- done_when: Decided in spec
- confidence: high
- notes: Charter NEEDS_SPEC: information-architecture change. #57 waits on it.

## FQ-58: Give each interviewer its own avatar variant and voice
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/58
- last_triaged: 2026-11-14
- repro: not-attempted (feature request)
- files_expected: InterviewerAvatar.tsx, backend providers/cloud.ts
- load_bearing: true
- gate_level: deep
- done_when: Decided in spec
- confidence: high
- notes: Touches load-bearing providers/**.

## FQ-59: Remove the second sidebar from the report when embedded in History
- disposition: ready-to-spec
- source: https://github.com/mgwinthrop/interview-studio/issues/59
- last_triaged: 2026-11-14
- repro: confirmed (dashboard/page.tsx:298 list plus ReportView.tsx:119 sidebar)
- files_expected: ReportView.tsx, dashboard/page.tsx
- load_bearing: false
- gate_level: full
- done_when: Decided in spec
- confidence: medium
- notes: Charter NEEDS_SPEC: user-visible layout change. Charter gap: no AUTOMATABLE entry covers layout-only changes.

## FQ-51: Turn report feedback into a next practice rep
- disposition: wait-to-implement
- source: https://github.com/mgwinthrop/interview-studio/issues/51
- last_triaged: 2026-11-14
- repro: not-attempted (feature request)
- files_expected: components/report/*, backend interviewer/prompt.ts, docs/websocket-protocol.md
- load_bearing: true
- gate_level: deep
- done_when: Decided in spec
- confidence: high
- notes: Blocked on #50: Redo this answer needs #50's answer cards. Re-triage to ready-to-spec once #50's spec is approved.

## FQ-57: Add navigation on phones
- disposition: wait-to-implement
- source: https://github.com/mgwinthrop/interview-studio/issues/57
- last_triaged: 2026-11-14
- repro: confirmed (globals.css:228 hides nav links below 768px)
- files_expected: components/Nav.tsx, globals.css
- load_bearing: false
- gate_level: full
- done_when: Decided in spec
- confidence: high
- notes: Blocked on #56: the phone menu should carry the items #56 settles.

## FQ-61: PhaseStrip: use studio tokens and remove the off-palette purple glow
- disposition: wait-to-implement
- source: https://github.com/mgwinthrop/interview-studio/issues/61
- last_triaged: 2026-11-14
- repro: confirmed (PhaseStrip.tsx:63 rgba(68,66,227,0.18))
- files_expected: components/PhaseStrip.tsx, globals.css
- load_bearing: false
- gate_level: full
- done_when: Decided after #60
- confidence: medium
- notes: Blocked on #60's styling decision. The purple-to-teal glow is a visible change, so it does not fit the charter's no-visual-change colour entry.

## FQ-53: Decide on opt-in replay kept only in the browser
- disposition: needs-info
- source: https://github.com/mgwinthrop/interview-studio/issues/53
- last_triaged: 2026-11-14
- repro: not-attempted (decision request)
- files_expected: depends on the decision
- load_bearing: true
- gate_level: deep
- done_when: Owner decision recorded in docs/factory/DECISIONS.md
- confidence: high
- notes: Charter NEVER_AUTOMATE: anything that would store audio. Question: Does opt-in, device-only recording (IndexedDB, never sent to the backend, deleted with the session) fit the promise that audio is never stored?

## FQ-54: Add a short pre-session brief with optional context
- disposition: needs-info
- source: https://github.com/mgwinthrop/interview-studio/issues/54
- last_triaged: 2026-11-14
- repro: not-attempted (decision request)
- files_expected: app/page.tsx, SessionLoader.tsx, backend interviewer/prompt.ts, docs/websocket-protocol.md
- load_bearing: true
- gate_level: deep
- done_when: Owner answers the question, then re-triage to ready-to-spec
- confidence: medium
- notes: Charter NEVER_AUTOMATE: sending new data to a third-party provider. Charter gap: "new data" is undefined. Question: Does text the user types into the brief (role, pasted job description) count as new data sent to Anthropic, given spoken answers already go there?

## FQ-60: Consolidate inline colours into the --studio-* tokens
- disposition: needs-info
- source: https://github.com/mgwinthrop/interview-studio/issues/60
- last_triaged: 2026-11-14
- repro: confirmed (39 component files use inline style objects)
- files_expected: docs/factory/DECISIONS.md
- load_bearing: false
- gate_level: fast
- done_when: Approach recorded in docs/factory/DECISIONS.md; per-component issues filed
- confidence: high
- notes: Charter NEVER_AUTOMATE: architectural direction. Question: Which styling approach: a Tailwind theme mapped to the --studio-* tokens, or CSS variables inside the existing inline styles?

## FQ-101: Remove the unused demo badge from the main navigation
- disposition: ready-to-implement (spec approved by the owner 2026-11-16)
- source: https://github.com/mgwinthrop/interview-studio/issues/101
- last_triaged: 2026-11-16
- repro: confirmed (Nav declares demo?: boolean; 7 files import Nav, none passes demo)
- files_expected: apps/frontend/app/components/Nav.tsx
- load_bearing: false
- gate_level: full
- done_when: Nav no longer declares demo or imports DemoBadge; DemoBadge stays for the session header; pages render unchanged; gates.sh full GREEN (compile-time proof by owner exception)
- confidence: high
- notes: Charter NEEDS_SPEC: changes the props of an exported component. Charter gap: unused-code removal has no AUTOMATABLE entry and cannot meet DONE's failing-test rule; the proposed proof is compile-time (tsc and build fail if a caller still passes demo), which needs owner acceptance.

## FQ-105: Correct the stale DemoBadge doc comment about the nav bar
- disposition: ready-to-implement
- source: https://github.com/mgwinthrop/interview-studio/issues/105
- last_triaged: 2026-11-16
- repro: confirmed (DemoBadge.tsx:14 mentions "the nav bar adds a right margin"; since #104 the only caller passes no style)
- files_expected: apps/frontend/app/components/DemoBadge.tsx
- load_bearing: false
- gate_level: full
- done_when: The DemoBadge doc comment no longer mentions the nav bar and describes current use; git diff shows only comment lines in that one file; grep for "nav bar" in the file finds nothing; gates.sh full GREEN
- confidence: high
- notes: Charter AUTOMATABLE: documentation and comment corrections. Proof is the textual check, not a failing test (charter gap, same as FQ-101). Out of scope: the now-unused style prop (exported props change, needs a spec).
