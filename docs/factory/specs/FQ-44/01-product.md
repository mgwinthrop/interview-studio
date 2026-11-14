# FQ-44 Gate 1 - Product

Scope: who the user is talking to during a live session. Three visible problems, one cause.

## The user problem

During a session the person cannot tell who they are talking to.

- The panel next to the conversation always says "AI interviewer" and "Explore your
  experience through conversation", whichever interviewer they picked. Someone who chose
  "Rehearse an interview" sees the same heading as someone who chose "Tell a story".
- The transcript labels the interviewer either generically ("Interviewer") or, after the
  first attempt at this item, with the name of the activity ("EXPLAIN AN IDEA SPEAKING").
  An activity is not someone you talk to, so the label reads as a mistake.
- The transcript header on the latest question says the interviewer is "speaking" even when
  it has finished and is waiting for the person to answer. The panel beside it says
  "Listening" at the same moment. The screen contradicts itself about whose turn it is.

The person's real question is "whose turn is it, and who am I talking to?" The screen
should answer both without contradiction.

## What success looks like

1. Every interviewer has a short name for who it is (its display name), separate from the
   name of the activity. Each of the four built-in interviewers has one, and a custom
   interviewer can set one.
2. The panel beside the conversation shows that display name and that interviewer's own
   one-line purpose instead of the fixed heading and tagline.
3. The transcript labels the interviewer's turns with the display name and its initial;
   the person's own turns stay "You".
4. The "speaking" wording appears only while the interviewer's voice is actually playing.
   When it stops, the label drops "speaking" at the same moment the panel changes to
   "Listening". Checked in all five states: connecting, thinking, speaking, listening,
   interrupted.
5. Past sessions, reports and existing custom interviewers still open and read as before.
   An interviewer without a display name still shows a sensible label.

## Announcement (as if shipped)

> **Know who you're talking to.** Each interviewer now introduces itself by name. Pick
> "Rehearse an interview" and the panel beside your conversation shows *Practice
> interviewer* and what it's there to do, instead of a generic heading. The transcript
> uses the same name, and it only says the interviewer is speaking while you can actually
> hear it, so it's always clear when it's your turn. Your own interviewers can have a
> display name too.

## Mockups

`mockups/session-before-after.html`: the session screen before and after, in the
"listening" state where today's contradiction is visible.

## Deliberately not doing

- **No per-interviewer avatar art or voice.** That is #58 and needs its own spec. The
  display name is chosen so #58 can build on it later, but nothing here changes the avatar
  or the voice.
- **No change to what the interviewer says.** The display name is a label in the
  interface. The interviewer is not told its name and does not introduce itself by it.
  Changing the spoken behaviour would change every conversation and needs a separate
  decision.
- **No human first names unless you choose them.** The proposal uses role names ("Practice
  interviewer") rather than invented people ("Maya"), so the product does not imply a human
  is on the other end. This is open question 1.
- **No change to report pages, the dashboard or the interviewer list beyond what already
  shows the activity name.** They keep showing the activity, because there it is the right
  label: it says what the session was.
- **No wider vocabulary clean-up.** #45 ("interviewer, not persona") stays a separate item.
  Its "AI interviewer" heading point is absorbed here, and #45 would be narrowed to the
  remaining wording.
- **No change to the transcript dimming while the interviewer speaks.** That is #43.

## Kill check

Should this exist? Yes. The contradiction in point 4 is a defect on its own, and the
generic panel heading is already flagged in #45. The only part with real product risk is
the display-name field, because it adds one more thing to fill in when creating an
interviewer. That risk is managed by making it optional, with a fallback.

## Open questions for approval

1. **Display names for the four built-in interviewers.** Proposal (role names):
   - Explain an idea → *Curious newcomer*
   - Rehearse an interview → *Practice interviewer*
   - Tell a story → *Story listener*
   - Work out a point of view → *Thinking partner*

   The alternative is invented human first names. Choose one approach, or give the names.
2. **Fallback when a custom interviewer has no display name:** show "Interviewer"
   (proposed) or the activity name (today's PR #64 behaviour)?
3. **PR #64:** close it unmerged and supersede it with this spec's slices (proposed), or
   merge it now as an interim step?
