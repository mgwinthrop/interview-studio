# Composite personas from redacted call transcripts: design

Status: draft for approval. Step 1 of 4 (see "Wider roadmap").

## Intent and why

The owner wants engineers to rehearse selling to buyers (CTO, CIO, Director of Engineering) when the engineers cannot join the real calls. The best source of realistic pushback is recorded sales calls (Microsoft Teams transcripts). Those transcripts contain client names and pricing, so they cannot simply be fed to an AI tool.

This feature lets a person build an interviewer persona from several real call transcripts, after the transcripts have been redacted locally and approved by the person. The persona captures how a type of buyer behaves (objections, priorities, tone, vocabulary) and never what a specific client said.

Longer term the tool is a general rehearsal engine for any high-stakes conversation. Technical sales is the first proving ground. Nothing in this step should hard-code sales: a "counterpart" is any person whose lines are used as source material.

## Goals

- Paste one or more Teams transcripts, one at a time.
- For each: choose which speaker is the counterpart (buyer); everyone else is "our side".
- A local, deterministic redaction pass runs in the browser or backend before any text reaches an LLM. The person sees the redacted text with changes highlighted, can edit it, and must approve it.
- Approved, redacted transcripts (the counterpart's lines plus enough context to understand them) are combined into one **composite** persona draft, using the existing draft path: validated by `parseInterviewerInput`, shown in the existing editor, never auto-saved.
- The composite cannot be traced to a single client. The draft records only how many calls it was built from, never the source text.
- The tool states plainly that redaction is best-effort and the approval step is the real control.

## Non-goals

- File upload or parsing (`.vtt`, `.docx`, PDF, audio). Paste only, for now.
- Mimicking a named real person. The persona is a type, not an impersonation.
- Guaranteeing anonymity. No claim of "anonymised" or "safe" anywhere in the UI or docs.
- Storing source transcripts, redacted or not. Nothing is persisted except the saved persona itself.
- Scoring, rubrics, quote verification, progress tracking (steps 2 to 4).
- Roles or per-user permissions. The tool has no per-user accounts, so in v1 the operator's settings (including the cloud-send switch) are the access control, and each user approves their own redaction and sends. A shared team deployment with roles would be a separate project.
- Supporting transcript formats other than Teams-style text in this step (other formats may work if pasted as "Name  time / text" but are not promised).

## Anti-goals (failure even if it works)

- Any source text, redacted or not, sent to an LLM before the person approves it.
- A persona that contains a client name, a price, an email or phone number from the source.
- UI copy that implies the redaction is complete.
- Source text appearing in logs, error messages, or the database.

## Constraints

- Repo rules in `AGENTS.md` and `CLAUDE.md` bind: never commit real transcripts; audio is never stored; WebSocket protocol is unchanged; frontend has no test setup, so redaction logic that matters should live where it can be unit tested (backend, or a plain TS module with tests).
- Existing drafter safeguards stay: source text is data, not instructions; line-break collapsing; control-character stripping; drafts pass through `parseInterviewerInput`.
- Current limits: description input is 4000 chars; persona field is capped at 1500 chars and style at 600 in `INTERVIEWER_LIMITS`; interviewer routes use a 64kb body limit. These will need to change for this feature (see "Left to the builder").
- Copy of backend limits in `apps/frontend/app/lib/interviewerForm.ts` must stay in sync.
- Single-user prototype; owner-scoped data.
- Technology choices in `docs/how-it-works.md` stay fixed.

## Decisions made with the owner

- Paste-only input.
- Composites from the start: one persona from several calls.
- Redaction is local and happens before anything leaves the machine; the person reviews and approves the redacted text.
- Persona keeps behaviour, drops facts (for example "pushes back when rates exceed budget", not the figure).
- Sending the approved, redacted text to Claude's cloud API to draft the persona is acceptable, provided a confirmation screen comes first. The screen says what is about to be sent (number of calls, approximate size, that redaction is best-effort) and requires an explicit confirm. It is skipped or blocked when the operator's cloud-send switch is off.
- One counterpart (buyer) per call. A composite mixes several calls but each call contributes one buyer's lines. Multi-buyer calls are out of scope for v1: the user picks the one buyer to learn from.

## Proposed behaviour (owner to correct)

Flow, marked as the designer's proposal where not stated by the owner:

1. User opens a new "Build from calls" entry on the interviewers page.
2. For each call: paste text; the tool parses speaker labels (Teams format: speaker name and timestamp on one line, text on following lines) and lists the speakers; user picks the counterpart.
3. Redaction pass (deterministic, no LLM):
   - speaker names replaced with roles ("Buyer", "Our side 1", ...), including mentions of those names in the text;
   - a user-supplied list of client, company and product names, matched case-insensitively;
   - suggested organisation names (capitalised terms not at sentence start) shown for the user to accept or reject;
   - currency amounts, rates, percentages and large numbers replaced with placeholders such as `[AMOUNT]`;
   - emails, phone numbers and URLs removed.
4. Review screen: redacted text with changes highlighted, editable, with a clear note that redaction is best-effort. User approves each call.
5. After at least two approved calls (one is allowed with a visible note that a single call is easier to trace), the user chooses "Draft persona". Only then do the approved texts go to Claude.
6. A new draft source kind produces a composite persona that describes behaviour patterns seen across the calls. The prompt tells the model to omit names, figures and anything identifying even if they slipped through.
7. The draft opens in the existing editor flow (`?from=draft`), where the user can edit, Try it, and save.
8. Provenance: the saved interviewer may carry a short, non-identifying note such as "built from 4 calls"; whether to store this is an open choice (see below).

## UI and acceptance

The redaction review screen and the send confirmation screen are the main trust surface of this feature, so their quality is part of the safeguard. They must work by keyboard, respect `prefers-reduced-motion`, and reflow at narrow widths, in line with the repo's existing accessibility work. Before the feature is called done, the owner tries the whole flow on synthetic transcripts and confirms the highlights, the edit step and the confirmation wording are clear. Wider UI polish (a clearer practice-to-report journey, a progress view) is out of scope here and is defined after this flow exists.

## Left to the builder

- Where redaction runs (browser module vs backend endpoint) as long as nothing leaves the machine before approval and the logic is unit tested.
- Exact patterns, placeholder tokens and the highlighting UI.
- How to raise the persona and input limits (a new field vs raising `persona` cap, a separate route and body limit for transcripts), keeping old interviewers valid.
- Prompt wording for the composite drafter, following the existing MATERIAL / RULES structure in `interviewer/designer.ts`.
- How to cope with long transcripts (the conversation path already tail-keeps up to 24,000 chars; a multi-call equivalent is needed).
- Test strategy, including a mock-provider path so the flow runs keyless.
- Docs updates (`docs/interviewers.md`, `docs/getting-started.md`) and an honest "what redaction does not catch" section.

## Open choices (builder to propose, owner to confirm)

- Whether to store the "built from N calls" provenance note.
- Whether a single-call persona is allowed in v1 (the proposal above allows it with a warning).

## Designer's calls (made without the owner; owner to check)

- **Persona room.** Add a new optional interviewer field for the behaviour patterns (objections, priorities, tone), with a parse default so old interviewers and presets stay valid, and include it in the live-session prompt. Cap about 1500 chars. Keep the existing `persona` and `style` caps. Builder confirms the exact name and cap and keeps the frontend copy of the limits in sync.
- **Size limits.** At most 8 calls per composite. Each pasted call up to 24,000 chars. For each call send only the counterpart's lines plus the line before each as context, and cap the total sent to Claude at about 30,000 chars, dropping the oldest lines first. Needs its own route with a larger body limit than the current 64kb.
- **Transcript format.** Assume the standard Teams copy-paste (speaker name and timestamp on one line, text below). The parser tolerates a "(Guest)" suffix and company suffixes after the name. If no speakers are found, show an error that asks the user to check the format; do not guess. Test fixtures are synthetic only, never real transcripts.
- **Provenance.** Do not store a "built from N calls" note in v1.
- **Redaction list.** The user-supplied name list lives in page state only. It is not remembered between visits.

## Optional evaluator provider: Jev (decided with the owner; used in steps 2 to 4, not step 1)

Jev is TypeSafe's hosted model that answers typed questions about some content (Choice, Score, Noul; Box for images) and returns structured answers with probabilities and confidence. It does not generate text. Facts below come from TypeSafe's public docs pages (introduction and models), read on 2026-11-08, and are not otherwise verified.

- **Role.** An optional third provider kind, an evaluator, behind an interface like the existing STT, LLM and TTS providers. Claude keeps conversation, persona drafting and report writing. Code keeps measurement and quote checks. The evaluator judges against expert-defined criteria (step 2), checks claims (step 3) and gives a repeatable instrument for comparing sessions (step 4).
- **Off by default.** No evaluator is configured unless the operator enables it. With it off, steps 2 to 4 must still work using the existing LLM, or degrade to the non-evaluator behaviour. Enabling it sits behind the same cloud-send switch as other transcript features. A mock evaluator is needed so tests and `PROFILE=mock` run keyless.
- **What it may see.** Rehearsal transcripts only (an engineer answering a composite persona). It must never receive raw or redacted source call transcripts, and it is not used for redaction, because a hosted API would receive text before the person has approved the redaction.
- **Compliance status: not established.** The docs say Jev is not trained on customer data and mention a Data Processing Agreement and zero data retention for enterprise customers. They do not state a default retention period, regions, sub-processors or SOC 2. Before the owner enables it, they must obtain and review these, and check that their client NDAs allow a third-party AI vendor to see rehearsal transcripts. This is the owner's task and not something the tool can verify.
- **Cost.** Published price is $0.042 per million input tokens, with output tokens free, so many criteria per session should be cheap. Real numbers come from the usage log below.
- **Usage record (needed for tokenomics).** For each evaluator call, record only provider, model, feature, input tokens, output tokens (where reported) and estimated cost. Never content.
- **Builder to settle.** The provider interface shape, how a criterion maps to a question type, how low-confidence answers are shown (as "unclear", never as a verdict), and the timeout and failure behaviour (a report must still complete without it).

## Cross-cutting: controls, tokenomics, security and compliance

This section applies to all four steps. Names marked "proposed" are the designer's suggestions; the builder may rename them. It is a design for an honest compliance conversation, not a claim of certification.

### Controls and guardrails

Every control has a default, an owner of the setting, and something that enforces it. Three tiers:

| Tier | Control | Default | Enforced by |
|---|---|---|---|
| Operator (environment) | `PROFILE` (existing): `cloud` or `mock` | `cloud` | config load, exits on bad value |
| Operator | `AUTH_TOKEN` (existing): shared-token mode | unset (loopback only) | `auth.ts` on every request and upgrade |
| Operator | `RETENTION_DAYS` (existing): purge ended sessions | unset (keep) | `retention.ts` at startup |
| Operator | Cloud-send switch for transcript features (proposed) | off, so the persona-from-calls feature is unavailable until the operator turns it on | checked server-side on the draft route; the UI hides or disables the entry point but the server is the enforcement |
| Operator | Evaluator provider (proposed), for example none or Jev | none | provider factory; no network call if none |
| Operator | Usage-record retention (proposed) | follows `RETENTION_DAYS` | same purge job |
| User (in app) | Which calls and which buyer; name list; approval of each redacted call; confirmation before sending | n/a, required each time | the flow itself; the draft route refuses a request that was not marked confirmed by the client |
| Fixed in code | Size and call caps; no audio stored; no source text stored or logged; delivery numbers from code; interviewer text treated as data; model and token limits from `docs/how-it-works.md` | n/a | schema validation, tests |

Rules for adding a control: it needs a default that is the safe choice, an enforcement point on the server (not only the UI), a test, and a line in the docs. A control that a user can change must not be able to weaken one that an operator set.

Open for the builder: whether the cloud-send switch is one flag or one per feature (persona drafting, evaluator), and how a disabled feature is shown.

### Tokenomics

Goal: be able to say what a rehearsal, a report and a persona draft cost, with real numbers, without ever recording content.

- **What to record.** For every LLM and evaluator call: timestamp, feature (conversation turn, report, designer draft, persona draft, evaluator), provider, model, input tokens, output tokens, and an estimated cost computed from a price table kept in code or config. Session id where one exists. Never prompts, transcripts or responses.
- **Where the numbers come from.** Use the token counts the provider returns. Where a provider does not return them, record that they are missing and do not estimate silently. The builder must first check what the repo already logs; this design assumes nothing exists.
- **Storage.** A small table or log, owner-scoped, purged with the retention setting. Ephemeral sessions (designer, trial) have no session row; their usage is recorded without a session id.
- **Views.** At minimum a per-session total on the report or dashboard and a simple summary by feature over a period. Cost is shown as an estimate with its price-table date.
- **Budget guard (proposed).** An optional operator-set cap per session or per day. When reached, new LLM calls are refused with a clear message and a session ends cleanly. Off by default.
- **Use in the article.** The same numbers support a "what a rehearsal costs" figure. They must be measured from real runs, not estimated by hand.

### Security and compliance

Threat model in brief (builder to expand into a short `docs/` page):

| Data | Where it goes | Stored | Main risk | Mitigation |
|---|---|---|---|---|
| Source call transcripts (pasted) | Browser or backend memory; after approval, redacted text to Claude | No | Client names or prices reach a third party, or leak into logs | Local redaction, user approval, confirmation screen, cloud-send switch, no logging of content, no persistence |
| Redaction name list | Page state only | No | Sensitive list remembered | Not persisted |
| Composite persona | Database (the saved interviewer) | Yes | Persona carries identifying detail | Prompt tells the model to omit identifying detail; user reviews the draft before saving; no source text kept |
| Rehearsal audio | Speech-to-text provider | Never stored by this tool | Provider retention | Provider terms; owner to review |
| Rehearsal transcripts and reports | Database; Claude; optionally the evaluator | Yes | Third-party processing; retention | Retention setting; delete route; evaluator off by default |
| Usage records | Database | Yes (numbers only) | Low | No content; follows retention |

UK GDPR points to cover in the docs (guidance only; the owner should confirm with their own legal advisers):
- Speaker names and anything that identifies a person are personal data. Local redaction before any third-party call supports data minimisation.
- Each provider that sees data (Anthropic, ElevenLabs, and TypeSafe if enabled) is a processor; the owner needs each one's data processing agreement, processing region, sub-processors and retention terms. The tool cannot verify these.
- The delete route and `RETENTION_DAYS` support storage limitation and erasure for stored sessions; the docs must say what they do not cover (provider-side copies).
- Rehearsal participants (engineers) should be told what is recorded and sent where. The docs should include suggested wording.

Client NDAs: the tool cannot decide whether an NDA allows a third-party AI vendor to see even redacted material. The docs and the confirmation screen must say this, and the cloud-send switch lets an operator keep the feature off where it is not allowed.

Existing posture to preserve: loopback-only local mode with Host and Origin checks, optional shared token, owner-scoped queries, and no audio storage. This remains a single-user prototype with no per-user accounts, and the docs must not imply multi-user access control.

Out of scope here: certification claims (SOC 2, ISO 27001), a data protection impact assessment (the docs may recommend one), and penetration testing.

## Wider roadmap (not part of this step)

2. Quote verification: a code check that every quoted line in a report appears in a participant turn, mirroring `delivery/readingCheck.ts`.
3. Scoreless rubrics: expert-defined criteria marked observed or not observed with a verified quote, consistent with the no-scores principle in `docs/reports.md`.
4. Progress over sessions: per-interviewer trends from stored delivery summaries, then optionally model narration of what changed.
