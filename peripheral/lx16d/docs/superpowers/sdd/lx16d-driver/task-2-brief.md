# Task 2: Serialized response transactions

Read `docs/superpowers/specs/2026-09-02-lx16d-driver-design.md` first. Implement only Task 2 from `docs/superpowers/plans/2026-09-02-lx16d-driver.md`; Task 1 codec is complete and must be reused.

## Scope

Modify only `src/lx16d.ts`, `test/lx16d.test.ts`, and create `docs/superpowers/sdd/lx16d-driver/task-2-report.md`. Do not implement the servo facade or edit `src/index.ts`.

## Requirements

- Define structural `Lx16dSerial` compatible with Jaculus `serial.Serial`: `write(Uint8Array): void`, `flush(): void`, and `get(): Promise<Uint8Array>`.
- Define `Lx16dBusOptions`: `timeoutMs` and `retries` with safe defaults, and optional synchronous or async `beforeTransmit`/`beforeReceive` hooks.
- Implement `Lx16dBus` constructor with an already configured port. It must never call `setup()` or `close()`.
- Expose `send(id, command, payload?)` for no-response requests and `transact(id, command, expectedPayloadLength, payload?)` returning the response payload.
- `send` invokes transmit hook, writes `encodeFrame`, flushes, then invokes receive hook. `transact` serializes all operations in call order, rejects broadcast ID `0xfe`, writes/flushed as above, reads one byte at a time with `get`, waits for `55 55`, receives the declared body exactly, decodes it, validates ID, command, and exact expected payload length.
- A request has `retries + 1` total attempts. Retries apply to receive timeout/frame validation failures. Preserve structured `Lx16dError` kinds `timeout`, `responseId`, `responseCommand`, `responseLength` in addition to Task 1 kinds.
- A timeout must not leave an unhandled rejected promise when `get()` resolves later.
- The parser must tolerate leading noise and preserve the final `0x55` encountered before the next byte.

## Tests

Write tests first with a fake port. Cover valid transaction, write frame, mismatch ID, mismatch command, invalid checksum, timeout, one retry that succeeds, hook ordering, broadcast rejection, leading noise, and two concurrently invoked transactions written in call order. Tests must prove real bus behavior, not merely mock call counts.

## Constraints

- Do not alter Task 1 public codec API except only where strictly required for the bus; preserve its tests.
- Do not modify the servo facade, demo, plan, spec, or research note.
- Do not dispatch agents and do not commit.

## Report

Write `docs/superpowers/sdd/lx16d-driver/task-2-report.md` with changed files, TDD red command/output before bus implementation, passing validation output/count, and concerns. Return only status, one-line summary, and validation commands.