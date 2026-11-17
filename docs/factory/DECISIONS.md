# Factory decisions

Why the factory is configured the way it is. Written by a human, informed by
`/factory-tune`.

This file exists so a future tuning pass can tell whether a past loosening was a mistake.
Without it, every constraint review starts from scratch and the same argument gets had
twice a year.

Newest at the top.

---

## Template

### 2026-08-16 - <what changed>

**Change:** <the specific rule, before and after>

**Evidence:** <the run of data. "23 dependency bumps over 6 weeks, zero escapes" is
evidence. "It seemed fine" is not.>

**Risk accepted:** <what this makes more likely, stated plainly>

**Revisit if:** <the observation that would reverse this>

---

## Seed entries

### 2026-08-16 - Merge is never automated, on any tier

**Change:** No routine or session may merge, on any tier including `revival`. Enforced by a
GitHub ruleset or branch protection. Harness hooks block common shell routes as a second
layer.

**Evidence:** Structural rather than empirical. The merge decision is where accountability
lives, and it is the one point where a human takes responsibility for consequences.

**Risk accepted:** Throughput is capped by human review availability. This is intentional.
The binding constraint on a factory is decisions pending judgment, not agents running.

**Revisit if:** Never, at any tier.

---

### 2026-08-16 - Verification is a separate agent from implementation

**Change:** `factory-implement` must delegate to the `factory-verifier` subagent and may
not self-certify.

**Evidence:** An agent asked to check its own work grades the intent it already had. The
separation is the only thing that makes a green result mean anything.

**Risk accepted:** Roughly doubles token cost per item. Worth it.

**Revisit if:** Never. Tune the verifier's strictness instead.

---

### 2026-08-16 - Unattended runs may not modify existing test files

**Change:** An unattended run stops before modifying a pre-existing test file. An
interactive session requires explicit human approval, stays draft, and receives a human
read regardless of gate status.

**Evidence:** Agents can rewrite assertions to match broken behavior. An unexplained green
suite after the implementation agent changed the tests is weak evidence and can be
invisible to ordinary automated checks because everything passes.

**Risk accepted:** Legitimate test refactors need a human. Acceptable.

**Revisit if:** Never, while the gates depend on the tests being trustworthy.

### 2026-11-17 - Session core, runtime, history and adapters are load-bearing

**Change:** LOAD_BEARING gains `apps/frontend/app/session/core/**`,
`apps/frontend/app/session/runtime/**`, `apps/frontend/app/session/history/**`,
`apps/frontend/app/session/adapters/mic*` and `apps/frontend/app/session/adapters/socket*`
(FQ-108 gate 2; runtime added from gate 3 §8 Q3).

**Evidence:** 8 factory items and 4 follow-up fixes landed in the client session runtime in
about four days (FQ-40 to FQ-98, #86, #107, #110), all traced to state that was spread out
and kept in step after the fact (`docs/factory/specs/FQ-108/evidence/state-inventory.md`
section 6). The rebuild moves every session decision into one pure core; a wrong transition
there is a wrong session. The history must never record words (privacy). The runtime store executes every command, and its ordering guarantees (synchronous run, FIFO) are what fixed FQ-47 and FQ-98.

**Risk accepted:** Every later change to session behaviour, including #48 and #49, is a
`deep` slice with a human read. Throughput in this area is capped by owner review time
(about 11 to 13 deep slices for the rebuild itself, including about two for the runtime store). Gate 3 estimates the runtime adds about two deep slices.

**Revisit if:** after the rebuild, 10 consecutive core changes pass deep gates and
verification with no escaped defect. Then consider `full` gates for core changes that add a
region transition with an exhaustive table test.
