# LX-16D / LX-16A serial protocol notes

**Scope.** This note documents the LX-16A-compatible protocol used by the
local TypeScript driver in `src/lx16d.ts`. The principal protocol source is the
[`madhephaestus/lx16a-servo`](https://github.com/madhephaestus/lx16a-servo)
Arduino library, which supports LX-16A and related LewanSoul/Hiwonder bus
servos. It also includes the vendor communication-protocol PDF
([source PDF](https://github.com/madhephaestus/lx16a-servo/blob/master/lx-16a%20LewanSoul%20Bus%20Servo%20Communication%20Protocol.pdf)).

> **Compatibility caution:** this evidence directly establishes the LX-16A
> protocol. Treat LX-16D compatibility as an on-hardware verification item
> (ping/read ID, position, and mode) rather than assuming every command or
> range is identical.

## Transport and electrical interface

- Configure UART as **115200 baud, 8 data bits, no parity, 1 stop bit**
  (`SERIAL_8N1`); the library's bus baud default is 115200.
  [Source](https://github.com/madhephaestus/lx16a-servo/blob/master/src/lx16a-servo.h)
- The servo serial pin is a **3.3 V, half-duplex, bidirectional asynchronous**
  bus. The host must release its transmitter before the servo replies. The
  upstream README recommends a tri-state buffer (74HC126) for normal TX/RX
  wiring; ESP32 open-drain one-pin mode is an alternative.
  [Source](https://github.com/madhephaestus/lx16a-servo/blob/master/README.md#electrical)
- The broadcast address is `0xFE`. Do not issue a request that expects a unique
  response to a bus containing multiple servos at that address; multiple replies
  will collide. The upstream code special-cases `0xFE` when checking a response
  ID. [Source](https://github.com/madhephaestus/lx16a-servo/blob/master/src/lx16a-servo.h)

## Jaculus usage

The application configures and owns the UART lifecycle; `Lx16dBus` accepts the
already-configured `serial.Serial1` and never calls `setup()` or `close()`.

```ts
import * as serial from "serial";
import { Lx16dBus } from "./lx16d.js";

serial.Serial1.setup({
  tx: SERVO_TX_PIN,
  rx: SERVO_RX_PIN,
  baudRate: 115_200,
  dataBits: serial.DataBits.Eight,
  parity: serial.Parity.None,
  stopBits: serial.StopBits.One,
});

const bus = new Lx16dBus(serial.Serial1, { timeoutMs: 50, retries: 3 });
const servo = bus.servo(SERVO_ID);
```

For a single-wire or tri-state half-duplex circuit, supply `beforeTransmit` and
`beforeReceive` hooks in the bus options when GPIO direction switching is
required. Compatibility evidence is **LX-16A protocol evidence**; each
individual LX-16D command must be verified on the target hardware.

## Frame format and checksum

All numeric multibyte fields and values are little-endian unless noted.

```text
Request / response frame
+------+------+-----+--------+-----+------------------+----------+
| 0x55 | 0x55 | ID  | LENGTH | CMD | parameters (0..n) | checksum |
+------+------+-----+--------+-----+------------------+----------+
                  \________ LENGTH bytes ________/
```

- `LENGTH = 3 + parameterCount`: one byte each for `CMD` and checksum plus the
  parameters. Therefore total frame size is `LENGTH + 3`.
- `checksum = (~sum(ID, LENGTH, CMD, parameters)) & 0xff`. The upstream sender
  writes the two headers, sums bytes from ID through the final parameter, then
  stores the bitwise complement. [Source](https://github.com/madhephaestus/lx16a-servo/blob/master/src/lx16a-servo.cpp)
- Example, set ID 1 to position 500 (`0xf4 0x01`) over 1,000 ms
  (`0xe8 0x03`): `55 55 01 07 01 f4 01 e8 03 16`.
  Here the covered-byte sum is `0xE9`, so checksum is `~0xE9 & 0xff = 0x16`.

## Commands observed in the upstream public header

The following IDs are the constants in the upstream implementation; read
commands use the same command ID in the response frame.

| ID | Write / read command | Typical parameter payload |
|---:|---|---|
| 1 / 2 | `MOVE_TIME_WRITE` / `MOVE_TIME_READ` | target position `u16`, time `u16` |
| 7 / 8 | `MOVE_TIME_WAIT_WRITE` / `MOVE_TIME_WAIT_READ` | queued target `u16`, time `u16` |
| 11 / 12 | `MOVE_START` / `MOVE_STOP` | none |
| 13 / 14 | `ID_WRITE` / `ID_READ` | ID `u8` |
| 17 / 18 / 19 | angle-offset adjust / save / read | signed offset `i8` on the wire |
| 20 / 21 | angle-limit write / read | min `u16`, max `u16` |
| 22 / 23 | VIN-limit write / read | min `u16`, max `u16` (mV) |
| 24 / 25 | max-temperature-limit write / read | temperature `u8` |
| 26 / 27 / 28 | temperature / VIN / position read | response: `u8`, `u16`, `i16` respectively |
| 29 / 30 | servo-or-motor-mode write / read | mode `u8`, reserved `u8`, speed `i16` |
| 31 / 32 | load/unload write / read | `0` unloads torque, `1` enables torque |
| 33 / 34 | LED control write / read | LED state `u8` |
| 35 / 36 | LED-error write / read | error mask `u8` |

The IDs come from
[`lx16a-servo.h`](https://github.com/madhephaestus/lx16a-servo/blob/master/src/lx16a-servo.h).
Parameter shapes, position scaling, mode, and load semantics above are also
implemented/documented in that header. In particular, the library maps the
position range `0..1000` to `0..240°` (0.24° per tick), accepts movement time
up to 30,000 ms, and encodes motor speed as signed `i16` in the range
`-1000..1000`.

## Receiving and parsing safely

The upstream `rcv` routine provides a useful minimum validation model:

1. Read exactly two `0x55` header bytes.
2. Check `ID` against the requested ID (or permit any ID for broadcast discovery).
3. Validate `LENGTH`; its implementation accepts `3..7`, then calculates total
   bytes as `LENGTH + 3`. Do not inherit the `7` limit as a protocol guarantee:
   bound it using the command's expected response payload or a deliberate driver
   maximum.
4. Check that the echoed `CMD` equals the request command.
5. Read exactly `LENGTH - 3` parameters and the checksum; recompute the checksum
   across bytes from ID through the final parameter.
6. Reject timeout, framing, ID, command, length, and checksum failures as
   distinct errors. The Arduino code grants roughly 30 ms of servo-think time
   after transmit and retries requests up to three times by default.

Source: [`lx16a-servo.cpp`](https://github.com/madhephaestus/lx16a-servo/blob/master/src/lx16a-servo.cpp).
A TypeScript stream parser should additionally **resynchronise** after noise:
scan for `0x55 0x55`, retain a trailing single `0x55` between chunks, and on an
invalid frame resume scanning rather than trusting byte alignment forever.

## TypeScript public API suggestions

Keep raw bus framing separate from servo-domain units and from the Jaculus UART
adapter:

```ts
class Lx16Bus {
  constructor(transport: HalfDuplexSerial, options?: { timeoutMs?: number; retries?: number });
  transact(id: number, command: Lx16Command, payload?: Uint8Array): Promise<Uint8Array>;
  send(id: number, command: Lx16Command, payload?: Uint8Array): Promise<void>;
}

class Lx16Servo {
  constructor(readonly bus: Lx16Bus, readonly id: number);
  moveTo(position: Lx16Position, durationMs?: number): Promise<void>;
  readPosition(): Promise<Lx16Position>;
  setMotorSpeed(speed: Lx16MotorSpeed): Promise<void>;
  setTorque(enabled: boolean): Promise<void>;
}
```

- Define `Lx16Command` from the table as a numeric enum/`as const` object;
  define `BROADCAST_ID = 0xfe` explicitly.
- Use explicit unit-bearing values or branded types (`positionTicks`, `degrees`,
  `millivolts`, `celsius`, `milliseconds`) at the public boundary. Convert only
  in codec functions such as `writeU16LE` and `readI16LE`; avoid exposing raw
  byte arrays from `Lx16Servo`.
- Serialize bus transactions with a queue/mutex. Half-duplex request/response
  pairing makes concurrent reads unsafe, and broadcasts should normally use
  `send` rather than `transact`.
- Make transport direction control part of `HalfDuplexSerial` (`beginTransmit`,
  `write`, `drain`, `beginReceive`) so application code cannot leave the shared
  line driven while awaiting a servo reply.
- Return or throw structured failures containing `kind` (`timeout`, `header`,
  `id`, `command`, `length`, `checksum`, `transport`) and context (`id`,
  `command`, received bytes). This is substantially more diagnosable than a
  Boolean result.

## Primary sources

1. madhephaestus, [upstream README: electrical interface](https://github.com/madhephaestus/lx16a-servo/blob/master/README.md#electrical).
2. madhephaestus, [`src/lx16a-servo.h`: transport configuration, command constants, and public servo operations](https://github.com/madhephaestus/lx16a-servo/blob/master/src/lx16a-servo.h).
3. madhephaestus, [`src/lx16a-servo.cpp`: frame construction, checksum, retries, and response validation](https://github.com/madhephaestus/lx16a-servo/blob/master/src/lx16a-servo.cpp).
4. LewanSoul, [*LX-16A LewanSoul Bus Servo Communication Protocol* PDF bundled verbatim with the upstream library](https://github.com/madhephaestus/lx16a-servo/blob/master/lx-16a%20LewanSoul%20Bus%20Servo%20Communication%20Protocol.pdf).
