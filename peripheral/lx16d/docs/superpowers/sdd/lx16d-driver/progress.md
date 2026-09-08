# SDD ledger — plan: docs/superpowers/plans/2026-09-02-lx16d-driver.md

## Environment

Ruling: Execute in the current directory — `servo` has no `.git` directory, so no isolated Git worktree or commit-based review range is available — cost if wrong: changes are made directly in the supplied project tree.

## Pre-flight interface scan

| Tasks / interface | Producer → consumer | Finding |
|---|---|---|
| 1 → 2 | Frame codec and `Lx16dError` → bus transactions | Consistent; Task 2 consumes the named exports from Task 1. |
| 2 → 3 | `Lx16dBus` / raw transactions → `Lx16dServo` facade | Consistent; facade maps domain values through bus methods. |
| 3 → 4 | public `Lx16dBus` / `Lx16dServo` API → Jaculus demo | Consistent; demo configures UART outside the driver. |
| Task 1 | test runtime, codec, and codec tests | The test file imports Node built-ins; `tsx` must supply Node types or the project type-check must exclude `test/`. |
| Task 2 | transaction test fake vs. serial interface | Consistent; structural `write`/`flush`/`get` interface permits a fake. |
| Task 3 | command-family coverage vs. implementation | Consistent; exact methods are specified in the plan. |
| Task 4 | demo / Jaculus compile configuration | Potential type conflict: `tsconfig.json` specifies only `jaculus` types, so `test/` must not be part of production `tsc --noEmit`. |

Ruling: Keep production `tsconfig.json` limited to `src/` and run `tsx --test` for tests — this keeps Jaculus production types separate from Node test types — cost if wrong: a separate test type-check may be needed later.

Task 1: fix round 1/5 (all findings addressed; no Git commits available in this project).
Task 1: complete (review clean; no Git commits available in this project).
Task 2: minor (deferred): per-byte timer cleanup, explicit late-settlement test, and stricter response-gated concurrency test.
Task 2: complete (review acceptable; no Git commits available in this project).
Task 3: fix round 1/5 (invalid-mode and validation coverage addressed; partial command-mapping coverage remained).
Task 3: fix round 2/5 (remaining command-mapping coverage addressed).
Task 3: complete (review clean; no Git commits available in this project).
Task 4: fix round 1/5 (documentation scope and demo error reporting addressed).
Task 4: complete (review clean; no Git commits available in this project).

Ruling: Replace per-call `Serial.get()` timeout races with a persistent single-reader pump — Jaculus does not support cancelling `get()`, so retries must not create a second reader — cost if wrong: a late protocol reply without correlation can still be indistinguishable from a reply to a retry, a protocol limitation recorded in the final fix report.
Ruling: Interpret `OrMotorModeRead` as four payload bytes (`mode`, reserved, signed I16 speed) — authoritative upstream protocol documentation and write-command symmetry override the earlier three-byte plan text — cost if wrong: incompatible hardware may use a variant framing that needs an adapter change.
Task final fix: complete (final review clean; no Git commits available in this project).
