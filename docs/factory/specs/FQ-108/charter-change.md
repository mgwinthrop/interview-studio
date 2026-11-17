# FQ-108 charter change (owner to apply)

Approved by the owner on 2026-11-17 ("apply now"). The agent's edit was refused by the
session's permission settings, so the owner applies it by hand.

## 1. `docs/factory/CHARTER.md`, section 2 `LOAD_BEARING`

Insert after the line `  - "apps/frontend/hooks/useVAD.ts"`:

```yaml
  # FQ-108 (owner, 2026-11-17): the client session rebuild's core decides every session state
  # change; the session history is a privacy surface (must never record words); the mic and
  # socket adapters are the hardware and protocol boundaries once code moves into them.
  - "apps/frontend/app/session/core/**"
  - "apps/frontend/app/session/history/**"
  - "apps/frontend/app/session/adapters/mic*"
  - "apps/frontend/app/session/adapters/socket*"
```

These paths do not exist yet. Gate 3 (`03-design.md`) builds to them.

**Deliberately not added now:** `apps/frontend/app/hooks/useWebSocket.ts`.
- Adding it would turn #110 (already `ready-to-implement`, triaged `load_bearing: false`)
  into load-bearing work mid-queue, and the implement skill would send it back to spec.
- The frame encoding becomes protected when it moves into `adapters/socket*` in phase 3.

## 2. `docs/factory/DECISIONS.md`, a new entry at the top (draft for the owner)

```markdown
### 2026-11-17 - Session core, session history and session adapters are load-bearing

**Change:** LOAD_BEARING gains `apps/frontend/app/session/core/**`,
`apps/frontend/app/session/history/**`, `apps/frontend/app/session/adapters/mic*` and
`apps/frontend/app/session/adapters/socket*` (FQ-108 gate 2).

**Evidence:** 8 factory items and 4 follow-up fixes landed in the client session runtime in
about four days (FQ-40 to FQ-98, #86, #107, #110), all traced to state that was spread out
and kept in step after the fact (`docs/factory/specs/FQ-108/evidence/state-inventory.md`
section 6). The rebuild moves every session decision into one pure core; a wrong transition
there is a wrong session. The history must never record words (privacy).

**Risk accepted:** Every later change to session behaviour, including #48 and #49, is a
`deep` slice with a human read. Throughput in this area is capped by owner review time
(about 9 to 11 deep slices for the rebuild itself).

**Revisit if:** after the rebuild, 10 consecutive core changes pass deep gates and
verification with no escaped defect. Then consider `full` gates for core changes that add a
region transition with an exhaustive table test.
```

## 3. Addition approved 2026-11-17 (gate 3): protect the test-seam check

Insert in `LOAD_BEARING` after `  - "apps/frontend/app/session/runtime/**"`:

```yaml
  # FQ-108 gate 3: fails every normal frontend build that contains the e2e-only speech seam.
  - "apps/frontend/scripts/check-no-test-seams.mjs"
```

The `build` line in `apps/frontend/package.json` that calls it stays unprotected on purpose:
dependency bumps touch that file. An edit to that line is caught by the verifier's scope
check and the owner's PR read.
