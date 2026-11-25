# FQ-52 - Gate 1: product

## The problem

You have practised five times this month. Each report tells you how that one conversation
went: your pace, your pauses, how long you took to start answering, how long your answers
ran. What no page tells you is whether any of it is changing. Are you still rushing? Are
your answers getting tighter? To find out, you would open five reports and compare numbers
by hand.

Practice only pays off if you can see it working. Today the numbers that would show it are
stored, session by session, and never put side by side.

## What success looks like

1. **Your delivery over time, on one screen.** The History page shows how each delivery
   number has moved across your sessions, oldest to newest, so a change in your habits is
   visible at a glance.
2. **Like compared with like.** Different interviewers draw different answers (telling a
   story runs longer than explaining an idea), so you can narrow the view to one
   interviewer.
3. **Numbers, not verdicts.** Nothing is scored, graded, coloured good or bad, or compared
   with a target. The page shows what happened; you decide what it means. Every number on
   it is measured in code, never written by the AI.
4. **Honest about thin data.** With fewer than two measured sessions there is nothing to
   compare, and the page says so plainly instead of drawing a one-point line.

**How we measure it:** with three or more stored mock sessions, the History page shows a
line per number across those sessions. Narrowing to one interviewer shows only its
sessions. With one session, it shows the "not enough yet" message. Every number equals
the matching figure in that session's own report.

## Announcement

> **See your delivery change over time.** The History page now shows your pace, your
> pauses, how quickly you start answering and how long your answers run, across all your
> practice sessions. Narrow it to one interviewer to compare like with like. No scores and
> no targets: just your own numbers, so you can see whether practice is moving them.

## Screens

`mockups/progress.html` shows the progress section on the History page with an interviewer
filter, and the "not enough yet" state.

## Decisions for the owner

1. **Which numbers.** Recommended: four.
   - Pace (words per minute).
   - Typical gap before answering.
   - Longest pause.
   - Typical answer length (words).

   Filler words appear only when they are already switched on for reports
   (`REPORT_FILLER_COUNTS`), for the same reason they are hidden there: the speech-to-text
   service may drop them, so a zero could mislead.
2. **One point per session, not per answer.** Recommended: each session is one point, using
   its typical (median) value, so one rambling answer does not swamp the line.
3. **What the view starts on.** Recommended: all interviewers, with a filter. The
   alternative is to start on the interviewer you use most, which is more accurate but
   hides sessions until you change the filter.

## What we are deliberately not doing

- **No scores, grades, targets or "ideal" ranges**, and no good or bad colours. That is
  the title of the issue and the product's stance.
- **No AI commentary on the trend.** No written "you are improving". Delivery numbers come
  from code, and a model interpreting a trend line would turn them into a verdict.
- **No streaks, goals, reminders or notifications.**
- **No new data collected.** Only numbers already stored for every spoken answer. Audio
  is still never stored.
- **No export** and no comparison with other people.
- **No changes to the report itself.**

## Should this exist?

Yes. The numbers are already measured and stored for every spoken answer; showing them
side by side is what makes repeated practice legible. The risk is the trend becoming a
score by the back door, and the "not doing" list above exists to stop that.
