# FQ-41 Gate 2 - Architecture

Implements the approved product gate: load voice detection's runtime from the app, not a CDN;
when hearing cannot start, say so within 10 seconds and open typing.

## What the code does today (measured, not inferred)

Measured on 2026-11-14 with a production build in mock mode, Chromium launched with
`--autoplay-policy=no-user-gesture-required`, all requests recorded via CDP:

- `useVAD.ts` imports `MicVAD` from `@ricky0123/vad-web` 0.0.31, whose real-time VAD does
  `require("onnxruntime-web/wasm")`. That resolves to the installed **onnxruntime-web 1.31.1**.
- The `ortConfig` hook sets `ort.env.wasm.wasmPaths` to
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/`. The runtime then requests
  `ort-wasm-simd-threaded.mjs` (the JS loader) from that URL, and next the matching `.wasm`.
  So a 1.31.1 runtime is pointed at 1.24.3 files.
- The Silero model (`silero_vad_legacy.onnx`) and the worklet already load from the app
  (`/`), copied there by `next.config.mjs`.
- `next.config.mjs` **already copies** `ort-wasm-simd-threaded.wasm` and
  `ort-wasm-simd-threaded.asyncify.wasm` into `public/`. Nothing uses them, and the `.mjs`
  loader the runtime actually needs is **not** copied.
- `MicVAD.new(...)` is awaited outside any `try`. When the runtime cannot load, it rejects
  with "no available backend found", which surfaces as an unhandled page error. `startMic`
  returns, nothing changes state, and the panel keeps saying "Listening". This was reproduced
  on every attempt in the sandbox, whose network refuses cdn.jsdelivr.net.
- Voice detection only starts after the audio context resumes, which needs a user gesture.
  **The existing Playwright smoke tests never trigger it.** They launch without the autoplay
  flag, so no test in the repository exercises the runtime loading at all.

## Systems touched

| Area | Change | Load-bearing |
|---|---|---|
| `apps/frontend/hooks/useVAD.ts` | Point `wasmPaths` at the app (`/`). Catch a failed or hung `MicVAD.new` (10 s limit) and expose it as a state the page can read. Thresholds and all other options are byte-identical | **yes** |
| `apps/frontend/next.config.mjs` | Copy `ort-wasm-simd-threaded.mjs` alongside the `.wasm`, from the installed package, so versions cannot drift | no |
| `.gitignore` (root) | Ignore the copied `public/*.mjs`, as it already ignores `public/*.wasm` | no |
| Session page and panel (`app/session/page.tsx`, `app/components/AgentPanel.tsx`) | On "hearing unavailable": show the approved message (an alert), open the typing bar, and show the panel status "Can't hear you" | no |
| Avatar (`app/components/InterviewerAvatar.tsx`) | Possibly one more avatar state, decided at gate 3. The contract requires avatar states to reflect real state | no |
| Docs (`docs/how-it-works.md`) | One line: the voice-detection runtime is served by the app; no third-party request | no |
| New Playwright spec (`apps/frontend/e2e/`) | The oracle (see below) | no |

No backend change, no protocol change, no new dependency, no version change.

## Data structures

One new piece of client state from `useVAD`: `hearing: "starting" | "ready" | "unavailable"`.
It is not sent to the server, not stored and not logged beyond the existing
name-only `console.warn`.

## Call flow (after the change)

1. Session page mounts. After a gesture-derived navigation, `audioQueue.resume()` and then
   `startMic()`.
2. `startMic` sets `hearing = "starting"` and races `MicVAD.new({... wasmPaths "/" ...})`
   against a 10 s timer.
3. The runtime fetches `/ort-wasm-simd-threaded.mjs`, then `/ort-wasm-simd-threaded.wasm`,
   from the app (same origin, so COOP/COEP `require-corp` needs no CORP header).
4. a. Success: `vad.start()` as today, then `hearing = "ready"`.
   b. Rejection or timeout: `hearing = "unavailable"`. A late success after a timeout is
      destroyed and never started (no microphone opens).
5. The page sees `unavailable`: alert with the approved wording, typing bar open, panel
   status "Can't hear you". Text turns work as today.
6. Reconnect or start over calls `startMic` again and the state is re-evaluated.

`vad.start()` failures (for example microphone permission denied) are **unchanged**. They
stay a name-only warning. Product gate 1 scoped the message to voice detection not starting.
See decision B.

## External dependencies

None added. The CDN request is removed. The runtime files come from the already-installed
`onnxruntime-web`. Install size grows only by the `.mjs` loader (about 25 KB). The 14.8 MB
`.wasm` is already copied today.

## Oracle

The current tests cannot tell whether hearing works, so the oracle is built first (slice 0):
a new Playwright spec with the autoplay flag that:

- routes every non-localhost request to abort, simulating a network that blocks the CDN, and
  asserts none was attempted;
- asserts `/ort-wasm-simd-threaded.mjs` and `.wasm` were served from the app with 200;
- asserts no "no available backend" page error;
- for the failure path, routes the local `.wasm` to 404 and asserts the alert text and the
  open typing bar within 10 s.

This spec must fail on today's code: the CDN is attempted, and there is no alert. Caveat:
**Playwright is not a factory gate.** CI runs it on every PR, and `gates.sh` does not. The
slices therefore also carry unit tests for the pure parts (path constant, timeout race,
state transitions), and the PR checklist must record the Playwright run.

## Load-bearing paths

- `apps/frontend/hooks/useVAD.ts`: edited. Deep gates, draft PR, human read. The four
  locked thresholds and the `getStream` constraints must be byte-identical. The diff to
  that file is limited to `wasmPaths`, the try/timeout around `MicVAD.new`, and exposing
  `hearing`.
- `.github/workflows/**`: not edited. The new spec runs in the existing Playwright job.

## What could break elsewhere

1. **The `.mjs` must be served as JavaScript.** It is imported dynamically. If Next serves
   `public/*.mjs` with the wrong content type, the import fails in exactly the way it does
   today. The oracle catches it, and slice 0 must check the header.
2. **Version drift moves, it does not vanish.** Copying from the installed package keeps the
   loader and `.wasm` in step with the JS runtime on every build. If vad-web ever bundles its
   own runtime copy, they could drift again. The oracle catches that too.
3. **The 10 s timeout on slow machines.** A cold load of a 14.8 MB file from localhost takes
   well under a second, but on a remote, slow server it could approach 10 s, and a false
   "can't hear you" would follow. Decision A.
4. **Abandoned late success.** After a timeout, a `MicVAD.new` that resolves later holds an
   ONNX session. It must be destroyed. vad-web's `destroy()` before `start()` is already
   documented in the file as leaking one session. Acceptable once per failed start, but
   noted.
5. **Existing smoke tests.** They do not load VAD today and will not after. Unchanged.
6. **Unused copy.** `ort-wasm-simd-threaded.asyncify.wasm` (28.7 MB) is copied but never
   requested. Removing it is a size reduction, which gate 1 ruled out, so it stays. Noted
   for a later issue.

## Decisions needed at this gate

- **A. Timeout.** 10 s, as gate 1 states, measured from `startMic` to `MicVAD.new` settling.
  Proposed: keep 10 s.
- **B. Microphone permission failures.** Keep them out of scope (proposed), or route them to
  the same alert with different wording.
- **C. Panel state.** Reuse the avatar's existing `error` look with the label "Can't hear you"
  (proposed: no new animation), or add a dedicated avatar state.
