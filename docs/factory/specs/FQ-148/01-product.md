# FQ-148 - Gate 1: product

## The problem

You are in a practice interview. You click **End Session**, change your mind and press
Escape, and in the same moment you click **Pause**, because you want a minute to think.

The screen says **Paused**. But your microphone is back on and listening. If you talk to
someone in the room, or think out loud, what you say is very probably sent off to be
transcribed and answered, while the screen tells you nothing is being heard.

The window is short (the moment between pressing Escape and the session really resuming),
so this is rare. But when it happens, the person cannot tell, and what is at stake is
their trust in the one button whose whole job is "stop listening to me".

## What success looks like

1. **The screen and the microphone always agree.** If the screen says Paused, the
   microphone is off and nothing you say leaves your device. If it says Listening, the
   microphone is on. This holds in every order of Escape, Pause and End Session presses,
   not just the usual ones.
2. **Your last press wins.** If the last thing you pressed was Pause, you end up paused. If
   it was Resume or Keep talking, you end up listening.
3. **Nothing else changes.** End Session, the end dialog, Pause and Resume look and behave
   exactly as they do today in every case except this one.

**How we measure it:** an automated test drives the exact sequence above. Today it ends
Paused with the microphone on. After the change it ends Paused with the microphone off. Every
existing test of the end dialog and of Pause still passes unchanged.

## Announcement

> **Pause now always means off.** If you pressed Pause just as you were closing the "End
> this interview?" dialog, the session could show Paused while your microphone had quietly
> come back on. Now, whatever order you press things in, Paused means your microphone is off
> and nothing you say is sent.

## Screens

No screen changes. The fix makes an existing screen tell the truth; it adds nothing. The
mockup (`mockups/sequence.html`) shows the sequence and the before and after states for
the reviewer.

## Options considered for the moment itself

| Option | What the person sees | Verdict |
|---|---|---|
| **A. Honour the Pause** (approved by the owner, 2026-11-19) | They end up Paused, microphone off, as they asked | Matches intent; the safe outcome when in doubt is "off" |
| B. Ignore the Pause during that moment (as End Session already does) | They end up Listening; the Pause they pressed did nothing | Honest screen, but it silently drops a "stop listening" request |
| C. Disable Pause during that moment | Pause is greyed out for a fraction of a second | Honest, but adds a visible state for a tiny window; most people never see it, and the ones who do are confused |

## What we are deliberately not doing

- **No change to End Session.** Its existing "do nothing while closing" behaviour stays.
  It does not affect the microphone.
- **No new visible states, messages or animations.**
- **No change to the larger rebuild's plan.** The rebuild still fixes this at its root
  later; this change is the interim protection, and the rebuild must keep it true.
- **No change to how Pause works in the normal case.**
- **Not proving it with real speech yet.** The automated test checks the microphone
  state, not a spoken sentence. A separate item (the realism test, #129) covers spoken
  input.

## Should this exist?

Yes. It is rare, but it makes the Pause button lie about the microphone, and the fix is
small. The kill option was "wait for the rebuild", which leaves a known privacy mismatch
in place for several more slices.
