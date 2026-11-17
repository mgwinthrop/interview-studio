# FQ-108 Gate 1 - Product

Scope: the live conversation screen and everything that keeps it in step with the
microphone, the interviewer's voice and the connection. It is a rebuild of how that screen
keeps track of what is happening, not a new feature.

## The problem

There are two groups of people with one cause between them.

**The person practising.** The live conversation is where they spend almost all their
time, and it is the least predictable part of the product. In the last few days alone:

- Resuming after a pause could flash "We can't hear your microphone" and open the typing
  bar, even though the microphone was fine (#107).
- Pausing while the microphone was reconnecting left a warning up through the whole pause
  (#86).
- After "Start over", a session that timed out or was rejected could fail silently, with
  the screen still looking connected while nothing reached the interviewer (#110).
- The end-of-session dialog needed five rounds of fixes before closing it behaved
  correctly.

Each problem was small, but together they teach people not to trust what the screen says
about whose turn it is and whether they are being heard.

**The person maintaining it (the owner, and the factory working on the owner's behalf).**

- *What happened?* When something goes wrong, nothing records what the session went
  through. Each defect above was found by reading code line by line or by building a
  one-off browser probe.
- *What will this break?* Changes to this screen keep breaking neighbouring behaviour:
  four of the eight recent items here needed follow-up fixes.
- *How do we build what's next?* The next planned improvements (#48, letting the speaker
  control turn-taking; #49, showing that the microphone is hearing you) land in the same
  place, and today each would add more of the same risk.

The cause is the same throughout: what the screen believes about the session is spread
over many separate pieces that are kept in step after the fact. For a moment they can
disagree, and whatever the screen shows during that moment is what the person sees.

## What success looks like

For the person practising:

1. **No visible behaviour changes except the known defects.** Every behaviour that is
   correct today stays exactly as it is: wording, timing, the avatar's states, reduced
   motion and keyboard focus. The rebuild is judged first on that.
2. **Known defects are gone.** #86 and the other defects the review found are fixed as
   part of the rebuild, or are explicitly listed as still open.
3. **The screen never contradicts itself.** At any moment, the panel, the transcript, the
   microphone warning and the pause screen agree about whose turn it is and whether the
   person is heard. Checked by automated tests for every path in success criterion 5.

For the person maintaining it:

4. **Every problem can be traced.** In operator mode (`?debug=1`, which exists today), the
   session shows a step-by-step history of what happened: each event, in order, and what
   the screen moved to. It can be copied into a bug report. It never contains what anyone
   said: no words, no audio, only the names of events and states.
5. **Every path is checked before anything changes.** Interrupting the interviewer,
   Pause, Resume, the end-of-session dialog, losing and restoring the connection, a
   microphone that fails or hangs, and the design and "Try it" modes each have an
   automated check of today's behaviour before the rebuild starts. Today several have none.
6. **The next features are cheaper.** #48 and #49 can each be built by adding to the new
   structure in one place, without changing how existing behaviours work. Checked at gate
   2 by sketching both against the proposed design.
7. **Fewer follow-up fixes.** Measured over the four weeks after the rebuild ships: fewer
   than one follow-up fix per change in this area, against four of eight today.

## Announcement (as if shipped)

> **A steadier conversation screen.** We rebuilt how the live conversation keeps track
> of what's happening: your microphone, the interviewer's voice, pausing and your
> connection. You shouldn't notice anything new, except that the screen no longer
> flickers between states, a pause never sets off a false microphone warning, and if your
> connection is lost we always tell you. If something does go wrong, add `?debug=1` to the
> address and copy the session history into your report. It shows what happened step by
> step, and never what anyone said.

## Mockups

`mockups/debug-session-history.html` shows the session history in operator mode. This is the
only new thing on screen. Without `?debug=1` the screen looks exactly as it does today.

## Deliberately not doing

- **No new features for the person practising.** #48 (turn-taking) and #49 (hearing
  indicator) are designed for, not built. Each follows as its own item on the new
  structure.
- **No visual or wording changes.** The panel, avatar, transcript, warnings, dialogs and
  pause screen look and read as they do today.
- **No change to the conversation itself.** What the interviewer says and how replies are
  produced, timed and spoken are unchanged, as are the report and the server.
- **No change to the voice detection settings or the microphone format.** They are fixed
  by the project rules.
- **No change to privacy.** Audio is still never stored, and the new history holds no words.
- **Not the rest of the app.** The dashboard, reports, interviewer editor, settings and
  usage pages are out of scope.
- **No big-bang switch-over.** It ships in small steps, each one checked against today's
  behaviour, and can stop part-way with every step useful on its own.

## Kill check

Should this exist? Yes, on the evidence.
- **The case for it.** Eight recent items and four rounds of follow-up fixes all landed in
  this screen. Three of the defects found this week share one cause. The next two planned
  features land in the same place.
- **The cost.** Sessions of work in the most-used screen, regression risk in exactly the
  place people notice it, and a pause on #48 and #49 until the new structure exists.
- **What would make it not worth doing.** If gate 2 cannot name a credible way to check
  that behaviour is unchanged (success criterion 5), or if the rebuild cannot ship in
  small steps, the risk outweighs the gain. Then the fallback is to keep fixing defects
  one by one, with better tests.

## Open questions

1. **Who sees the session history?** Proposed: operator mode only (`?debug=1`), with a
   copy button, kept in memory for the current session only and never sent anywhere.
   Alternatives: browser developer console only (less discoverable), or always available
   to the person (more surface, and it needs wording work).
2. **What waits for the rebuild?** Proposed: #48 and #49 wait (same place, and building
   them now would add to what has to be rebuilt). #55 (mic check as a one-time step) and
   #110 (reconnect fix, already filed) go ahead. #86 is folded into the rebuild.
