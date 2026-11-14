item: FQ-41
scope: load voice detection's runtime from the app, not a CDN; no silent failure when hearing cannot start
gate_1_product: approved 2026-11-14 (owner; re-approved after the evidence correction)
gate_2_architecture: approved 2026-11-14 (owner, with the critic-driven decisions recorded at the end of 02-architecture.md)
gate_3_design: waived by owner 2026-11-14 (one interactive PR)
gate_4_slices: waived by owner 2026-11-14 (single slice, issue #41)
slices_completed: implemented in PR #77 (draft, awaiting owner review)
decisions:
  - Include the "can't hear you" message (owner, gate 1)
  - Message wording as proposed (owner, gate 1)
open_questions:
evidence:
  - CORRECTED: the 'no available backend found ... Failed to fetch' errors seen on 2026-11-14 were the sandbox's network policy refusing cdn.jsdelivr.net (proxy 403), not intermittent failures
  - Installed runtime 1.31.1 against WASM pinned to 1.24.3 on jsDelivr
  - The build already copies two runtime WASM files into the app, but the code points at the CDN (found during gate 1 research; gate 2 detail)
  - The voice-detection setup call is not inside error handling, so a load failure is silent (gate 2 detail)
related: "#40 microphone selection (same file, separate), #49 mic level indicator"
implementation:
  - PR #77, claude/fq-41. Owner exceptions recorded on #41 - one existing e2e test edit (smoke.spec.ts) and 426 changed lines against the 400-line STOP_IF.
