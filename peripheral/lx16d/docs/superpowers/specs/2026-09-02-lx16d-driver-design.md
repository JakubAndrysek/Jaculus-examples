# LX-16D TypeScript driver design

## Purpose

Provide a configurable, type-safe driver for LX-16D bus servos in this Jaculus TypeScript project. The driver implements the LX-16A-compatible serial protocol documented in `docs/research/lx16d-protocol.md`; hardware compatibility of each command with LX-16D remains an on-device verification concern.

## Scope

The module is `src/lx16d.ts`. It exposes a protocol bus and a servo facade for all commands provided by the upstream implementation:

- immediate and queued movement, reading planned movement, start, and stop;
- servo ID, angle offset, angle limits, voltage limits, and temperature limits;
- temperature, voltage, and position telemetry;
- servo/motor mode and motor speed;
- torque/load control; and
- LED state and LED error mask.

`src/index.ts` becomes a small executable example that configures `serial.Serial1`, creates a bus and servo, commands a movement, and logs telemetry.

## API boundary

The application owns UART configuration and lifecycle:

```ts
serial.Serial1.setup({
  tx: 17,
  rx: 18,
  baudRate: 115_200,
  dataBits: serial.DataBits.Eight,
  parity: serial.Parity.None,
  stopBits: serial.StopBits.One,
});

const bus = new Lx16dBus(serial.Serial1, { timeoutMs: 50, retries: 3 });
const servo = bus.servo(1);
```

`Lx16dBus` accepts an already configured `serial.Serial`. It must not call `setup()` or `close()`.

`Lx16dBus` owns framing, checksum validation, read timeouts, retry behavior, response matching, and serialization of request/response operations. It exposes `servo(id)` and raw `send`/`transact` operations for advanced or broadcast use.

`Lx16dServo` exposes domain operations without leaking byte framing. Its current `id` is mutable only through `setId(newId)` after the matching ID-write command succeeds.

## Wire protocol

Frames have form `55 55 ID LENGTH CMD payload checksum`, where `LENGTH` is `3 + payload.length` and `checksum` is the complement of the low-byte sum from `ID` through the final payload byte. Multi-byte values are little-endian.

A response must have a valid header, permitted length, matching requested ID (except broadcast requests), matching command, expected payload length, and checksum. Failures use `Lx16dError`, preserving a specific reason such as `timeout`, `header`, `length`, `responseId`, `responseCommand`, or `checksum`.

No transaction expects a response from broadcast ID `0xfe`; use `send` for broadcast commands. Requests sharing a bus run strictly one at a time.

## Hardware direction control

The external circuit must support the servo's half-duplex 3.3 V bus. The bus options may accept `beforeTransmit` and `beforeReceive` callbacks for applications that need GPIO-based transceiver direction switching. The driver invokes them around transmit and response receipt; applications that use separate TX/RX circuitry need not supply them.

## Testing

Tests are written before implementation. The test suite uses a fake serial transport and verifies:

- frame construction and checksum calculation;
- valid and invalid frame decoding, including checksum failures;
- little-endian signed and unsigned codecs;
- servo command payload and decoded result mapping;
- `setId()` updates the facade only after successful transport completion; and
- serialized request execution plus timeout/retry behavior.

The test runner and type-checking command will be selected from the existing project tooling with the smallest compatible addition needed.
