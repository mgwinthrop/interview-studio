item: FQ-41
scope: load voice detection's runtime from the app, not a CDN; no silent failure when hearing cannot start
gate_1_product: pending
gate_2_architecture: not-started
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
open_questions:
  - Include the "can't hear you" message, or only move the download (owner)
  - Wording of the message (owner)
evidence:
  - Two intermittent "no available backend found ... Failed to fetch" failures in about 12 mock session loads on 2026-11-14 (comments on #41)
  - Installed runtime 1.31.1 against WASM pinned to 1.24.3 on jsDelivr
  - The build already copies two runtime WASM files into the app, but the code points at the CDN (found during gate 1 research; gate 2 detail)
  - The voice-detection setup call is not inside error handling, so a load failure is silent (gate 2 detail)
related: "#40 microphone selection (same file, separate), #49 mic level indicator"
