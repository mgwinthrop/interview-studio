# FQ-79 Gate 2 - Architecture

Implements the approved product gate: after Pause, if the microphone does not reopen within
10 s of Resume, the session shows "Can't hear you" and the approved message, opens typing, and
stays running. Pause then Resume retries.

## What the code does today (checked and reproduced)

- `useVAD.ts` `resumeMic`: `pausedRef.current = false; vadRef.current?.start().catch(() => {})`.
  `hearing` is not touched, so it stays `"ready"` from the first start.
- vad-web 0.0.31 `start()` in the `initialized` state (`real-time-vad.js:267-278`) sets
  `listening = true`, resumes the frame processor, then
  `this._stream = await this.options.resumeStream(stream)`. Since FQ-40, `resumeStream` is
  `openMic()` (saved id, then name, then default). If every attempt fails, `openMic` throws,
  `start()` rejects, and `resumeMic` swallows it. vad-web is left with `listening = true` and
  the old, stopped stream.
- Retry works: the next `pause()` (`:293-302`) sees `listening`, sets it false, stops the old
  tracks again (harmless), disconnects the old source node and pauses the frame processor.
  The following `start()` reopens normally.
- Reproduced on main after PR #81, with `getUserMedia` made to fail with `NotReadableError`
  during a pause: 12 s after Resume, the panel said "Listening" with `data-hearing="ready"`
  and no message.
- Page (FQ-41): `cannotHear = hearingUnavailable(hearing, hearingDeadlinePassed)`. The deadline
  is a single 10 s timer from mount, so it is already in the past by the time anyone resumes.

## Systems touched

| Area | Change | Load-bearing |
|---|---|---|
| `hooks/useVAD.ts` `resumeMic` | Set `hearing = "starting"`; on success `"ready"`, on rejection `"failed"`, both only if the start generation is unchanged (a stop during resume is not a failure). No other change to the hook; thresholds and options untouched | **yes** |
| `app/session/page.tsx` | Restart the 10 s hearing deadline whenever `hearing` becomes `"starting"` (covers a reopen that hangs, e.g. on a permission prompt). Choose the message by whether the failure came after a resume | no |
| `app/session/` alert copy | Second wording, approved at gate 1: "**We can't hear your microphone.** It didn't restart after the pause. You can type your answers, or pause and resume to try again." | no |

No change to vad-web, to FQ-40's `openMic`, to the panel or avatar states, or to the backend.

## Data structures

None new. `hearing` keeps its four values. The page keeps one boolean: "the last hearing
start was a resume".

## Call flow

1. The person pauses. `pauseMic` runs and vad-web stops the tracks. The panel shows "Paused",
   as today.
2. The person resumes. `resumeMic` sets `hearing = "starting"`, so the panel shows
   "Getting ready…" briefly, and calls `vad.start()`. The page notes this was a resume, and the
   `"starting"` transition restarts its 10 s deadline.
3. a. `openMic` succeeds: `hearing = "ready"`, and "Listening" shows as today.
   b. `openMic` throws: `hearing = "failed"`, so the message appears at once (resume wording),
      typing opens, and the panel shows "Can't hear you".
   c. `openMic` hangs: after 10 s the same state appears. If it later succeeds, `"ready"`
      clears it (FQ-41's late recovery).
4. Retry: Pause runs vad-web's `pause()`, which resets `listening`. Resume returns to step 2.

## Load-bearing paths

`apps/frontend/hooks/useVAD.ts`: only `resumeMic` changes (about 10 lines). Deep gates, draft
PR, human read.

## Oracle

- **Unit (new file):** `resumeMic` with the mocked vad-web from FQ-41/40:
  - `start` resolves: `"starting"`, then `"ready"`;
  - `start` rejects: `"failed"`;
  - `start` hangs: stays `"starting"`;
  - `stopMic` during a resume, then the late rejection or resolution: stays `"off"`, never
    `"failed"`.
- **Browser (new spec):** autoplay and fake devices, with an init script that can make
  `getUserMedia` fail or hang on demand:
  1. Pause, make the microphone fail, Resume: within 10 s the resume message,
     "Can't hear you", typing open, `data-hearing="failed"`.
  2. Fix the microphone, Pause, Resume: `data-hearing="ready"`, "Listening", and no message.
  3. Make the reopen hang, Resume: "Getting ready…", then the message after 10 s.
  4. A normal Pause and Resume: no message (regression guard).

  Tests 1-3 must fail on main.

## What could break elsewhere

1. **The "Getting ready…" flash on every resume.** A successful reopen takes milliseconds, but
   the panel may briefly show "Getting ready…" instead of jumping straight to "Listening".
   That is accurate (nothing is listening until the reopen completes) and consistent with
   session start.
2. **Resume while still listening.** vad-web's `start()` returns at once if `listening` is
   already true (for example, after a failed reopen without a Pause in between, or a double
   click). The hook then sets `"ready"` although nothing is heard. This only happens if
   `resumeMic` is called again without a `pauseMic` in between. The page only offers Resume
   while paused, so it cannot happen from the UI, but a unit test should pin that the hook
   does not mask a failure on a no-op resume. Decision A.
3. **FQ-40's notice** (`micFallback`) still works: a resume that falls back succeeds, so the
   notice shows and hearing becomes `"ready"`.
4. **The FQ-41 start-of-session path is unchanged.** The deadline restart only triggers on
   transitions to `"starting"`, and the first start already makes that transition, so the
   first deadline moves from mount to start. That is a few milliseconds later and still
   within the product's "10 s after the session opens".

## Decisions needed at this gate

- **A. A no-op resume after a failure.** Proposed: `resumeMic` keeps the current `"failed"`
  state when the VAD's last reopen failed and no pause happened since. It tracks this with a
  ref, so a stray second Resume cannot flip the panel back to "Listening". The alternative
  is to rely on the UI and only test it.
