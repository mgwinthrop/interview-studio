# FQ-40 Gate 2 - Architecture (revision 2)

Implements the approved product gate: the session records from the microphone chosen in the
mic check, the choice is remembered in this browser, and a missing microphone falls back with
a one-line notice.

Revision 2 incorporates the factory-critic review of revision 1 ("needs changes first"; see
the end) and corrects a false claim that decision A was first framed on.

## What the code does today (checked)

- **Mic check** (`app/mic-check/page.tsx:63-99`): `startStream(deviceId?)` opens
  `getUserMedia({ audio: deviceId ? { deviceId: { exact } } : true })`. Any failure shows
  "access denied" (:81-83). The page lists the inputs and auto-selects `inputs[0]` (:92),
  which is not necessarily the device that opened. Nothing stores the choice.
- **Session first open** (`hooks/useVAD.ts`, the `getStream` option): opens
  `{ echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 }` with
  no `deviceId`.
- **Session resume after Pause.** `useVAD.ts` sets no `resumeStream`, so vad-web's default
  reopens with `{ channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true }`
  and no `deviceId` (`node_modules/@ricky0123/vad-web/dist/real-time-vad.js:78-87`). **Every
  Pause then Resume switches to the default microphone.**
- **Measured in Chromium (2026-11-14):**
  - The first-open constraints already run with `autoGainControl: true`, the browser default
    when it is not given. `sampleRate: 16000` is an ideal value, and the track opened at
    48000. So the only material difference between first open and default resume is the
    **device**. (Revision 1 wrongly said the first open ran "with no automatic gain".)
  - An unknown `deviceId: { exact }` rejects with `name: "OverconstrainedError"`,
    `constraint: "deviceId"`.
  - Fake devices: "Fake Default Audio Input" (`default`), "Fake Audio Input 1" and "Fake Audio
    Input 2". `exact` selection works, and `track.getSettings().deviceId` reports the
    device in use.
- **Only three places open a microphone:** the mic check's `startStream`, `useVAD`'s
  `getStream`, and vad-web's `resumeStream`. The design-retry restart goes through
  `getStream`. Confirmed by the critic.
- **Why the retry must live inside `getStream`:** a rejected `getStream` puts vad-web into a
  permanent `errored` state (`real-time-vad.js:209-217`), so retrying from outside would need
  a whole new VAD.

## Systems touched

| Area | Change | Load-bearing |
|---|---|---|
| New `app/lib/micDevice.ts` | `readMicChoice()`, `saveMicChoice({ deviceId, label })`, `clearMicChoice()` over `localStorage["interview-studio:mic"]` with guarded access (the `motion.ts` pattern) and a shape check on read; `audioConstraints(choice)` = the locked first-open settings, unchanged, plus `deviceId: { exact }` when a choice exists; `isMissingDevice(err)` matches `err.name` `OverconstrainedError` or `NotFoundError` | no |
| `app/mic-check/page.tsx` | See "Mic check flow" | no |
| `hooks/useVAD.ts` | `getStream` and a new `resumeStream` both call one internal `openMic(gen)`; the hook returns `micFallback`. Thresholds and every other option are byte-identical; the first-open processing settings are byte-identical, and only `deviceId` is added | **yes** |
| Session page | Shows the notice when `micFallback` is set (role `status`) | no |
| Docs | One line in `docs/how-it-works.md` | no |

## Mic check flow

1. **On load,** if a choice is stored, open it with `exact`.
   - If that fails with a missing-device error, open the browser default instead. Show the
     line "Your saved microphone (Name) isn't connected, so this check is using
     <opened track's label>." Do **not** show "access denied", and **keep** the stored
     choice, so plugging the headset back in works next time.
   - Other errors keep today's handling, unchanged.
2. **The `<select>` shows the device that actually opened** (`track.getSettings().deviceId`),
   not `inputs[0]`. The meter and the 3-second recording therefore always use what the select
   shows.
3. **Choosing a device** stores it only after it opened successfully (`saveMicChoice` with
   the opened id and label).
4. **A new first option, "System default",** clears the choice and opens with no
   `deviceId`. Firefox and Safari have no "default" entry, so without it a choice could never
   be cleared there. Chrome's own "Default" entry also clears the choice.
5. **Help line:** "Your sessions will use this microphone until you choose another."

## Session flow (`openMic(gen)`)

1. `constraints = audioConstraints(readMicChoice())` → `getUserMedia(constraints)`.
2. On a missing-device error with a choice present, retry once without `deviceId`.
3. **After every await, check the start generation.** If `gen !== genRef.current` (a stop or
   unmount happened meanwhile), stop the new stream's tracks and throw. This closes an
   existing race: vad-web's resume sets `listening` before awaiting `resumeStream`
   (`real-time-vad.js:271-277`), so a stop during resume could leave a live microphone. The
   race exists in today's default `resumeStream`, and FQ-40 now owns that path.
4. **`micFallback` lifecycle.** It is set to `{ label, using }` only **after** the retry
   succeeds and only if `gen` is current. `using` is the opened track's label, which matters
   because Firefox's prompt can let the person pick a device, so we say what we actually
   opened instead of assuming "default". It is cleared by `stopMic`, by a new `startMic`, and
   by any later `exact` open that succeeds (headset plugged back in, then Pause and Resume).
5. Any other error propagates. On first open it lands in FQ-41's "failed". On resume,
   `resumeMic` already swallows errors and `hearing` stays "ready" while nothing is heard.
   **That is a pre-existing defect**, recorded here and left out of scope (decision D).

## Notice wording

- With a label: "Your chosen microphone (USB Headset) isn't connected, so we're using
  <using>."
- Without a label (some browsers give an empty one): "Your chosen microphone isn't
  connected, so we're using <using>."

## Data and privacy

The stored value is `{ deviceId, label }`, kept in this browser only and never sent to the
server. Device ids are per-site random values. **Labels can contain personal names**
("Jane's AirPods"). The site can already read labels whenever microphone permission is
granted, so storing one adds persistence, not access. Decision B accepted this.

## Delivery

One draft PR with the fix, the new e2e spec and the unit tests (FQ-41's rule: a failing
browser test merged alone turns CI red). Deep gates, verifier, human read. The size will be
near the charter's 400-line STOP_IF. If it is over, stop and ask.

## Oracle

- **Unit (new files):**
  - `micDevice`: constraints with and without a choice; the first-open settings pinned
    byte for byte (no `autoGainControl` key); the storage shape check and a corrupt value;
    save and clear; `isMissingDevice` by name.
  - `useVAD`: the tests take the options from the mocked `MicVAD.new` call and call
    `getStream` and `resumeStream` themselves, with `navigator.mediaDevices.getUserMedia`
    mocked. Covered: the stored device is requested by both; `OverconstrainedError` gives one
    retry and sets `micFallback`; `NotAllowedError` is not retried; a resume that resolves
    after `stopMic` stops its tracks and throws (the leak); `micFallback` clears on
    `stopMic` and after a successful `exact` resume.
- **Browser (new spec, repeating FQ-41's autoplay, fake-device and blocked-host setup).** An
  init script wraps `getUserMedia` to record the constraints and the opened `deviceId`:
  1. Choose "Fake Audio Input 2" on the mic check, and the mic check's own track is that
     device. The session's track is that device, and no notice appears.
  2. Pause, then Resume: still that device.
  3. With a stored id that does not exist, the mic check shows the saved-mic line, not
     "denied". The session shows the notice and uses the default, and `data-hearing` is
     "ready".
  4. Choosing "System default" clears the choice, and the next session sends no `deviceId`.
  5. With no stored choice, the session sends no `deviceId` (a regression guard).

  Tests 1-4 must fail on main.

## What could break elsewhere

1. **Rotating device ids** (Safari, Firefox private windows, one-time permissions) mean the
   notice may appear every session there. The person is still told, and the session still
   works. Matching the stored label after a fallback is decision C.
2. **Chrome on Windows "communications"** follows the OS and never goes missing. Harmless if
   stored.
3. **Interrupts:** echo cancellation and noise suppression are unchanged on both paths. The
   risk is low.
4. **FQ-41 interaction:** a fallback is a success, so hearing becomes "ready" and the notice
   shows. A failure after fallback lands in "failed" and shows "Can't hear you", never both.

## Decisions

- **A (confirm on corrected facts).** Our `resumeStream` reopens the same device with the
  first-open settings. Measured, the only material change from today's resume is the
  **device**: automatic gain is on in both, and 16 kHz is only a hint. Owner answer to A
  (follow the recommendation) was given on revision 1's wrong framing; please re-confirm.
- **B. Store the label.** Approved by the owner. Privacy note above, and a fallback wording
  for empty labels.
- **C. Unstable ids in some browsers.** Proposed: document only. The alternative is that,
  after a fallback, we look for a device with the stored label and reopen it. That fixes
  Safari and Firefox private windows, but adds a second retry to a load-bearing file.
- **D. A failed resume stays silent** (pre-existing). Proposed: out of scope, and filed as a
  follow-up issue. The alternative is routing it to FQ-41's "failed" here.

## Critic review (revision 1): verdict "needs changes first"

All findings are addressed above:
- the unspecified mic-check open and fallback, and the auto-select bug;
- the stop-during-resume microphone leak;
- decision A's false premise;
- the `micFallback` lifecycle;
- browser differences (no "default" entry, rotating ids, Firefox's picker,
  "communications");
- the delivery plan;
- label privacy and empty labels;
- the oracle gaps (the mic check's own device, clearing, a fallback on resume, the leak).
