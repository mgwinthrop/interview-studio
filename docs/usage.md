# Usage

The Usage page shows what the app has spent on model calls, day by day. It reads the numbers-only rows that every cloud LLM call writes to the `LlmUsage` table (see [Calls and privacy](calls-and-privacy.md#usage-and-cost)). It holds no prompts, transcripts or replies.

**On this page:** [Where to find it](#where-to-find-it) · [What the page shows](#what-the-page-shows) · [Days and ranges](#days-and-ranges) · [How cost is worked out](#how-cost-is-worked-out) · [What is not counted](#what-is-not-counted) · [Keyboard and table view](#keyboard-and-table-view) · [The old summary route](#the-old-summary-route) · [Owner acceptance checklist](#owner-acceptance-checklist)

## Where to find it

- The gear button at the right of the main navigation (labelled "Usage and settings"): it opens a short list with **Usage** and **Settings**. Or open `/usage`.
- The line under the **Dashboard** heading: "Last 30 days: ... · See usage →".
- The "See all usage →" link on the usage line of a report page.

The main navigation is hidden on screens narrower than 768px. On a phone, use the Dashboard line or open `/usage` directly.

## What the page shows

- **Three tiles:** estimated cost, tokens (with the input and output split) and model calls.
- **A chart with one column per day**, stacked by what the tokens were used for: Conversation replies, Reports, Interviewer drafts and Persona drafts from calls, in that fixed order and colour. A feature with no calls still keeps its place in the legend. An unknown feature id would appear last as "Other". The largest day is labelled with its total.
- **Tokens or Cost.** Tokens means input plus output everywhere on the page. Cost shows estimated US dollars per day.
- **Range:** 7, 14, 30 (the default) or 90 days.
- **View as table** swaps the chart for a table of the same numbers (day by feature).
- **Two tables:** "By what they were used for" and "By model" (calls, input tokens, output tokens, estimated cost, and a totals row). They list only features and models with at least one call in the range.
- **Notes** under "How to read these numbers".

With no calls in the range the chart and tables are replaced by "No usage recorded in this range." If the data cannot be loaded, the page shows "Usage could not be loaded." with a Retry button.

## Days and ranges

Days are **UTC calendar days**, not your local days. The range is the last N days **including today**, so a 7-day range is today and the six days before it. Every day is shown, oldest first, and days with no activity are empty columns. The page is served by `GET /api/usage/trend?days=1..365` (default 30; anything else returns 422 with a fixed message). The Dashboard line uses `GET /api/usage/totals?days=1..365`, which counts the same days and returns only the overall totals.

## How cost is worked out

- Costs are **estimates**. They use the prices you entered on the Settings page (see [Settings](settings.md#prices)) at the time each call was recorded. Changing a price later does not change calls already recorded.
- **Costs begin when prices are set.** Calls made before a price existed have no cost and stay that way.
- A total, day or row **counts only the calls that had a price**, so it can be lower than the true spend. A cost is never shown as $0 when it is unknown.
- When no call in the range had a price, the tile shows "not available", the Cost option is disabled with a pointer to Settings, and if you were on Cost and move to such a range the page goes back to Tokens and says "Costs are not available for this range, showing tokens."
- In the Cost view, a day or feature that had calls but no priced call reads "not available"; a day with no calls reads "no usage" (tooltip) or "–" (table).
- A token count that is unknown counts as 0.

## What is not counted

- **Interrupted replies** are not recorded, although their input tokens were billed. Conversation totals can run low.
- **Speech** (ElevenLabs) is billed by audio or characters, not tokens, and is not shown here.
- `PROFILE=mock` records nothing.
- The designer chat is counted under "Conversation replies".

## Keyboard and table view

The chart is one Tab stop. Once it has focus:

- **Left and Right arrow** move between days; **Home** and **End** jump to the first and last day.
- The focused day shows a tooltip with the date, the total and each feature's value. **Escape** hides it.
- Tab leaves the chart.

Each day also has a spoken label with the same numbers. **View as table** is a toggle button (pressed state announced) and is the simplest route for a screen reader.

## The old summary route

`GET /api/usage/summary` still works and is unchanged, but it uses a **rolling window of 24-hour periods** back from now. The Usage page and the Dashboard line use UTC calendar days. The Dashboard line's cost counts only calls that had a price, and says so. For the same "30 days" the two can differ slightly, mainly in the oldest day. The Dashboard does not call the summary route, so it agrees with the page.

## Owner acceptance checklist

1. Open `/usage` from the gear button at the right of the main navigation. The main links are Home, Interviewers and Dashboard; the gear opens a list with Usage and Settings, Escape closes it and returns focus to the gear, and a click outside closes it.
2. Switch the range between 7, 14, 30 and 90 days and the measure between Tokens and Cost. The tiles, chart and tables follow.
3. Hover and use the keyboard (arrow keys, Home, End, Escape) through the columns; the tooltip shows the date, total and each feature.
4. Press "View as table" and check it shows the same numbers.
5. Check at 320px width with no horizontal page scroll, with a keyboard only, and with a screen reader.
6. Compare fonts, backgrounds, cards and buttons side by side with the Settings and Dashboard pages.
7. Confirm the Dashboard line near the top shows the same figure as the 30-day tile, and that a report page with usage shows a "See all usage →" link.
8. With no prices set, confirm the cost tile says "not available" and Cost is disabled. Set a price, make a call, and confirm costs appear only for calls made afterwards.
9. Stop the backend and reload: "Usage could not be loaded." with a Retry button that works once the backend is back.
