# Settings page: models, reply length, speech, spoken-reply format and prices: design

Status: draft for approval. Follows the composite personas change (PR 5, merged).

## Intent and why

The owner wants to control, from inside the app, which models the app uses and what they cost, because models and prices change. Today the Claude model is a constant in `apps/backend/src/providers/cloud.ts`, the reply limit is a constant in `sessionController.ts`, the speech models are constants in `cloud.ts`, and the Claude price table is an empty constant in `usage.ts` that the owner would have to edit in code. The project docs call the model and speech choices fixed; the owner has now explicitly asked to move them into a settings page, so those docs change as part of this work.

## Goals

A Settings page in the app (linked from the site navigation) where the owner can:

1. **Choose a Claude model for each of three jobs**: conversation replies, reports, and interviewer and persona drafts. The choices come from Anthropic's live model list (`GET /v1/models`). Each model shows a tier badge from the list's `line` field: `haiku` = Fast, `sonnet` = Balanced, `opus` = Most capable; other lines (fable, mythos) and null show no badge. Each job shows a plain recommendation:
   - Replies: Fast or Balanced. Replies are spoken aloud in under 40 words, so speed matters more than depth.
   - Reports: Balanced or Most capable. One long answer produced once; time is available (up to 90 seconds).
   - Drafts: Balanced or Most capable. One structured answer; the check for names and client terms runs in code whichever model is chosen.
2. **Defaults are the recommended values, picked once and remembered.** The first time a job needs a model and none is stored for that owner (when the Settings page is opened, or when a conversation, report or draft runs), the app resolves the recommendation from the live list and saves it: replies get the newest active Fast-tier model; reports and drafts get the newest active Balanced-tier model ("newest" by `created_at`, "active" by `lifecycle`). After that the stored value changes only when the owner changes it or presses "Reset to recommended", which resolves and saves again. A new model from Anthropic never changes a stored choice. If the live list cannot be loaded when nothing is stored, the built-in fallback applies for that call (today's model id, `claude-sonnet-4-6`) and is not saved, so the app never has no model and a later successful resolution still happens. Consequence the owner has accepted: on an existing install, the first use after this change switches conversation replies from `claude-sonnet-4-6` to the recommended Fast-tier model, which changes speed, cost and voice; the docs and the page must say so.
3. **Set the longest spoken reply** (the hard token ceiling on conversation replies). Default 300, which is today's value. Allowed range is a builder's call within 50 to 1000. The 40-word instruction in the prompt is unchanged; reports (3072) and drafts (6144) keep their own larger fixed budgets.
4. **Choose the speech-to-text model**: a typed model id with `scribe_v2` as the default and recommended value. No live list is used because ElevenLabs documents none for speech-to-text.
5. **Choose the text-to-speech model** from ElevenLabs' live list (`GET /v1/models`, entries with `can_do_text_to_speech`). Default `eleven_flash_v2_5` when present in the list.
6. **Choose the spoken-reply format**, limited to MP3 variants: `mp3_22050_32`, `mp3_24000_48`, `mp3_44100_32`, `mp3_44100_64`, `mp3_44100_96`, `mp3_44100_128` (default and recommended, which is ElevenLabs' own default), `mp3_44100_192` (ElevenLabs documents that this needs the Creator plan or above; the page says so). Only MP3 is offered because the browser player and the protocol document assume MP3 and the Cartesia fallback produces MP3.
7. **See the microphone format, read-only**: 16 kHz, mono, 16-bit. It is built into voice detection, the speech-to-text request and the connection protocol, so it is not editable.
8. **Enter Claude prices** (USD per million input tokens and per million output tokens, plus an as-of date) for each model. A price row appears automatically for every Claude model that is selected; until it is filled in, the row says "not set" and cost shows "not available". The empty `PRICES` constant in code is removed. Speech services are not billed per token and have no price rows.
9. **Reset everything to recommended** with one control, with a confirmation.

Behaviour:
- Settings are stored in the database, owner-scoped like all other data (the designer's call; in local mode the owner is "local").
- A conversation snapshots its settings when it starts and keeps them until it ends. Reports and drafts read the settings when they run. A change therefore affects new work only.
- Saving is validated on the server: a Claude model id must be in the live list (or already be the stored value); a text-to-speech model id must be in the live list (or already the stored value); the spoken-reply format must be one of the allowed values; the speech-to-text id must match a safe pattern; token and price values must be finite numbers in range.
- Prices already used to compute a recorded usage row never change; a new price affects calls made after it is saved. The Usage summary's "prices as of" line comes from the stored prices.
- If a live list cannot be loaded, the page shows the current values, says the list could not be loaded, and refuses changes to that field until it loads. Other fields remain editable.
- Live lists are cached on the server for a short time (builder's call, about 10 minutes) so opening the page does not hit the providers every time.

## Non-goals

- Changing the microphone format, the WebSocket protocol, or the message types.
- Non-MP3 spoken-reply formats; Cartesia fallback settings; voice id; API keys (keys stay in environment variables and are never sent to the browser).
- Speech service pricing or cost estimates.
- Choosing a different provider (for example OpenAI instead of Anthropic). That is a separate follow-on feature: it needs a new LLM provider implementation, a way to tell Fast, Balanced and Most capable models apart for that provider, its own model list, usage and price handling, and updated privacy documentation naming the new processor. Keys would stay in environment variables, with the page showing only "key configured" or "not configured"; storing keys typed into the page is a separate security design. Nothing in this change should make that follow-on harder (keep the model and provider choice behind the existing provider interface).
- Per-interviewer model choice; model benchmarking; automatic model switching; roles or per-user permissions.
- Changing report or draft token budgets, phase logic, or the 40-word rule.

## Anti-goals (a failure even if it works)

- An API key, or any text derived from one, reaching the browser, the settings table, a log or an error body.
- An unvalidated model id or format reaching a provider.
- A settings change that alters or breaks a conversation already running.
- Any claim that a recommendation is measured: the page says recommendations are general guidance.
- Prices or tiers shown as authoritative when they are owner-entered or derived.

## Constraints

- Backend: Node 20, Express, zod, Prisma/SQLite; the new routes sit behind the existing authenticator; the migration is additive; existing databases upgrade; with an empty settings table the app behaves as it does today.
- Frontend: Next.js 14, no frontend tests; the page must work by keyboard, at 320px, with reduced motion, with WCAG AA contrast and the existing styles; follow the patterns of the interviewers and calls pages.
- Do not log keys, request bodies or provider responses beyond status and error class.
- The mock profile needs no keys: it returns a fixed model list and accepts saves.
- Docs that call these choices fixed must be updated: `docs/how-it-works.md` "Technology choices", the matching sentence in `CLAUDE.md`, `docs/calls-and-privacy.md` (controls table and the Usage section, which says the price table lives in code), `docs/operations.md`, and `README` if it names the model.
- The usage records written by the previous change store the model id; they must record the model actually used for each call.

## Decided with the owner

- A settings page in the app; the layout with a separate model for each job, a recommendation under each, and prices on the same page.
- Model lists from the live provider lists.
- Reply length, speech models and spoken-reply format move to the page; every default is the recommended value.
- Microphone format fixed and shown read-only; spoken-reply format configurable.
- Defaults are picked once from the live list and remembered (not re-resolved on every use, and not left on today's model).
- Choosing a different provider is a separate follow-on; API keys stay in environment variables in this change.

## Designer's calls (made without the owner; owner to check)

- **List unavailable.** If a live list cannot be loaded (including the case where the messages key is not accepted by the list endpoint), that field is read-only with a message and a retry control. There is no manual model-id entry in v1. The builder uses the same authentication style as the Anthropic SDK (`x-api-key` plus `anthropic-version`) and the owner verifies the page with the real keys during acceptance.
- **Speech-to-text id.** Pattern check only (letters, digits, `_`, `-`, `.`, up to 60 characters). The page warns that a wrong id makes speech recognition fail and that "Reset to recommended" fixes it. No test call on save.
- **Which settings each session type uses.** The settings are snapshotted in memory on the session controller when it starts (no database change). Designer and Try-it sessions use the replies model for their conversation and the drafts model for the draft made when they end. A regenerated report uses the reports model current at the time. Usage records store the model actually used.
- **Prices.** One row per owner and model, replaced in place, with an as-of date; no price history (old usage rows keep the cost computed when they were recorded). The mock profile's fixed model list uses clearly fake ids (for example `mock-fast`, `mock-balanced`) with `line` values so the whole page can be exercised without keys.

## Findings from reading the provider docs (2026-11-08; not yet tried with a real key)

- Anthropic `GET /v1/models` returns per model: `id`, `display_name`, `created_at`, `lifecycle`, `line`, `max_tokens`, and more; it is paginated (default 20, up to 1000). The example in the docs authenticates with a Bearer header and does not state whether the messages key works for it. The Anthropic SDK installed in the repo (0.39.0) returns only `id`, `display_name`, `created_at`, so the builder should call the endpoint directly with `fetch` (the code already does so for ElevenLabs) or upgrade the SDK, and must verify the headers with a real key before relying on them.
- ElevenLabs `GET /v1/models` returns `model_id`, `name`, `can_do_text_to_speech` and more; the docs do not say whether speech-to-text models appear there. The `output_format` values listed above are as documented.

## Left to the builder

- Table design for settings and prices; route shapes (suggested: `GET /api/settings`, `PUT /api/settings`, `GET /api/settings/options`); the cache; how the provider layer receives the model per call and how a conversation snapshots settings; paging through the Anthropic list; how to treat deprecated and retired models (suggested: hide retired, show deprecated with a note); the exact reply-length range; wording of the page copy; test strategy including a keyless mock path; docs updates.
- Whether to upgrade the Anthropic SDK or call the endpoint directly.

## UI and acceptance

The page is a trust surface for spend and for what leaves the machine, so it must be plain and unambiguous: every field has a visible label, hint and error; the recommendation text sits with its field; the save result is announced; "Reset to recommended" asks for confirmation. Before it is called done, the owner walks through it by keyboard, at 320px and with reduced motion, changes a model, saves, runs a short conversation and a report, and checks the Usage section shows the new model and a cost once a price is entered.
