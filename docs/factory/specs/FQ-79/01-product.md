# FQ-79 Gate 1 - Product

## The user problem

A person pauses a session, perhaps to take a call, unplug a headset or let another app use
the microphone, then presses Resume. If the microphone cannot be reopened, the session goes
back to saying "Listening" and nothing tells them otherwise. They answer the interviewer's
question out loud, and nothing is heard. They wait, repeat themselves, and cannot tell
whether the interviewer is slow, the app is broken, or their microphone is the problem.

Reproduced on 2026-11-14: after a failed reopen, the screen kept saying "Listening" 12
seconds later, with no message.

This is the same harm FQ-41 removed for the start of a session ("never say Listening while
nothing is listening"), but it can still happen after a pause.

When does the reopen fail?
- the microphone was unplugged and no other microphone is available;
- another app took the microphone and will not share it (common on Windows);
- the browser withdrew microphone permission during the pause.

## What success looks like

1. **Never "Listening" while nothing listens, after a pause too.** If the microphone does not
   reopen within 10 seconds of pressing Resume, the session stops saying "Listening".
2. **The person is told, and can carry on.** They see a plain message that the microphone did
   not restart, the typing box opens, and the conversation continues by text.
3. **They can get their voice back.** After fixing the cause (plugging in, closing the other
   app), Pause then Resume tries again, and the message clears when hearing is back.
4. **Nothing else changes.** A successful resume behaves exactly as today. Detection
   settings are untouched.

## Announcement (as if shipped)

> **No more talking to a deaf interviewer after a pause.** If your microphone doesn't come
> back when you resume, perhaps because it was unplugged or another app grabbed it, the
> session tells you straight away and opens typing so you can keep going. Fix the
> microphone, then pause and resume to get your voice back.

## Mockups

`mockups/resume-failed.html`: the session after a failed resume.

## Deliberately not doing

- **No automatic retries.** We do not keep trying the microphone in the background. The
  person decides when to try again, with Pause and Resume.
- **No new "Try again" button.** Pause then Resume already does that. Adding a button is a
  separate interaction change.
- **No diagnosis of the cause.** The message does not try to say which app took the
  microphone or why permission went away. The browser does not reliably say.
- **No change to the start-of-session behaviour** shipped in FQ-41, or to microphone choice
  (FQ-40).
- **No change to how speech is detected.**

## Kill check

Should this exist? Yes. It is a silent failure in the core loop of the product (speak, be
heard), and the fix reuses the "can't hear you" state people already see at the start of a
session. The cost is small; the risk is in the protected voice-detection code, which gate 2
must handle.

## Open questions for approval

1. **Wording.** Proposed: "**We can't hear your microphone.** It didn't restart after the
   pause. You can type your answers, or pause and resume to try again." The panel status
   reads "Can't hear you", as at the start of a session.
2. **Where the person lands.** Proposed: the session stays running, unpaused, with typing open
   (as above). The alternative is to put them back on the paused screen with the message, so
   Resume is the obvious next step but typing is not available until they resume.
