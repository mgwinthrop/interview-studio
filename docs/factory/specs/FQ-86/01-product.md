# FQ-86 Gate 1 - Product

Scope: what the session screen says about the microphone when someone pauses while it is
still coming back from an earlier pause.

## The user problem

Someone pauses a session, resumes it, and pauses again before the microphone has finished
coming back. This happens when the microphone is slow to reopen: a busy machine, a headset
reconnecting, or a browser permission prompt left open.

Today the screen gets this wrong in three ways:

1. **They are told something is broken while they have deliberately stopped.** About ten
   seconds into the second pause, the screen raises "We can't hear your microphone. It
   didn't restart after the pause." The pause screen covers it visually, but a screen
   reader announces it, and the typing bar opens behind the pause screen.
2. **They are told it again the moment they resume.** On Resume the warning is already
   showing, before the microphone has had any chance to come back. Resuming is exactly
   what the warning tells them to do, and the warning greets them for doing it.
3. **The panel tells them to type their answers instead** for the same period, even if it
   reopens a second later.

Nothing is wrong with the microphone itself in this sequence, and nothing is recorded or
sent while paused. The defect is only in what the screen tells the person. It is
confusing, and it trains people to ignore a warning that matters when it is real.

## What success looks like

1. Pausing never leaves the screen in a "still starting" state. While paused, no
   microphone warning appears or is announced because of a reopen that the pause cancelled.
2. Every Resume gets the full ten seconds before a warning appears, including a Resume
   that follows a cancelled reopen.
3. A real failure is still reported. If the microphone does not come back within ten
   seconds of a Resume, the existing warning appears with the existing wording, as today.
4. Nothing else changes: the first start, a normal pause and resume, ending the session
   and the panel states all behave as they do now.

Checkable: Pause, Resume, Pause again within ten seconds with a reopen that never
finishes, then wait twenty seconds while paused. No warning and no typing bar. Resume: no
warning for ten seconds.

## Announcement (as if shipped)

> **Pausing no longer sets off a false alarm.** If you paused again while your microphone
> was still reconnecting, the session could warn that it couldn't hear you, during the
> pause and again the moment you resumed. Pausing now cancels the reconnect cleanly, and
> each time you resume the microphone gets its full ten seconds before we say anything.

## Mockups

`mockups/resume-after-cancelled-reopen.html` shows the screen just after Resume in that
sequence, before and after the fix. No new screen, control or wording is added.

## Deliberately not doing

- **No new wording, controls or screens.** The warning text from FQ-79 stays as it is.
- **No change to how long the wait is.** Ten seconds stays fixed.
- **No hiding of real failures during a pause.** If the microphone has already
  definitely failed before the person pauses, the warning stays as it does now. Hiding
  every microphone warning while paused is a broader decision (open question 1).
- **No change to the first start.** A start that is still loading when the person pauses
  is a different case: voice detection has never worked in that session, and the
  "didn't start" warning is accurate. Untouched.
- **No change to how the microphone is opened or closed.** The stale microphone is already
  shut off correctly in this sequence, and a test covers that. Only the reported state
  changes.
- **No retry button or automatic retry.** Out of scope; a separate product question.

## Kill check

Should this exist? Yes, but only small. Severity is low: it needs a microphone reopen that
hangs and a second pause inside ten seconds. The reason to do it anyway is that the
warning is the screen's only honest signal that voice is not working (FQ-41, FQ-79), and a
false alarm on Resume teaches people to ignore it. If the fix turns out to need more than a
few lines in the voice-detection code, or a change to an existing test, the case for doing
it gets weaker. That gets checked at gate 2.

## Open questions

1. **Scope of the pause rule.** Proposed: only a reopen that the pause cancelled is
   cleared. Alternative: show no microphone warning at all while paused, and check again
   on Resume. That is broader and covers an already-failed microphone too, but it changes
   FQ-79's behaviour, where the warning tells the person to "pause and resume to try
   again".
