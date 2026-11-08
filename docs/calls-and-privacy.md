# Building a persona from calls, and privacy

This page covers the "Build from calls" feature, what leaves your machine when you use it, the controls that limit it, and what redaction does and does not catch. It is guidance for the operator and owner. It is not legal advice.

**On this page:** [What it does](#what-it-does) · [Data flow](#data-flow) · [Controls](#controls) · [What redaction does and does not catch](#what-redaction-does-and-does-not-catch) · [The leak check](#the-leak-check) · [Usage and cost](#usage-and-cost) · [UK GDPR and client NDAs](#uk-gdpr-and-client-ndas) · [Roles](#roles) · [Optional evaluator](#optional-evaluator) · [Wording for participants](#suggested-wording-for-participants) · [Owner acceptance checklist](#owner-acceptance-checklist) · [Known accessibility follow-ups](#known-accessibility-follow-ups)

## What it does

You paste one or more Microsoft Teams call transcripts. The tool builds a draft interviewer (a "composite persona" of the buyer in those calls) that you can rehearse against. The draft fills the `behaviours` field of the interviewer (see [Interviewers](interviewers.md)).

The flow, at `/interviewers/calls`:

1. **Paste** a transcript (up to 24,000 characters per call for the parser). The edit box and the draft route allow up to 30,000 characters per call, because role labels can make the redacted text slightly longer; this is also why the edit box has its own 30,000-character limit and cuts text typed or pasted beyond it. The "characters sent" figure on the confirm screen is approximate, because the `CALLS:` and `CALL n:` headers the server adds are not counted. Request bodies are limited to 256kb for speakers and redact, and 768kb for draft.
2. **Speakers.** The server finds the speakers. You pick the buyer. Check this list: a line such as "Total 10:00" inside someone's speech can look like a speaker header.
3. **Redaction.** The server replaces names, your names-to-hide list, emails, phone numbers, URLs and money amounts with placeholders.
4. **Review.** You read the highlighted result, tick suggestions, edit the text and fix anything redaction missed. This is the real control.
5. **Approve** each call. You can add up to 8.
6. **Confirm.** A dialog shows what will be sent (counts only). Nothing is sent until you confirm.
7. **Draft.** The redacted, approved text goes to Anthropic's API, which returns a draft interviewer.
8. **Edit and save.** The draft opens in the interviewer editor. You edit it and save it yourself.

Nothing is stored from the pasted calls: not the original, not the redacted text, not your names-to-hide list. Only the interviewer you choose to save is stored. The draft is never saved automatically.

## Data flow

| Data | Where it goes | Stored? | Main risk | Mitigation |
|---|---|---|---|---|
| Pasted transcript | Your browser to your own backend server (`/speakers`, `/redact`) | No | Names and other identifying detail in the text | Redaction runs on the backend you operate and makes no provider call. Call text is never logged. |
| Redacted, approved text (buyer lines plus the line before each) | Your backend to Anthropic's API, only after Confirm | Not by this tool. Anthropic's own retention terms apply. | Detail the redaction missed reaches a third party | Review step, confirmation step, the cloud-send switch, size caps, leak check on the reply |
| Draft interviewer | Anthropic's API back to your browser | No, until you save it. While the editor is open the draft is held in this browser tab's sessionStorage (`interviewer_draft`); it is removed when you save it as a new interviewer, and otherwise stays until the tab is closed | The model repeats a name or term | Leak check; you review the draft in the editor |
| Saved persona (including `behaviours`) | Your SQLite database | Yes | It is stored text the model wrote | You edit it before saving; delete it like any interviewer |
| Rehearsal audio | Your browser to your backend, then to the speech provider (ElevenLabs) | Audio is never stored by this tool | Provider-side handling of voice | Operator contract and settings with the provider |
| Rehearsal transcript and report | Anthropic's API (conversation, report) | Yes, in your SQLite database | Same as any session | Delete route, `RETENTION_DAYS` |
| Usage rows | Your SQLite database | Yes, numbers and ids only | None of substance: no text | No prompts, transcripts or replies are written to them |

## Controls

| Tier | Control | Default | What enforces it |
|---|---|---|---|
| Operator (env) | `CLOUD_SEND_TRANSCRIPTS` (`1` or `true`) | off | `callsEnabled` in `config.ts`. When off, `POST /api/interviewers/calls/draft` answers 403 and `GET /api/features` reports `personaFromCalls: false`, so the app hides the entry point and `/interviewers/calls` shows a "turned off" message. Speakers and redaction still work (no provider is called). |
| Operator (env) | `PROFILE` | `cloud` | `PROFILE=mock` also enables the feature, because nothing leaves the machine. |
| Operator (env) | `AUTH_TOKEN` | none | Shared-token mode. Required for a non-loopback `HOST`. See [Operations](operations.md). |
| Operator (env) | `RETENTION_DAYS` | off | Purges ended sessions and usage rows older than that, once at startup. |
| User (in app) | Review and approve step | required | Approve is disabled until the text still has a "Buyer:" line and the names list matches the redaction shown. |
| User (in app) | Confirmation step | required | The draft request is sent only from the confirm dialog. |
| Fixed in code | `confirmed: true` | required | The draft route answers 422 unless the body has `confirmed: true`. |
| Fixed in code | Size caps | see right | 24,000 characters per pasted call (parser); up to 8 calls; at most 30,000 characters sent in total (the newest are kept); 50 names to hide, 80 characters each; forbidden lists of at most 500 entries, each at most 120 characters. |
| Fixed in code | Only buyer lines and the line before each are sent | always | `interviewer/designer.ts` |
| Fixed in code | Leak check | always | See [The leak check](#the-leak-check). |
| Fixed in code | The draft route saves nothing | always | It returns a draft only. |

## What redaction does and does not catch

It is deterministic code on your backend. No model is involved.

**It replaces:** speaker names and their parts (first and last names separately), possessives, apostrophe variants, the names-to-hide list you type, emails, phone numbers, URLs, currency amounts, ranges and percentages. Speakers are replaced with roles (the buyer, "Our side 1").

**It does not catch, or it over-catches:**

- Names and organisations that are not in the speaker list or your names-to-hide list. Client company names, other people who are mentioned but do not speak, products and places are not redacted unless you type them into the names list or tick them from the suggestions. The suggestions are only suggestions. This is the main way to over-trust redaction.
- Short name parts: a first or last name part shorter than 3 characters (Li, Wu, Ng, Xu, Ed, Al, Jo) is not redacted on its own and is ignored by the leak check, so it can stay visible even though the full name is replaced. Add such names to the "names to hide" list, which does redact them (an entry of 2 characters is accepted and applied; the leak check still ignores it), and read the text in full.
- Spelled-out numbers ("fifty thousand").
- Nicknames and abbreviations of a name or company, unless you add them to your list.
- Names and terms glued to other text with no word boundary ("PriyaShah").
- Accent-stripped variants of a name.
- Partial phone numbers ("555.0199") and bare domains with a top-level domain it does not know.
- Bare small prices with no unit ("900 a day").
- Unlisted currency prefixes: for "MX$50" the letters "MX" stay visible.
- Unusual ranges, such as "10-20-30%" and "$50/75": an end can stay visible.
- Over-redaction: years ("2026") become an amount placeholder, "5mm" and long digit runs too, and "2023-2024" can become a contact placeholder.
- Context that identifies a client without naming them: an industry, a product, a story only that client could tell.
- A speaker header whose name does not have the expected shape (1 to 6 words, each capitalised or one of a few lowercase particles such as "van" or "de", with no sentence punctuation). Examples: a name in a non-cased script (for example Chinese), a lowercase name ("Tom jones 0:10"), "Last, First" ("Shah, Priya 0:03") or an e-mail address. With a single space before the time, the header is treated as plain text, with no message: that speaker is not in the speaker list, their name stays visible in the text, their lines merge into the previous speaker, and later `Buyer:` labels can attach to the wrong person. With a tab or two or more spaces before the time, the same headers make the whole paste fail with a message that no speakers were found. That fails safe, but directory-style "Last, First" display names cannot be used until the format is changed. Check the speaker list against the call before you choose the buyer, and read the redacted text in full.

The review step is the real control. Read the text before you approve it. Do not describe the result as anonymised, or as safe, secure or compliant.

## The leak check

After the model replies, the server checks the draft for the strings the redaction step reported (names, name parts and your terms). The client supplies that list with the draft request, so the check guards against the model repeating what you were shown, not against a hand-made request.

- Matching is whole-word only, and forbidden strings shorter than 3 characters are ignored.
- Full names and terms typed in lower case are matched case-insensitively.
- A single capitalised word (a first name, for example) is matched in its own case or in UPPERCASE only. Matching "Will" case-insensitively would reject any draft containing "will".
- Trade-off: a lower-case rendering of a bare capitalised first name or term is not caught.
- On a leak the server repeats the identical model call once (one extra LLM call). If the second reply also leaks, you get a fixed error and no draft.

## Usage and cost

Each cloud LLM call writes a row to the `LlmUsage` table (migration `20261108120000_llm_usage`): feature, model, token counts, owner and session ids, and a time. No prompts, transcripts, replies or drafts.

See it on the dashboard ("Usage" panel, last 30 days by feature), on a report page (one line with that session's total), or through `GET /api/usage/summary?days=1..365` and `GET /api/usage/session/:sessionId`.

Caveats:

- Interrupted replies are not counted, although their input tokens were billed. Conversation totals can run low.
- Designer chat is counted under "conversation".
- Costs are estimates, computed when each call was recorded, from the `PRICES` table in `apps/backend/src/usage.ts`. That table ships empty: no prices are invented. Cost shows "not available" until the operator fills it from the provider's published prices and sets `asOf`. Changing the table later does not change rows already recorded.
- A row's cost can be a partial sum of the priced calls, and a token count that is unknown counts as 0.
- `PROFILE=mock` records nothing.
- Usage rows are deleted with their session and by `RETENTION_DAYS`. Designer and "Try it" sessions store no session, but their usage rows are written with the owner id and no session id, so only `RETENTION_DAYS` removes them.

## UK GDPR and client NDAs

This is guidance, not legal advice. Check your own position.

- Speaker names in a transcript are personal data.
- Redacting locally, before any third-party call, may help with data minimisation. It is not a guarantee: see the limits above.
- Each provider that sees data is a processor: Anthropic for conversation, reports and persona drafts; ElevenLabs for speech; and any evaluator you add later. The owner must obtain each provider's data processing agreement, processing region, sub-processors and retention terms. The tool cannot verify these.
- A client NDA may bar sending even redacted material to a third party. `CLOUD_SEND_TRANSCRIPTS` lets an operator keep the feature off.
- The session delete route and `RETENTION_DAYS` support storage limitation for stored sessions. They do not reach copies held by providers.
- A data protection impact assessment is recommended before you use real calls. This repository does not provide one.
- Nothing here is a certification, and the tool makes no certification claim.

## Roles

There are none in version 1. This is a single-user prototype with no per-user accounts. The operator's settings are the access control.

## Optional evaluator

An optional evaluator provider (Jev) is not built in this change. The design reserves it for later steps, off by default. It would only ever see rehearsal transcripts, never source calls. Its compliance status is not established. See "Optional evaluator provider: Jev" in [the design](superpowers/specs/2026-11-08-composite-personas-design.md).

## Suggested wording for participants

Edit this to suit you.

> This rehearsal is a voice conversation with an AI interviewer. Your voice is sent to a speech service to be turned into text, and the text is sent to an AI service (Anthropic) to write the interviewer's replies and a report. The tool does not keep the audio. It keeps the text of the conversation and the report on this computer until it is deleted. Tell me before we start if you do not want to take part.

## Owner acceptance checklist

Do this on synthetic transcripts only (for example `apps/backend/src/__tests__/fixtures/calls/teams-basic.txt`). Start the backend with `PROFILE=mock npm run dev` and the frontend with `npm run dev`.

1. `/interviewers` shows "Build from calls". Paste a transcript, Find speakers, choose the buyer.
2. Add a name to hide and redact. Names, terms and amounts are highlighted with text labels. Tick a suggestion: it is added and the text is redacted again.
3. Change the names list without redacting again: Approve is disabled and says why. Edit the text and delete every "Buyer:" line: Approve is disabled. Undo and approve.
4. Add a second call, approve it, remove one. With one call, the one-call note shows.
5. Network tab open: use Draft persona. The dialog opens with focus on its heading and shows the counts, and no request to `/calls/draft` has gone out. Tab and Shift+Tab stay in the dialog. Escape closes it and returns focus to Draft persona. Confirm and send: exactly one request, and the editor opens with the draft and `behaviours` filled.
6. Repeat the whole flow by keyboard only, with focus always visible.
7. Repeat at 320px width: no horizontal page scroll, long names and lines wrap.
8. Repeat with reduced motion on: nothing animates.
9. Use a screen reader (NVDA or VoiceOver) on a highlight and on the dialog.
10. Check where focus lands after Find speakers and after ticking a suggestion, and the forbidden count for a large call.
11. Editor: type in `behaviours`, check the count, save, reopen; save it empty; duplicate; view a preset (field hidden); Try it then back keeps the value; a server error on `behaviours` shows on the field.
12. Run the backend with `PROFILE=cloud`, dummy keys and `CLOUD_SEND_TRANSCRIPTS` unset: the entry point is absent and `/interviewers/calls` shows only the "turned off" message with a link back.
13. Dashboard "Usage" panel: collapsed at first, with no request before it is opened; keyboard toggle; the table scrolls at 320px; a short viewport leaves the report area usable; with the empty price table it shows "not available"; with the backend stopped it shows "Usage could not be loaded."
14. A report page of a session with usage shows one muted line; a mock session shows none. Check the text contrast of that line.

## Known accessibility follow-ups

Not fixed yet. They came from review, and the UI has not been seen in a browser.

- Focus drops to the page after Find speakers and after ticking a suggestion, because the focused control becomes disabled.
- Shift+Tab from the error text in the confirm dialog leaves the dialog and is pulled back to the heading. The page behind the dialog is not inert and can scroll.
- "About N characters" leaves out the call headers (up to about 71 characters).
- Leaving the page mid-draft can still push to the editor. The page is briefly blank after success.
- Ticking a suggestion while editing discards the edits.
- More than 500 forbidden entries gives a generic message that cannot be recovered from.
- The edit box limit can silently cut a long paste.
- The usage error state lasts until reload, a very small cost shows as "$0.0000", the report usage line shifts the page by about 30px when it loads, and the usage scroll region has a long label.
