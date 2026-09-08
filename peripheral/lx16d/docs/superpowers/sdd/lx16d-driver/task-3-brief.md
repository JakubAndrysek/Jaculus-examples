# Task 3: Full domain servo API

Read `docs/superpowers/specs/2026-09-02-lx16d-driver-design.md` first. Implement only Task 3 from `docs/superpowers/plans/2026-09-02-lx16d-driver.md`, on the completed codec and `Lx16dBus`.

## Scope

Modify only `src/lx16d.ts`, `test/lx16d.test.ts`, and create `docs/superpowers/sdd/lx16d-driver/task-3-report.md`. Do not edit `src/index.ts` or documentation.

## API

Add `Lx16dBus.servo(id): Lx16dServo`, and export `Lx16dServo` with mutable public readonly-by-convention `id` observable property. `setId(newId)` must issue an `IdWrite` from the old ID and update `id` only after `send` succeeds.

Add complete operations, using `send` for write commands and `transact` with exact response lengths for reads:

- `moveTo(position, { durationMs? })`, `readMove()`, `queueMove(position, { durationMs? })`, `readQueuedMove()`, `start()`, `stop()`;
- `setId`, `readId`, `adjustOffset`, `saveOffset`, `readOffset`, `setAngleLimits`, `readAngleLimits`, `setVoltageLimits`, `readVoltageLimits`, `setTemperatureLimit`;
- `readTemperature`, `readVoltage`, `readPosition`;
- `setServoMode`, `setMotorMode(speed)`, `readMode`;
- `setTorque(enabled)`, `readTorque`, `setLed(enabled)`, `readLed`, `setLedErrorMask(mask)`, `readLedErrorMask`.

Expose small descriptive interfaces: `Lx16dMovement { position: number; durationMs: number }`, `Lx16dAngleLimits { minimum: number; maximum: number }`, `Lx16dVoltageLimits { minimumMv: number; maximumMv: number }`, and `Lx16dMotorMode` as a discriminated union `{ kind: "servo" } | { kind: "motor"; speed: number }`.

## Validation

- Servo ID: integer `0..254` (including broadcast in raw codec only; `bus.servo(0xfe)` must reject).
- Position, angle limits, movement duration, voltage limits: unsigned 16-bit values; position specifically `0..1000`; duration `0..30000`.
- Offset: signed 8-bit; temperature limit and LED error mask: unsigned byte; motor speed: signed 16-bit restricted to `-1000..1000`.
- Preserve signed position and motor-speed decoding.
- The `OrMotorModeRead` payload is three bytes: `mode`, reserved byte, signed speed; mode `0` is servo, mode `1` is motor and other values reject with `Lx16dError` kind `responsePayload`.

## Test-first requirements

Before implementation, add and run failing real-behavior tests for `setId` behavior, signed `readPosition`, a movement payload, an angle-limit round trip, motor mode decode, torque and LED mapping, and validation bounds. Extend the fake port as needed. Then implement minimally and run the full suite and typecheck.

## Constraints

- Do not modify existing bus semantics except when needed for facade integration.
- Do not implement the demo or modify docs.
- Do not dispatch subagents and do not commit.

## Report

Write `docs/superpowers/sdd/lx16d-driver/task-3-report.md`: files changed, red test command/output, final command/output/count, public methods implemented, and concerns. Return only status, summary, and exact validation commands.