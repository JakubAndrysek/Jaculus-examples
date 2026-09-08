# Task 4: Jaculus demo and documentation

Read `docs/superpowers/specs/2026-09-02-lx16d-driver-design.md` first. Complete only Task 4 of `docs/superpowers/plans/2026-09-02-lx16d-driver.md`.

## Scope

Modify `src/index.ts`, `docs/research/lx16d-protocol.md`, `test/lx16d.test.ts` only if a compile-time public-API usage test is useful, and create `docs/superpowers/sdd/lx16d-driver/task-4-report.md`. Do not alter driver behavior unless compilation reveals a public API defect.

## Demo requirements

- Remove the LED blink implementation.
- Import `serial` and `Lx16dBus`.
- Make `SERVO_TX_PIN`, `SERVO_RX_PIN`, and `SERVO_ID` clearly configurable top-level constants. Use valid but visibly example pin values and label them with comments as board-specific.
- Application code—not the driver—must call `serial.Serial1.setup` with 115200 baud, `DataBits.Eight`, `Parity.None`, and `StopBits.One`.
- Construct `new Lx16dBus(serial.Serial1, { timeoutMs: 50, retries: 3 })`; call `bus.servo(SERVO_ID)`; move to position 500 in 750 ms; then read and log position, temperature, and voltage.
- Include one concise comment saying a single-wire/tri-state half-duplex circuit may require `beforeTransmit` and `beforeReceive` hooks for direction switching.
- Avoid loops that flood a physical bus and do not call `serial.close()`.

## Documentation requirements

- Add a short "Jaculus usage" section to `docs/research/lx16d-protocol.md` showing the same setup ownership rule and bus construction.
- State precisely that compatibility evidence is LX-16A protocol evidence and individual LX-16D commands must be hardware verified.

## Tests and validation

Add/keep a compilation-facing usage test only if it adds value; the required validation is `npm test && npm run typecheck`. Confirm `src/index.ts` typechecks using available Jaculus declarations.

## Constraints

- Do not dispatch agents or commit.
- Do not change configured serial port ownership: `Lx16dBus` never calls `setup`/`close`.

## Report

Write the full report to `docs/superpowers/sdd/lx16d-driver/task-4-report.md`, including changed files, validation output/count, and any hardware caveat. Return only status, summary, and validation commands.