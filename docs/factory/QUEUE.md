# Factory queue snapshot

The operational queue lives in GitHub issue labels. This file is a reviewable snapshot
written by `factory-triage` and reported by `/factory`; implementation routines query
GitHub directly.

An unmerged update to this file must never block a later routine from seeing work. Durable
run evidence lives in one file per run under `docs/factory/runs/`.

**Dispositions**

| Disposition | Next stage |
|---|---|
| `ready-to-implement` | factory-implement picks it up |
| `ready-to-spec` | human runs factory-spec |
| `needs-info` | parked, question is on the issue |
| `wait-to-implement` | parked, blocker named below |
| `awaiting-review` | PR open, human owns it |
| `done` | merged by a human |

The corresponding live labels use the `factory:` prefix, for example
`factory:ready-to-implement` and `factory:awaiting-review`. The live issue also carries a
`factory-handoff:v1` comment with the fields needed by implementation.

---

## Example entry (delete this)

## FQ-142: Expired tokens return 500 instead of 401
- disposition: ready-to-implement
- source: https://github.com/owner/repo/issues/142
- last_triaged: 2026-08-16
- repro: confirmed
- files_expected: src/auth/verify.ts, src/auth/verify.test.ts
- load_bearing: true
- gate_level: deep
- done_when: `verify.test.ts` has a case for an expired token asserting a 401 response, it fails on `main`, and it passes after the change
- confidence: high
- notes: `src/auth/**` is load-bearing, so this cannot be auto-implemented despite being simple. Route through factory-spec or implement with a forced human read.

---

---

## FQ-44 spec slices (factory-spec, 2026-11-14)

Spec: `docs/factory/specs/FQ-44/` (all four gates approved by the owner). #44 closed as superseded.

## FQ-65: FQ-44 slice 0 - session display labels and speaking state
- disposition: ready-to-implement
- source: https://github.com/mgwinthrop/interview-studio/issues/65
- files_expected: see the issue's handoff (7 frontend files)
- load_bearing: false
- gate_level: full
- confidence: high

## FQ-66: FQ-44 slice 1 - optional interviewer displayName in the backend
- disposition: ready-to-implement (interactive only)
- source: https://github.com/mgwinthrop/interview-studio/issues/66
- load_bearing: true (`apps/backend/src/interviewer/schema.ts`)
- gate_level: deep
- confidence: medium
- notes: one approved edit to an existing test (INTERVIEWER_LIMITS assertion); draft PR, human read

## FQ-67: FQ-44 slice 2 - displayName in the editor and draft hand-off
- disposition: wait-to-implement
- blocker: #66 merged
- source: https://github.com/mgwinthrop/interview-studio/issues/67

## FQ-68: FQ-44 slice 3 - display names for the presets and designer
- disposition: wait-to-implement
- blocker: #66 merged
- source: https://github.com/mgwinthrop/interview-studio/issues/68
