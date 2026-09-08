# Task 3 report: Full domain servo API

## Files changed

- `src/lx16d.ts`
  - Added `Lx16dBus.servo(id)` and the `Lx16dServo` facade.
  - Added the public result types `Lx16dMovement`, `Lx16dAngleLimits`, `Lx16dVoltageLimits`, and `Lx16dMotorMode`.
  - Added facade validation, protocol payload encoding, typed response decoding, and `responsePayload` errors for invalid mode responses.
- `test/lx16d.test.ts`
  - Extended the fake serial transport to simulate failed writes.
  - Added real-behavior facade tests for ID updates, movement, signed position telemetry, angle and voltage limits, offset and telemetry commands, motor mode, torque and LED mappings, and facade validation.
- `docs/superpowers/sdd/lx16d-driver/task-3-report.md`
  - This report.

No other files were modified.

## Test-first evidence

### Red command

```sh
npm test -- test/lx16d.test.ts
```

### Red output

Exited with status `1` after adding the facade tests before the facade implementation:

```text
✖ changes the cached servo ID only after a successful ID write
✖ maps movement commands and decodes signed position telemetry
✖ round-trips angle and voltage limits and maps sensor reads
✖ maps motor mode, torque, and LED commands
✖ validates facade IDs and numeric bounds
TypeError: (intermediate value).servo is not a function
```

Result: `28` tests total, `23` passed, `5` failed. The failures were due to the missing `Lx16dBus.servo()`/facade API.

## Final validation

### Command

```sh
npm test && npm run typecheck
```

### Output and count

```text
✔ tests 28
✔ pass 28
✔ fail 0
✔ typecheck exited successfully
```

The command completed with exit status `0`. npm emitted its pre-existing configuration warning: `Unknown user config "min-release-age"`.

## Public API implemented

- `Lx16dBus.servo(id)`
- `Lx16dServo.id`
- Movement: `moveTo`, `readMove`, `queueMove`, `readQueuedMove`, `start`, `stop`
- Identity and configuration: `setId`, `readId`, `adjustOffset`, `saveOffset`, `readOffset`, `setAngleLimits`, `readAngleLimits`, `setVoltageLimits`, `readVoltageLimits`, `setTemperatureLimit`
- Telemetry: `readTemperature`, `readVoltage`, `readPosition`
- Mode: `setServoMode`, `setMotorMode`, `readMode`
- Torque and LEDs: `setTorque`, `readTorque`, `setLed`, `readLed`, `setLedErrorMask`, `readLedErrorMask`
- Result types: `Lx16dMovement`, `Lx16dAngleLimits`, `Lx16dVoltageLimits`, `Lx16dMotorMode`

## Concerns

- The task brief explicitly requires a three-byte `OrMotorModeRead` payload (`mode`, reserved byte, signed speed), despite the local research note describing the upstream protocol response as a four-byte payload containing a signed 16-bit speed. The implementation follows the task brief: it requests exactly three response bytes and decodes the final byte as signed.
- `setMotorMode(speed)` continues to encode its specified signed 16-bit `-1000..1000` write value.
- No on-device verification was performed; LX-16D compatibility remains a hardware validation item.

## Review-finding follow-up

### Files changed

- `test/lx16d.test.ts`
  - Added behavioral coverage for `readId()`, servo mode decoding, and invalid mode responses (`Lx16dError` kind `responsePayload`).
  - Expanded parameterized validation coverage for facade IDs, broadcast rejection, position, duration, u16 angle and voltage limits, i8 offset, byte temperature and LED-error values, and motor-speed endpoints.
  - Added exact emitted-frame assertions for `saveOffset`, temperature limit, servo/motor modes, both torque values, both LED values, and LED-error masks.
- `docs/superpowers/sdd/lx16d-driver/task-3-report.md`
  - Appended this review-follow-up evidence.

No implementation defect was discovered; `src/lx16d.ts` was not modified during this follow-up.

### Validation command

```sh
npm test && npm run typecheck
```

### Validation output

```text
✔ tests 31
✔ pass 31
✔ fail 0
✔ typecheck exited successfully
```

The command completed with exit status `0`. npm again emitted the environment warning: `Unknown user config "min-release-age"`.

## Scoped re-review: emitted write frames

### Files changed

- `test/lx16d.test.ts`
  - Extended the movement-command assertion to include the exact `MoveStop` frame from `stop()`.
  - Extended the write-payload assertion with exact frames for `adjustOffset(-2)` (`0xfe` signed i8), `setAngleLimits({ minimum: 1, maximum: 1000 })`, and `setVoltageLimits({ minimumMv: 5000, maximumMv: 6000 })`.
- `docs/superpowers/sdd/lx16d-driver/task-3-report.md`
  - Appended this scoped re-review evidence.

No production files were modified.

### Validation command

```sh
npm test && npm run typecheck
```

### Validation output

```text
✔ tests 31
✔ pass 31
✔ fail 0
✔ typecheck exited successfully
```

The command completed with exit status `0`. npm emitted the environment warning: `Unknown user config "min-release-age"`.
