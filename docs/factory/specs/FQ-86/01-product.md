# FQ-86 Gate 1 - Product

Scope: what the session screen says about the microphone when someone resumes a paused
session, including when they pause again while it is still coming back.

> **Amended 2026-11-17 (owner, option A).** A browser check during gate 2 found that an
> ordinary Pause and Resume, more than ten seconds into any session, also flashes the
> warning and opens the typing bar. It is the same defect with the same cause, so the scope
> now covers every Resume. Changes: problem 4, success criteria 4 and 5, the checks, the
> announcement and the kill check. The original gate 1 decision (option A) is unchanged.

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

4. **An ordinary Pause and Resume does it too.** In any session that has run for more
   than ten seconds, a normal Pause and Resume, with a microphone that comes straight
   back, briefly inserts the same warning (a screen reader announces it) and opens the
   typing bar, which stays open. Most people who pause hit this, not only those with a
   slow microphone. (Reproduced in a browser on 2026-11-17.)

Nothing is wrong with the microphone itself in these sequences, and nothing is recorded or
sent while paused. The defect is only in what the screen tells the person. It is
confusing, and it trains people to ignore a warning that matters when it is real.

## What success looks like

1. Pausing never leaves the screen in a "still starting" state. While paused, no
   microphone warning appears or is announced because of a reopen that the pause cancelled.
2. Every Resume gets the full ten seconds before a warning appears, including a Resume
   that follows a cancelled reopen.
3. A real failure is still reported. If the microphone does not come back within ten
   seconds of a Resume, the existing warning appears with the existing wording, as today.
4. An ordinary Pause and Resume, at any point in a session, never shows or announces the
   warning and never opens the typing bar.
5. Nothing else changes: the first start, ending the session, the warning wording and the
   panel states behave as they do now.

Checkable:
- Pause, Resume, Pause again within ten seconds with a reopen that never finishes, then
  wait twenty seconds while paused. No warning and no typing bar. Resume: no warning for
  ten seconds.
- Wait more than ten seconds into a session, then Pause and Resume with a working
  microphone. The warning is never inserted, even briefly, and the typing bar stays closed.

## Announcement (as if shipped)

> **Pausing no longer sets off a false alarm.** Resuming a session could briefly warn that
> we couldn't hear you and open the typing bar, even when your microphone was fine, and
> pausing again while it was still reconnecting could keep that warning up through the
> pause. Now each Resume gives your microphone its full ten seconds before we say anything,
> and pausing cancels a reconnect cleanly.

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

Should this exist? Yes. As amended, severity is medium: any Pause and Resume more than ten
seconds into a session triggers a false warning and opens the typing bar, and screen-reader
users hear the warning announced. The hang-and-pause-again case on its own was low
severity. The warning is the screen's only honest signal that voice is not working (FQ-41,
FQ-79), and a false alarm on routine use teaches people to ignore it. If the fix needs a
change to an existing test, or more than a small change in the voice-detection code, that
gets weighed at gate 2.

## Decisions

1. **Scope of the pause rule (owner, gate 1, 2026-11-17): option A.** Only a reopen that
   the pause cancelled is cleared. A failure that happened before the pause stays
   reported, as FQ-79 shipped it ("pause and resume to try again").
2. **Scope widened to every Resume (owner, gate 1 amendment, 2026-11-17): option A.** The
   ordinary Pause/Resume flash is fixed here, not filed separately.
