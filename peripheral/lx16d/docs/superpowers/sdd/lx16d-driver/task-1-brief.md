# Task 1: Test harness and frame codec

Read `docs/superpowers/specs/2026-09-02-lx16d-driver-design.md` first. You are implementing only Task 1 from `docs/superpowers/plans/2026-09-02-lx16d-driver.md`.

## Scope

Modify `package.json`, create `test/lx16d.test.ts`, and implement only the pure protocol codec portions of `src/lx16d.ts`. Do not implement `Lx16dBus`, serial IO, `Lx16dServo`, or alter `src/index.ts`.

## Requirements

- Add minimal compatible test support, preferably `tsx`, and scripts `test` and `typecheck`.
- Production type checking must remain scoped to `src/`, since Jaculus types do not include Node test types.
- Export an `Lx16dCommand` numeric enum/constant map with upstream commands 1–36 as needed by later implementation.
- Export `Lx16dError` containing a specific error kind.
- Export `encodeFrame(id, command, payload?)` and `decodeFrame(bytes)`.
- Frame format is `55 55 ID LENGTH CMD payload checksum`; `length = payload.length + 3`; checksum is `(~sum(ID through payload)) & 0xff`.
- Validate full frame header, declared length, and checksum. Use little-endian codec helpers internally.
- Test encoding frame `55 55 01 07 01 f4 01 e8 03 16` and rejecting an invalid checksum.
- Add focused tests for declared-length validation and signed/unsigned little-endian behavior if helpers are public; otherwise cover them through frame behavior.
- Follow TDD: write tests first, run them and observe the expected missing-export failure, then implement minimally and run the focused suite plus `npm run typecheck`.

## Constraints

- Do not modify the design, plan, research note, or demo.
- Do not commit (the project is not a Git worktree).
- Do not dispatch subagents.

## Report

Write a full report to `docs/superpowers/sdd/lx16d-driver/task-1-report.md`: files changed, failing-test command/output before implementation, passing commands/output, test count, and any concern. Return only status (`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`), a one-line summary, and the exact validation commands.