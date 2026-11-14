# FQ-40 Gate 1 - Product

## The user problem

A person with a headset, or an external microphone on a laptop, opens the mic check, picks
the headset, hears their test recording come back clearly, and starts a session. The session
then records from a different microphone: whatever the browser treats as the default,
usually the laptop's built-in one. The mic check tested one microphone and the session uses
another.

The person does not find out. Their answers are picked up from across the room: quieter,
echoey, with keyboard noise. That leads to:

- worse transcription, so the transcript and the report misquote them;
- worse delivery numbers (pace, pauses, filler words), so the feedback is about the room,
  not about them;
- the interviewer cutting in or missing the end of an answer, because voice detection hears
  a weaker signal.

They followed the instructions correctly, and the app quietly ignored their choice.

## What success looks like

1. **The session uses the microphone chosen in the mic check.** With two microphones
   available and the non-default one chosen, the session records from the chosen one.
   Checked in a browser test with two fake microphones.
2. **The choice survives.** It is remembered in this browser for the next session, including
   after closing the tab, so a later "one-time mic check" (#55) can rely on it.
3. **A missing microphone is never silent.** If the chosen microphone is no longer connected
   when a session starts, the session uses the default and says so in one line, for example
   "Your chosen microphone (USB Headset) isn't connected, so we're using the default
   microphone." It is never silent, and it never fails to start.
4. **Nothing else changes.** Sessions where no choice was made, or where the default was
   chosen, behave exactly as today, including how voice detection decides a turn has ended.

## Announcement (as if shipped)

> **The microphone you test is the one we use.** Pick your headset in the mic check and
> your sessions now record from it, every time, until you choose another. If it's unplugged
> when you start, we'll use your default microphone and tell you, instead of quietly
> listening to the wrong one.

## Mockups

`mockups/session-mic-notice.html`: the mic check (unchanged apart from one line of help
text) and the session's notice when the chosen microphone is missing.

## Deliberately not doing

- **No microphone switcher during a session.** Changing microphones stays in the mic check.
  A switcher mid-session means reopening the microphone while voice detection runs, which is
  a separate and riskier change.
- **No change to when the mic check appears.** Making it a one-time step is #55. This spec
  only makes sure the choice is kept so #55 can build on it.
- **No change to how speech is detected.** Sensitivity and end-of-turn behaviour stay
  locked, and the audio processing settings (echo and noise suppression) stay exactly as
  they are.
- **Nothing leaves the browser.** The choice is stored only in this browser. It is not sent
  to the server or stored with sessions or reports.
- **No per-interviewer microphone.** One choice applies to all sessions.

## Kill check

Should this exist? Yes. It is a silent correctness bug. The mic check's main promise, testing
the microphone you will use, is currently false for anyone with more than one microphone, and
it degrades every downstream result (transcript, delivery numbers, report) without telling
them. The change is small in product terms. The risk is in a protected part of the app (the
voice-detection setup), which gate 2 must handle carefully.

## Open questions for approval

1. **How long the choice lasts.** Proposed: remembered in this browser until changed, which
   #55 needs. The alternative is only for the current tab, which is lighter but forgotten
   with every new tab.
2. **A missing microphone.** Proposed: fall back to the default and show the one-line notice
   (success point 3). The alternative is to stop and send the person back to the mic check.
   That is stricter, but it blocks a session over an unplugged headset.
