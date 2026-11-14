# FQ-40 Gate 2 - Architecture

Implements the approved product gate: the session records from the microphone chosen in the
mic check, the choice is remembered in this browser, and a missing microphone falls back to
the default with a one-line notice.

## What the code does today (checked)

- **Mic check** (`app/mic-check/page.tsx`): `startStream(deviceId?)` opens
  `getUserMedia({ audio: deviceId ? { deviceId: { exact } } : true })`, lists the inputs,
  and auto-selects the first. `selectedDeviceId` is component state only, so nothing
  stores it.
- **Session** (`hooks/useVAD.ts`): the `getStream` option passed to `MicVAD.new` opens
  `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 } })`
  with no `deviceId`, so the browser default is used.
- **Pause and resume (found during this gate, not in the issue).** `useVAD.ts` sets
  `getStream` but **not** `pauseStream`/`resumeStream`. vad-web's default `pauseStream` stops
  the tracks. Its default `resumeStream` reopens with
  `{ channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true }`:
  no `deviceId`, no `sampleRate: 16000`, and `autoGainControl` on
  (`node_modules/@ricky0123/vad-web/dist/real-time-vad.js:73-87`). So today every Pause and
  Resume in a session already **switches to the default microphone and changes the audio
  processing**. Fixing #40 only in `getStream` would be undone by the first pause.
- **Test tooling (verified).** Chromium with `--use-fake-device-for-media-stream` exposes
  three inputs: "Fake Default Audio Input" (`default`), "Fake Audio Input 1" and "Fake
  Audio Input 2". Opening one with `deviceId: { exact }` works, and
  `track.getSettings().deviceId` reports which one is in use. Success point 1 can therefore be
  tested in Playwright.
- **Existing storage pattern.** `app/lib/motion.ts` already stores a preference in
  `localStorage` with guarded reads and writes. The same pattern is reused.

## Systems touched

| Area | Change | Load-bearing |
|---|---|---|
| New `app/lib/micDevice.ts` | `readMicChoice()` / `saveMicChoice({ deviceId, label })` / `clearMicChoice()` over one `localStorage` key, shape-checked on read; `audioConstraints(choice)` returns the locked processing settings plus `deviceId: { exact }` when a choice exists | no |
| `app/mic-check/page.tsx` | On load, preselect the stored choice if it is still present. Store the choice when the person picks a device; picking "Default" clears it. One help line: "Your sessions will use this microphone until you choose another." | no |
| `hooks/useVAD.ts` | `getStream` **and** a new `resumeStream` both open via one internal `openMic()`. It uses `audioConstraints(readMicChoice())`, and on `OverconstrainedError` or `NotFoundError` retries once with no `deviceId` and records `micFallback: { label }`. The hook returns `micFallback`. Locked thresholds and every other option are byte-identical | **yes** |
| Session page (`app/session/page.tsx`) | When `micFallback` is set, show the one-line notice (role `status`, not an alert) | no |
| Docs (`docs/how-it-works.md` or `getting-started.md`) | One line on the remembered microphone | no |

No backend, protocol, storage-on-server or dependency change.

## Data structure

`localStorage["interview-studio:mic"] = { "deviceId": string, "label": string }`.
The label is stored only to name the missing microphone in the notice. Device ids are
per-site random identifiers chosen by the browser, and both fields stay in the browser. An
unreadable or malformed value is treated as "no choice".

## Call flow

1. **Mic check.** The person picks "Fake Audio Input 2" (or "USB Headset"). `saveMicChoice`
   stores it, and the test recording uses it as today.
2. **Session start.** `startMic` → `MicVAD.new({ getStream, resumeStream, ... })` →
   `vad.start()` → `getStream` → `openMic()` →
   `getUserMedia({ audio: { echoCancellation, noiseSuppression, sampleRate: 16000, channelCount: 1, deviceId: { exact } } })`.
3. **Chosen mic missing.** `getUserMedia` rejects with `OverconstrainedError` (or
   `NotFoundError`). `openMic` retries once without `deviceId` and sets
   `micFallback = { label }`. The page shows the notice, and hearing becomes "ready" as
   usual. Any other error, such as `NotAllowedError`, propagates unchanged into FQ-41's
   "failed" path.
4. **Pause, then resume.** vad-web's `pauseStream` stops the tracks (unchanged). On resume,
   our `resumeStream` → `openMic()` reopens **the same device with the same locked
   settings**.

## Load-bearing paths

`apps/frontend/hooks/useVAD.ts` only: deep gates, draft PR, human read. The four
thresholds are untouched. The audio processing settings for the **first** open are
byte-identical; only `deviceId` is added. Adding `resumeStream` **changes the processing
after a pause** (decision A).

## Oracle

- **Unit (new files).** `micDevice.ts`: constraints with and without a choice, and the
  locked settings pinned; storage shape check and corrupt value; save and clear.
  `useVAD`, with vad-web mocked as in FQ-41's hook test: `getStream` and `resumeStream`
  request the stored device; an `OverconstrainedError` triggers one retry without `deviceId`
  and sets `micFallback`; a `NotAllowedError` is not retried.
- **Browser (new spec).** It reuses FQ-41's autoplay and blocked-host setup, and wraps
  `getUserMedia` with an init script to record the constraints and the opened track's
  `deviceId`:
  1. choose "Fake Audio Input 2" on the mic check, start a session, and assert the session
     track is that device;
  2. press Pause, then Resume, and assert it is still that device;
  3. store an id that does not exist, start a session, and assert the notice, the default
     device and `data-hearing="ready"`;
  4. no stored choice: the constraints carry no `deviceId` (today's behaviour).
  All of these must fail on main, except 4, which is a regression guard.

## What could break elsewhere

1. **Firefox and Safari** have no "default" device id. Picking the first listed device stores
   a real id, which is fine. "Default" is only a Chrome concept, and clearing on "Default"
   handles it.
2. **Device ids can change** when the person clears site data or revokes microphone
   permission. That lands on the fallback path and its notice, which is the intended
   behaviour.
3. **`exact` with the other constraints.** A device that cannot do 16 kHz mono still opens:
   `sampleRate` and `channelCount` are ideal values, not `exact`, so only `deviceId` is
   strict. Unchanged.
4. **Echo of the interviewer.** With a headset chosen, echo is less likely, so this is not a
   risk to interrupts. With speakers and a built-in mic it is as today.
5. **FQ-41 interaction.** `openMic` runs inside `vad.start()`. A fallback is still a
   success, so hearing becomes "ready". A failure after fallback rejects `start()` and lands
   in "failed" as today.

## Decisions needed at this gate

- **A. Pause/Resume settings.** Adding `resumeStream` makes a resumed microphone use the same
  settings as the first open (16 kHz requested, no automatic gain) instead of vad-web's
  defaults (automatic gain on). Proposed: yes. It is the only way to keep the chosen device
  after a pause, and it makes resumed audio consistent with the first open. It does change
  today's behaviour after a pause, which the locked-settings rule arguably already intended.
- **B. Storing the label.** Proposed: yes, to name the missing mic in the notice. The
  alternative is a notice without the name ("Your chosen microphone isn't connected...").
