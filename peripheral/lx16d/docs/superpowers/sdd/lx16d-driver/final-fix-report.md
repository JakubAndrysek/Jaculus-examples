# LX-16D final review fixes

## Architecture changed

`Lx16dBus` now owns one persistent serial-reader pump. The pump is the only code path that calls `Serial.get()`, queues one-byte reads, and wakes the active transaction byte waiter. A waiter timeout abandons only that waiter; it never starts another `get()`. Consequently, at most one non-cancellable Jaculus `get()` remains outstanding while the existing transaction queue still permits only one request/response operation at a time.

Each response attempt has one overall frame deadline. The parser checks the declared `LENGTH` as soon as it arrives against the command's expected payload length, rather than waiting for that declared number of bytes. Per-wait timers are cleared on byte delivery and reader failure.

`Lx16dError` now includes request `id`, `command`, and optional raw `received` bytes. Errors from `write`, `flush`, `get`, and direction hooks are normalized to `kind: "transport"`; protocol failures retain their specific kinds and gain transaction context.

The servo facade now reads `OrMotorModeRead` as a four-byte payload and decodes motor speed as signed 16-bit little-endian at offset two. It also exposes `readTemperatureLimit()` through `TempMaxLimitRead`.

## Test coverage added or strengthened

- motor speed `-300`, outside signed I8, and four-byte mode payloads;
- `TempMaxLimitRead` mapping;
- late-byte timeout/retry handling with one active `get()` maximum;
- immediate retry after an oversized declared length;
- transport rejection normalization and request context;
- response-gated concurrent request serialization;
- contextual response ID failure including raw received-frame bytes.

## Validation

Command run:

```sh
npm test && npm run typecheck
```

Exact output:

```text
npm warn Unknown user config "min-release-age". This will stop working in the next major version of npm.

> template-jaculus@0.1.0 test
> tsx --test test/**/*.test.ts

✔ encodes a move frame with the LX-16 checksum (1.206791ms)
✔ decodes a complete frame into its protocol fields (0.12775ms)
✔ rejects a frame with an invalid checksum (0.231333ms)
✔ rejects a frame whose declared length differs from its byte count (0.064584ms)
✔ rejects frames without exactly two header bytes (0.0755ms)
✔ rejects a header-valid truncated frame as a length error (0.055708ms)
✔ reads an unsigned 16-bit little-endian value (0.068334ms)
✔ reads a signed 16-bit little-endian value (0.050667ms)
✔ writes an unsigned 16-bit little-endian value (0.066208ms)
✔ writes a signed 16-bit little-endian value (0.096125ms)
✔ returns a matched response payload after writing the request frame (0.670084ms)
✔ sends a no-response request without reading (0.106625ms)
✔ rejects a response with a different servo ID (0.313958ms)
✔ rejects a response with a different command (0.209875ms)
✔ rejects a response with an invalid checksum (0.167458ms)
✔ rejects a response whose payload length differs from the request (0.163708ms)
✔ rejects when a response byte does not arrive before the timeout (4.360333ms)
✔ delivers a retry response after a timeout without competing serial reads (25.389625ms)
✔ retries immediately after an oversized declared response length (0.3065ms)
✔ normalizes rejected transport reads with request context (0.197416ms)
✔ orders direction hooks around transmission and response receipt (0.1455ms)
✔ awaits asynchronous direction hooks around a send (0.070083ms)
✔ rejects broadcast transactions (0.0535ms)
✔ ignores leading noise while preserving the final header byte (0.1175ms)
✔ does not write a concurrent transaction before the first response settles (0.962958ms)
✔ changes the cached servo ID only after a successful ID write (0.167959ms)
✔ maps movement commands and decodes signed position telemetry (0.412291ms)
✔ round-trips angle and voltage limits and maps sensor reads (1.07975ms)
✔ maps motor mode, torque, and LED commands (0.363041ms)
✔ validates facade IDs and numeric bounds (0.616292ms)
✔ reads the servo ID from its matched response (0.174875ms)
✔ decodes servo mode and rejects an unknown mode response (0.187125ms)
✔ emits exact payloads for configuration, mode, torque, and LED writes (0.178542ms)
ℹ tests 33
ℹ suites 0
ℹ pass 33
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 253.958083
npm warn Unknown user config "min-release-age". This will stop working in the next major version of npm.

> template-jaculus@0.1.0 typecheck
> find src -type f -name '*.ts' -print0 | xargs -0 tsc --noEmit --target es2023 --module nodenext --lib es2023 --moduleResolution nodenext --types jaculus --rootDir src
```

Result: 33 tests passed, 0 failed; production typecheck exited successfully. The npm warning comes from the local user configuration and does not affect the test or typecheck result.

## Remaining caveat

Jaculus cannot cancel an already-issued `Serial.get()`, so the bus deliberately retains one pending reader between transactions. A reply that arrives after its request has timed out is still physically indistinguishable from a valid reply to an identical retry; the driver prevents competing reads from stealing bytes, but cannot infer request identity absent a protocol sequence number. Hardware timing and retry policy should therefore avoid issuing identical reads where an old servo reply could remain in flight.
