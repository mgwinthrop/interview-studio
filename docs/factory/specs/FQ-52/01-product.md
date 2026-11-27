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

1. **Your delivery over time, on one screen.** A Progress page shows how each delivery
   number has moved across your sessions, oldest to newest, so a change in your habits is
   visible at a glance. A one-line summary on the Dashboard (History) links to it.
2. **Like compared with like.** Different interviewers draw different answers (telling a
   story runs longer than explaining an idea), so you can narrow the view to one
   interviewer.
3. **Numbers, not verdicts.** Nothing is scored, graded, coloured good or bad, or compared
   with a target. The page shows what happened; you decide what it means. Every number on
   it is measured in code, never written by the AI.
4. **Honest about thin data.** With fewer than two measured sessions there is nothing to
   compare, and the page says so plainly instead of drawing a one-point line.

**How we measure it:** with three or more stored sessions, the Progress page shows one
point per session for every number those sessions measured. Narrowing to one interviewer
shows only its sessions. With one session, it shows the "not enough yet" message. Every
number equals the median of the matching per-answer figures in that session's own report,
except filler words, which equal that report's filler count per 100 words spoken.

> Reworded 2026-11-25 (owner, at gate 2). This first said "a line per number across three
> mock sessions" and "equals the matching figure in that session's own report". Pace and
> longest pause in the report are a time-weighted average and a maximum, not medians, so
> the measure now follows D2 (gate 2, Q1 option B). Mock sessions cannot measure pace (every
> mock answer is two words), so the measure no longer requires a line for every number in
> mock.

> Amended 2026-11-27 (owner, at gate 3). The trend moved from a section on the History page
> to its own Progress page, linked from a one-line summary on the Dashboard, the same pattern
> as the Usage line and page. Filler words are shown per 100 words spoken, not as a session
> total, so a longer session does not look like more fillers.

## Announcement

> **See your delivery change over time.** The new Progress page shows your pace, your
> pauses, how quickly you start answering and how long your answers run, across all your
> practice sessions. Narrow it to one interviewer to compare like with like. No scores and
> no targets: just your own numbers, so you can see whether practice is moving them.

## Screens

`mockups/progress.html` shows the cards, the interviewer filter and the "not enough yet"
state. Its layout and wording still hold. Since gate 3 they sit on their own Progress page,
reached from a one-line summary on the Dashboard (History).

## Decisions for the owner

1. **Which numbers.** Recommended: four.
   - Pace (words per minute).
   - Typical gap before answering.
   - Longest pause.
   - Typical answer length (words).

   Filler words appear only when they are already switched on for reports
   (`REPORT_FILLER_COUNTS`), for the same reason they are hidden there: the speech-to-text
   service may drop them, so a zero could mislead. Since gate 3 they are shown per 100
   words spoken.
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
