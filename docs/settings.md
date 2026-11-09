# Settings

The Settings page chooses which models the app uses, how long spoken replies can be, which spoken-reply format is requested, and what each Claude model costs. API keys are not set here: they stay in environment variables.

**On this page:** [Where to find it](#where-to-find-it) · [Claude model per job](#claude-model-per-job) · [Defaults are picked once](#defaults-are-picked-once-and-remembered) · [When settings apply](#when-settings-apply) · [Reply length](#reply-length) · [Speech](#speech) · [Spoken-reply format](#spoken-reply-format-and-microphone-format) · [Prices](#prices) · [When a list cannot be loaded](#when-a-live-list-cannot-be-loaded) · [Keys and providers](#keys-and-providers) · [Known limitations](#known-limitations) · [Owner acceptance checklist](#owner-acceptance-checklist)

## Where to find it

Use the **Settings** link in the main navigation, or open `/settings`. The main navigation is hidden on screens narrower than 768px (this was already the case for every link). On a phone, open `/settings` directly, or use the Settings link in the Usage section when no prices are set.

The page reads and writes through `GET /api/settings`, `PUT /api/settings` and `POST /api/settings/reset`. They sit behind the same authentication as the other routes and are scoped to the owner. Settings are stored in the `AppSettings` and `ModelPrice` tables (migration `20261108130000_app_settings`).

## Claude model per job

There are three jobs, each with its own model:

| Job | Used for |
|---|---|
| Conversation replies | What the interviewer says during a session, including the designer chat and Try it |
| Reports | The report written when a session ends, and a regenerated report |
| Interviewer and persona drafts | The draft made at the end of a designer session, from one description, or from calls |

The choices come from Anthropic's live model list, fetched with your `ANTHROPIC_API_KEY`. The server caches the list for about 10 minutes (a failed attempt for 30 seconds).

- **Tier badges** come from the list's `line` field: `haiku` is **Fast**, `sonnet` is **Balanced**, `opus` is **Most capable**. Other lines have no badge.
- **Recommendation.** Each job shows one: the newest active Fast-tier model for replies, the newest active Balanced-tier model for reports and drafts. This is general guidance based on the tier, not a measurement of how any model performs here.
- **Deprecated** models can be selected and are marked. **Retired** models are not shown.
- The model you have saved is always selectable, even if it is no longer in the list.

## Defaults are picked once and remembered

When a job has no stored model and the list loads, the app resolves the recommendation and saves it. After that it changes only when you change it or press **Reset to recommended**. A newer model appearing in the list does not change a saved choice.

If the list cannot be loaded, the built-in fallback `claude-sonnet-4-6` is used for that call and is not saved, so the next call tries again.

What you will notice on an existing install: the first time a model is needed after this change, conversation replies switch from `claude-sonnet-4-6` to the recommended Fast-tier model. That changes speed, cost and voice. Choosing models on the page overrides it.

The very first conversation (or the first after Reset) may wait for Anthropic's model list for up to 8 seconds before the interviewer speaks. This happens once, because the list is then cached. Opening the Settings page first remembers the defaults and avoids that wait.

## When settings apply

- A conversation takes a snapshot of the settings when it starts and keeps it. Changing settings never alters a conversation already running.
- Reports and drafts read the current settings when they run. A regenerated report uses the reports model current at that time.
- Designer and Try it sessions use the replies model for their conversation, and the drafts model for the draft made at the end.

## Reply length

The reply length is the hard token ceiling on a spoken reply: default 300, allowed 50 to 1000. The instruction in the prompt to keep replies to about 40 words is unchanged. Reports (3072 tokens) and drafts (6144) keep their own larger fixed budgets.

## Speech

- **Speech-to-text** is a typed id (default `scribe_v2`). ElevenLabs documents no live list for it, so the app checks only the pattern (letters, digits, dots, underscores, hyphens, up to 60). A wrong id makes speech recognition fail; **Reset to recommended** puts the default back.
- **Text-to-speech** is chosen from ElevenLabs' live model list (default `eleven_flash_v2_5`).

## Spoken-reply format and microphone format

Only MP3 variants can be chosen, because the browser player and the [WebSocket protocol](websocket-protocol.md) assume MP3, and the Cartesia fallback also produces MP3. The seven formats: `mp3_22050_32`, `mp3_24000_48`, `mp3_44100_32`, `mp3_44100_64`, `mp3_44100_96`, `mp3_44100_128` (default), `mp3_44100_192`.

Per ElevenLabs' documentation, the 192 kbps format needs a paid plan (Creator or above). The page marks it.

The ElevenLabs request now always carries an explicit `output_format`. The default, `mp3_44100_128`, equals ElevenLabs' documented default. Confirm that it works on your plan.

The microphone format is shown read-only and is fixed: 16 kHz, mono, 16-bit. Voice detection, speech recognition and the connection protocol depend on it.

## Prices

Prices are for Claude models only: USD per million input tokens and per million output tokens, plus an as-of date. You enter them on the page; nothing is built in.

- One row per model, replaced in place when you save.
- The page shows a row for every selected model that has no price, marked "not set".
- Cost in Usage shows "not available" until a price is set.
- A new price affects only calls made afterwards. Usage already recorded keeps the cost it had when it was recorded.
- A row's cost can be a partial sum of the priced calls.
- Speech services are not billed per token, so they have no price rows and Usage does not estimate their cost.
- Interrupted replies are not counted in usage at all (see [Calls and privacy](calls-and-privacy.md#usage-and-cost)).
- Costs are estimates from the numbers you entered, not exact figures.

Number fields (prices and reply length) are text boxes, so type digits. Prices accept `.5` and `5.`, but not a comma.

**Reset to recommended** does not change prices.

## When a live list cannot be loaded

The field becomes read-only, with a message and a retry. Values already saved keep working. You can still enter prices for the models that are selected. If the Claude list is down, Reset leaves the model choices untouched (it still resets reply length, speech models and format), and the page says so.

## Keys and providers

API keys stay in environment variables (`apps/backend/.env`). They are never sent to the browser and never stored in settings. Choosing a different provider (for example OpenAI) is a separate follow-on feature: it would need a new provider implementation, its own model list and usage handling, and updated privacy documentation.

## Known limitations

- The first conversation after an upgrade or Reset can wait up to 8 seconds for the model list before the interviewer speaks (see above).
- A model id of `__proto__` would get no cost estimate.
- Saving writes the values, then the prices, in two steps. If the second fails, the values stay saved and the page reports an error; save again.
- A second browser tab can overwrite a price row saved in the first.
- The real Anthropic and ElevenLabs list endpoints were written from their documentation and have not been tried with real keys.
- Recommendations are general guidance.
- If the settings cannot be read from the database, the app uses the built-in values for that call.

## Owner acceptance checklist

Do this with real keys.

1. Open Settings and confirm both lists load. If the Anthropic list does not load, the endpoint may need a different authentication header than the one used: report it.
2. Go through every control with the keyboard only.
3. Check the page at 320px width and with reduced motion on.
4. With a screen reader, check the selects, the price table, the error summary and the Reset confirmation.
5. Change the replies model, save, run a short conversation, and check the speed and that Usage shows the new model.
6. Enter a price and check Usage shows a cost.
7. Try the 192 kbps format on your plan.
8. Press Reset to recommended.
9. On a phone, check the numeric keypad appears for the number fields.
10. After changing a model choice, check the saved model can still be selected again.
11. Check the `:focus-visible` outline on the price table scroll region.
