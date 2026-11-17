# Factory charter

**This file is the human judgment, upstream.** Every factory skill reads it before acting.
It is the primary policy file a human must review, and an agent must never edit it on its
own initiative.

> **Approved 2026-11-14.** Claude proposed these values during setup from the repository's
> CLAUDE.md, AGENTS.md, CI and code. The owner chose the tier and kept `useVAD.ts`
> load-bearing, then instructed Claude to mark the charter ready and merge the install.

Fill it in once per repo. Revisit it deliberately (see "Constraint review" at the bottom),
not continuously.

Set this to `ready` only after reviewing every section:

```
CHARTER_STATUS: ready
```

---

## 1. Tier

| Tier | Means | Autonomy |
|---|---|---|
| `revival` | Unlaunched, no users, no revenue. Migration and resurrection work. | Widest. Long runs, wide fan-out, human reads samples not diffs. |
| `greenfield` | Personal project, users not yet depending on it. | Wide. Gates carry it; human samples. |
| `oss` | Published, other people depend on it, contributions arrive. | Moderate. Agent ranks attention, human owns every merge. |
| `client-production` | Someone else's business depends on this. | Narrow. Short loops, no unattended merges, everything read. |

Proposed: `greenfield`. The repository is public and MIT-licensed, but it is a single-user,
self-hosted prototype with no hosted service and no known dependants. Move to `oss` once
other people run it or send contributions.

```
TIER: greenfield
```

**Why the tier and not the difficulty:** autonomy tracks who gets hurt when it is wrong.

---

## 2. Load-bearing paths

Globs that no routine may modify unattended, regardless of tier. A change touching any of
these is forced to `deep` gates and a human read, and may never be auto-merged.

Proposed additions cover the contracts CLAUDE.md and AGENTS.md already call stable: auth,
the database, the WebSocket protocol, never storing audio, delivery numbers from code,
prompt construction, redaction, and the locked voice-detection thresholds.

```
LOAD_BEARING:
  - "apps/backend/src/auth.ts"
  - "apps/backend/prisma/**"
  - "**/migrations/**"
  - "**/*.sql"
  - "apps/backend/src/persistence.ts"
  - "apps/backend/src/wsMessages.ts"
  - "apps/backend/src/wsServer.ts"
  - "docs/websocket-protocol.md"
  - "apps/backend/src/delivery/**"
  - "apps/backend/src/interviewer/prompt.ts"
  - "apps/backend/src/interviewer/schema.ts"
  - "apps/backend/src/redaction/**"
  - "apps/backend/src/callsRoutes.ts"
  - "apps/backend/src/providers/**"
  - "apps/frontend/hooks/useVAD.ts"
  # FQ-108 (owner, 2026-11-17): the client session rebuild's core decides every session state
  # change; the session history is a privacy surface (must never record words); the mic and
  # socket adapters are the hardware and protocol boundaries once code moves into them.
  # The runtime store holds the ordering guarantees (synchronous run, FIFO) that fixed FQ-47 and FQ-98.
  - "apps/frontend/app/session/core/**"
  - "apps/frontend/app/session/history/**"
  - "apps/frontend/app/session/adapters/mic*"
  - "apps/frontend/app/session/adapters/socket*"
  - "apps/frontend/app/session/runtime/**"
  - "package.json"
  - ".github/workflows/**"
  - ".factory/**"
  - ".claude/**"
  - ".agents/**"
  - ".codex/**"
  - "AGENTS.md"
  - "CLAUDE.md"
```

`.claude/**` is on the list on purpose. An agent that can rewrite the factory's own rules
has no constraints at all. The root `package.json` is listed because it wires the gates.

---

## 3. Test-file rule

```
TESTS_ARE_LOAD_BEARING: true
```

When true, an unattended run may not modify an existing test file. An interactive session
may do so only after explicit human approval, and the resulting draft PR requires a human
read even when every gate is green. Agents routinely rewrite assertions to match broken
behavior, so an unexplained green suite after an agent edited the tests is weak evidence.

Adding a *new* test file is not covered by this rule.

---

## 4. What is automatable here

The triage skill uses this to decide `ready-to-implement` versus `ready-to-spec`.
Be specific. Vague entries produce vague triage.

```
AUTOMATABLE:
  - Dependency patch and minor bumps that pass full gates
  - Lint, format, and type-only fixes
  - Documentation and comment corrections
  - Test coverage added to existing untested functions
  - Single-file bug fixes with a reproducible failing test
  - Frontend copy and label changes that alter no behaviour, in one or two components
  - Replacing hard-coded colours in one component with the existing --studio-* tokens in app/globals.css, with no visual change intended

NEEDS_SPEC:
  - Anything adding a user-visible feature or changing an existing interaction
  - Anything changing the WebSocket protocol, a REST route, the database schema, or an exported type
  - Anything touching more than 5 files
  - Anything touching a load-bearing path

NEVER_AUTOMATE:
  - Merge decisions
  - Architectural direction and dependency choices
  - Product intent: whether a feature should exist at all
  - Anything that would store audio or send new data to a third-party provider
  - Anything the charter does not cover (default deny)
```

The last line matters. Silence in this file means stop, not proceed.

---

## 5. Definition of done

An item may only move to `verified` when all of these hold. The verify skill checks each
one independently and does not accept the implementer's word on any of them.

```
DONE:
  - gates.sh reports FACTORY_GATES status=GREEN at the required level
  - The change is covered by a test that fails without it
  - No existing test file was modified, or an interactive human explicitly approved it
    and the draft PR is flagged for human read
  - The diff does the one thing the queue item describes and nothing else
  - A human can read the PR body and understand why this is safe
  - Any user-visible change includes before and after screenshots or a description of
    the states checked at /avatar or with PROFILE=mock
```

---

## 6. Gate level by change type

```
GATES:
  default: full
  load_bearing: deep
  docs_only: fast
```

---

## 7. Stop conditions

The factory halts and asks for a human when any of these is true.

```
STOP_IF:
  - Gates were red twice in a row on the same item
  - The fix requires touching a load-bearing path
  - The change would exceed 400 changed lines
  - The queue item is ambiguous after one clarification attempt
  - More than 3 items are already awaiting human review
```

The last one is the orchestration-tax limit. When the review queue is full, stop producing.

---

## 8. Constraint review

- **Loosen** when a class of change has been green across a long enough run, and record
  the run of evidence in `docs/factory/DECISIONS.md`.
- **Tighten** immediately when an escaped defect traces back to an automated gate you
  trusted. Record what the gate missed.

```
LAST_REVIEWED: 2026-11-14
NEXT_REVIEW: 2026-12-14
```
