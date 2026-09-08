import assert from "node:assert/strict";
import test from "node:test";

import {
  Lx16dBus,
  Lx16dCommand,
  Lx16dError,
  decodeFrame,
  encodeFrame,
  readI16LE,
  readU16LE,
  writeI16LE,
  writeU16LE,
} from "../src/lx16d.js";

class FakeSerial {
  readonly writes: Uint8Array[] = [];
  readonly events: string[] = [];
  private readonly replies: Array<Promise<Uint8Array>> = [];
  writeError: Error | undefined;
  getError: Error | undefined;
  activeGets = 0;
  maximumActiveGets = 0;

  constructor(bytes: Uint8Array = new Uint8Array(0)) {
    this.enqueue(bytes);
  }

  enqueue(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.replies.push(Promise.resolve(Uint8Array.of(byte)));
    }
  }

  enqueueDelayed(byte: number, delayMs: number): void {
    this.replies.push(new Promise((resolve) => setTimeout(() => resolve(Uint8Array.of(byte)), delayMs)));
  }

  enqueueGated(bytes: Uint8Array): () => void {
    let release: (() => void) | undefined;
    this.replies.push(new Promise((resolve) => {
      release = () => resolve(Uint8Array.of(bytes[0]));
    }));
    for (const byte of bytes.slice(1)) {
      this.replies.push(Promise.resolve(Uint8Array.of(byte)));
    }
    return () => release?.();
  }

  write(data: Uint8Array): void {
    this.events.push("write");
    if (this.writeError !== undefined) {
      throw this.writeError;
    }
    this.writes.push(data.slice());
  }

  flush(): void {
    this.events.push("flush");
  }

  get(): Promise<Uint8Array> {
    this.events.push("get");
    this.activeGets += 1;
    this.maximumActiveGets = Math.max(this.maximumActiveGets, this.activeGets);
    const reply = this.getError === undefined
      ? this.replies.shift() ?? new Promise<Uint8Array>(() => {})
      : Promise.reject(this.getError);
    return reply.finally(() => {
      this.activeGets -= 1;
    });
  }
}

test("encodes a move frame with the LX-16 checksum", () => {
  assert.deepEqual(
    [...encodeFrame(1, Lx16dCommand.MoveTimeWrite, Uint8Array.of(0xf4, 0x01, 0xe8, 0x03))],
    [0x55, 0x55, 0x01, 0x07, 0x01, 0xf4, 0x01, 0xe8, 0x03, 0x16],
  );
});

test("decodes a complete frame into its protocol fields", () => {
  assert.deepEqual(
    decodeFrame(Uint8Array.of(0x55, 0x55, 0x01, 0x07, 0x01, 0xf4, 0x01, 0xe8, 0x03, 0x16)),
    {
      id: 0x01,
      command: Lx16dCommand.MoveTimeWrite,
      payload: Uint8Array.of(0xf4, 0x01, 0xe8, 0x03),
    },
  );
});

test("rejects a frame with an invalid checksum", () => {
  assert.throws(
    () => decodeFrame(Uint8Array.of(0x55, 0x55, 0x01, 0x03, 0x1c, 0x00)),
    (error: unknown) => error instanceof Lx16dError && error.kind === "checksum",
  );
});

test("rejects a frame whose declared length differs from its byte count", () => {
  assert.throws(
    () => decodeFrame(Uint8Array.of(0x55, 0x55, 0x01, 0x04, 0x1c, 0xe2)),
    (error: unknown) => error instanceof Lx16dError && error.kind === "length",
  );
});

test("rejects frames without exactly two header bytes", () => {
  for (const bytes of [
    Uint8Array.of(0x00, 0x55, 0x01, 0x03, 0x1c, 0xdf),
    Uint8Array.of(0x55, 0x00, 0x01, 0x03, 0x1c, 0xdf),
  ]) {
    assert.throws(
      () => decodeFrame(bytes),
      (error: unknown) => error instanceof Lx16dError && error.kind === "header",
    );
  }
});

test("rejects a header-valid truncated frame as a length error", () => {
  assert.throws(
    () => decodeFrame(Uint8Array.of(0x55, 0x55, 0x01, 0x03, 0x1c)),
    (error: unknown) => error instanceof Lx16dError && error.kind === "length",
  );
});

test("reads an unsigned 16-bit little-endian value", () => {
  assert.equal(readU16LE(Uint8Array.of(0x34, 0x12), 0), 0x1234);
});

test("reads a signed 16-bit little-endian value", () => {
  assert.equal(readI16LE(Uint8Array.of(0x00, 0x80), 0), -0x8000);
});

test("writes an unsigned 16-bit little-endian value", () => {
  const bytes = new Uint8Array(2);
  writeU16LE(bytes, 0, 0xabcd);
  assert.deepEqual([...bytes], [0xcd, 0xab]);
});

test("writes a signed 16-bit little-endian value", () => {
  const bytes = new Uint8Array(2);
  writeI16LE(bytes, 0, -1);
  assert.deepEqual([...bytes], [0xff, 0xff]);
});

test("returns a matched response payload after writing the request frame", async () => {
  const port = new FakeSerial(encodeFrame(1, Lx16dCommand.PositionRead, Uint8Array.of(0xf4, 0x01)));
  const bus = new Lx16dBus(port, { timeoutMs: 10, retries: 0 });

  assert.deepEqual([...await bus.transact(1, Lx16dCommand.PositionRead, 2)], [0xf4, 0x01]);
  assert.deepEqual(port.writes.map((frame) => [...frame]), [[0x55, 0x55, 0x01, 0x03, 0x1c, 0xdf]]);
});

test("sends a no-response request without reading", async () => {
  const port = new FakeSerial();
  const bus = new Lx16dBus(port);

  await bus.send(0xfe, Lx16dCommand.MoveStart);

  assert.deepEqual(port.writes.map((frame) => [...frame]), [[0x55, 0x55, 0xfe, 0x03, 0x0b, 0xf3]]);
  assert.deepEqual(port.events, ["write", "flush"]);
});

test("rejects a response with a different servo ID", async () => {
  const port = new FakeSerial(encodeFrame(2, Lx16dCommand.PositionRead, Uint8Array.of(0, 0)));
  const bus = new Lx16dBus(port, { timeoutMs: 10, retries: 0 });

  await assert.rejects(
    bus.transact(1, Lx16dCommand.PositionRead, 2),
    (error: unknown) => error instanceof Lx16dError
      && error.kind === "responseId"
      && error.id === 1
      && error.command === Lx16dCommand.PositionRead
      && error.received?.length === 8,
  );
});

test("rejects a response with a different command", async () => {
  const port = new FakeSerial(encodeFrame(1, Lx16dCommand.VinRead, Uint8Array.of(0, 0)));
  const bus = new Lx16dBus(port, { timeoutMs: 10, retries: 0 });

  await assert.rejects(
    bus.transact(1, Lx16dCommand.PositionRead, 2),
    (error: unknown) => error instanceof Lx16dError && error.kind === "responseCommand",
  );
});

test("rejects a response with an invalid checksum", async () => {
  const port = new FakeSerial(Uint8Array.of(0x55, 0x55, 0x01, 0x03, 0x1c, 0x00));
  const bus = new Lx16dBus(port, { timeoutMs: 10, retries: 0 });

  await assert.rejects(
    bus.transact(1, Lx16dCommand.PositionRead, 0),
    (error: unknown) => error instanceof Lx16dError && error.kind === "checksum",
  );
});

test("rejects a response whose payload length differs from the request", async () => {
  const port = new FakeSerial(encodeFrame(1, Lx16dCommand.PositionRead, Uint8Array.of(0)));
  const bus = new Lx16dBus(port, { timeoutMs: 10, retries: 0 });

  await assert.rejects(
    bus.transact(1, Lx16dCommand.PositionRead, 2),
    (error: unknown) => error instanceof Lx16dError && error.kind === "responseLength",
  );
});

test("rejects when a response byte does not arrive before the timeout", async () => {
  const port = new FakeSerial();
  const bus = new Lx16dBus(port, { timeoutMs: 1, retries: 0 });

  await assert.rejects(
    bus.transact(1, Lx16dCommand.PositionRead, 2),
    (error: unknown) => error instanceof Lx16dError && error.kind === "timeout",
  );
});

test("delivers a retry response after a timeout without competing serial reads", async () => {
  const port = new FakeSerial();
  port.enqueueDelayed(0, 25);
  port.enqueue(encodeFrame(1, Lx16dCommand.PositionRead, Uint8Array.of(0xf4, 0x01)));
  const bus = new Lx16dBus(port, { timeoutMs: 20, retries: 1 });

  assert.deepEqual([...await bus.transact(1, Lx16dCommand.PositionRead, 2)], [0xf4, 0x01]);
  assert.equal(port.writes.length, 2);
  assert.equal(port.maximumActiveGets, 1);
});

test("retries immediately after an oversized declared response length", async () => {
  const port = new FakeSerial();
  port.enqueue(Uint8Array.of(0x55, 0x55, 1, 0xff));
  port.enqueue(encodeFrame(1, Lx16dCommand.PositionRead, Uint8Array.of(0xf4, 0x01)));
  const bus = new Lx16dBus(port, { timeoutMs: 10, retries: 1 });

  assert.deepEqual([...await bus.transact(1, Lx16dCommand.PositionRead, 2)], [0xf4, 0x01]);
  assert.equal(port.writes.length, 2);
});

test("normalizes rejected transport reads with request context", async () => {
  const port = new FakeSerial();
  port.getError = new Error("serial disconnected");
  const bus = new Lx16dBus(port, { timeoutMs: 10, retries: 0 });

  await assert.rejects(
    bus.transact(7, Lx16dCommand.PositionRead, 2),
    (error: unknown) => error instanceof Lx16dError
      && error.kind === "transport"
      && error.id === 7
      && error.command === Lx16dCommand.PositionRead
      && error.received === undefined
      && error.message.includes("serial disconnected"),
  );
});

test("orders direction hooks around transmission and response receipt", async () => {
  const port = new FakeSerial(encodeFrame(1, Lx16dCommand.PositionRead, Uint8Array.of(0, 0)));
  const bus = new Lx16dBus(port, {
    timeoutMs: 10,
    retries: 0,
    beforeTransmit: () => port.events.push("transmit"),
    beforeReceive: () => port.events.push("receive"),
  });

  await bus.transact(1, Lx16dCommand.PositionRead, 2);

  assert.deepEqual(port.events.slice(0, 4), ["transmit", "write", "flush", "receive"]);
  assert.equal(port.events.filter((event) => event === "get").length >= 8, true);
});

test("awaits asynchronous direction hooks around a send", async () => {
  const port = new FakeSerial();
  const bus = new Lx16dBus(port, {
    beforeTransmit: async () => port.events.push("transmit"),
    beforeReceive: async () => port.events.push("receive"),
  });

  await bus.send(1, Lx16dCommand.MoveStart);

  assert.deepEqual(port.events, ["transmit", "write", "flush", "receive"]);
});

test("rejects broadcast transactions", async () => {
  const bus = new Lx16dBus(new FakeSerial());

  await assert.rejects(bus.transact(0xfe, Lx16dCommand.PositionRead, 2), RangeError);
});

test("ignores leading noise while preserving the final header byte", async () => {
  const response = encodeFrame(1, Lx16dCommand.PositionRead, Uint8Array.of(0xf4, 0x01));
  const port = new FakeSerial(Uint8Array.of(0x00, 0x55, ...response));
  const bus = new Lx16dBus(port, { timeoutMs: 10, retries: 0 });

  assert.deepEqual([...await bus.transact(1, Lx16dCommand.PositionRead, 2)], [0xf4, 0x01]);
});

test("does not write a concurrent transaction before the first response settles", async () => {
  const port = new FakeSerial();
  const releaseFirstResponse = port.enqueueGated(encodeFrame(1, Lx16dCommand.PositionRead, Uint8Array.of(1, 0)));
  port.enqueue(encodeFrame(2, Lx16dCommand.PositionRead, Uint8Array.of(2, 0)));
  const bus = new Lx16dBus(port, { timeoutMs: 50, retries: 0 });

  const first = bus.transact(1, Lx16dCommand.PositionRead, 2);
  const second = bus.transact(2, Lx16dCommand.PositionRead, 2);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(port.writes.map((frame) => frame[2]), [1]);
  releaseFirstResponse();
  assert.deepEqual([...await first], [1, 0]);
  assert.deepEqual([...await second], [2, 0]);
  assert.deepEqual(port.writes.map((frame) => frame[2]), [1, 2]);
});

test("changes the cached servo ID only after a successful ID write", async () => {
  const port = new FakeSerial();
  const servo = new Lx16dBus(port).servo(1);

  port.writeError = new Error("write failed");
  await assert.rejects(servo.setId(2), /write failed/);
  assert.equal(servo.id, 1);

  port.writeError = undefined;
  await servo.setId(2);
  assert.equal(servo.id, 2);
  assert.deepEqual([...port.writes[0]], [...encodeFrame(1, Lx16dCommand.IdWrite, Uint8Array.of(2))]);
});

test("maps movement commands and decodes signed position telemetry", async () => {
  const port = new FakeSerial();
  port.enqueue(encodeFrame(1, Lx16dCommand.MoveTimeRead, Uint8Array.of(0xf4, 0x01, 0xe8, 0x03)));
  port.enqueue(encodeFrame(1, Lx16dCommand.MoveTimeWaitRead, Uint8Array.of(0x58, 0x02, 0xdc, 0x05)));
  port.enqueue(encodeFrame(1, Lx16dCommand.PositionRead, Uint8Array.of(0xff, 0xff)));
  const servo = new Lx16dBus(port).servo(1);

  await servo.moveTo(500, { durationMs: 1000 });
  assert.deepEqual(await servo.readMove(), { position: 500, durationMs: 1000 });
  await servo.queueMove(600, { durationMs: 1500 });
  assert.deepEqual(await servo.readQueuedMove(), { position: 600, durationMs: 1500 });
  await servo.start();
  await servo.stop();
  assert.equal(await servo.readPosition(), -1);
  assert.deepEqual(port.writes.slice(0, 6).map((frame) => [...frame]), [
    [...encodeFrame(1, Lx16dCommand.MoveTimeWrite, Uint8Array.of(0xf4, 0x01, 0xe8, 0x03))],
    [...encodeFrame(1, Lx16dCommand.MoveTimeRead)],
    [...encodeFrame(1, Lx16dCommand.MoveTimeWaitWrite, Uint8Array.of(0x58, 0x02, 0xdc, 0x05))],
    [...encodeFrame(1, Lx16dCommand.MoveTimeWaitRead)],
    [...encodeFrame(1, Lx16dCommand.MoveStart)],
    [...encodeFrame(1, Lx16dCommand.MoveStop)],
  ]);
});

test("round-trips angle and voltage limits and maps sensor reads", async () => {
  const port = new FakeSerial();
  port.enqueue(encodeFrame(1, Lx16dCommand.AngleLimitRead, Uint8Array.of(1, 0, 0xe8, 3)));
  port.enqueue(encodeFrame(1, Lx16dCommand.VinLimitRead, Uint8Array.of(0x88, 0x13, 0x70, 0x17)));
  port.enqueue(encodeFrame(1, Lx16dCommand.AngleOffsetRead, Uint8Array.of(0xfe)));
  port.enqueue(encodeFrame(1, Lx16dCommand.TempMaxLimitRead, Uint8Array.of(80)));
  port.enqueue(encodeFrame(1, Lx16dCommand.TempRead, Uint8Array.of(42)));
  port.enqueue(encodeFrame(1, Lx16dCommand.VinRead, Uint8Array.of(0x88, 0x13)));
  const servo = new Lx16dBus(port).servo(1);

  await servo.setAngleLimits({ minimum: 1, maximum: 1000 });
  assert.deepEqual(await servo.readAngleLimits(), { minimum: 1, maximum: 1000 });
  await servo.setVoltageLimits({ minimumMv: 5000, maximumMv: 6000 });
  assert.deepEqual(await servo.readVoltageLimits(), { minimumMv: 5000, maximumMv: 6000 });
  await servo.adjustOffset(-2);
  await servo.saveOffset();
  assert.equal(await servo.readOffset(), -2);
  await servo.setTemperatureLimit(80);
  assert.equal(await servo.readTemperatureLimit(), 80);
  assert.equal(await servo.readTemperature(), 42);
  assert.equal(await servo.readVoltage(), 5000);
});

test("maps motor mode, torque, and LED commands", async () => {
  const port = new FakeSerial();
  port.enqueue(encodeFrame(1, Lx16dCommand.OrMotorModeRead, Uint8Array.of(1, 0, 0xd4, 0xfe)));
  port.enqueue(encodeFrame(1, Lx16dCommand.LoadOrUnloadRead, Uint8Array.of(1)));
  port.enqueue(encodeFrame(1, Lx16dCommand.LedControlRead, Uint8Array.of(0)));
  port.enqueue(encodeFrame(1, Lx16dCommand.LedErrorRead, Uint8Array.of(7)));
  const servo = new Lx16dBus(port).servo(1);

  await servo.setServoMode();
  await servo.setMotorMode(-1000);
  assert.deepEqual(await servo.readMode(), { kind: "motor", speed: -300 });
  await servo.setTorque(true);
  assert.equal(await servo.readTorque(), true);
  await servo.setLed(false);
  assert.equal(await servo.readLed(), false);
  await servo.setLedErrorMask(7);
  assert.equal(await servo.readLedErrorMask(), 7);
});

test("validates facade IDs and numeric bounds", async () => {
  const bus = new Lx16dBus(new FakeSerial());
  const servo = bus.servo(1);
  for (const id of [0, 253]) {
    assert.equal(bus.servo(id).id, id);
  }
  for (const id of [-1, 0.5, 0xfe, 255]) {
    assert.throws(() => bus.servo(id), RangeError);
  }

  const validCases: Array<{ name: string; invoke: () => Promise<void> }> = [
    { name: "position at zero", invoke: () => servo.moveTo(0) },
    { name: "position at 1000", invoke: () => servo.moveTo(1000) },
    { name: "duration at zero", invoke: () => servo.moveTo(0, { durationMs: 0 }) },
    { name: "duration at 30000", invoke: () => servo.moveTo(1000, { durationMs: 30000 }) },
    { name: "angle limits at u16 endpoints", invoke: () => servo.setAngleLimits({ minimum: 0, maximum: 0xffff }) },
    { name: "voltage limits at u16 endpoints", invoke: () => servo.setVoltageLimits({ minimumMv: 0, maximumMv: 0xffff }) },
    { name: "offset at negative i8 endpoint", invoke: () => servo.adjustOffset(-0x80) },
    { name: "offset at positive i8 endpoint", invoke: () => servo.adjustOffset(0x7f) },
    { name: "temperature at byte endpoints", invoke: () => servo.setTemperatureLimit(0).then(() => servo.setTemperatureLimit(0xff)) },
    { name: "LED error mask at byte endpoints", invoke: () => servo.setLedErrorMask(0).then(() => servo.setLedErrorMask(0xff)) },
    { name: "motor speed at negative endpoint", invoke: () => servo.setMotorMode(-1000) },
    { name: "motor speed at positive endpoint", invoke: () => servo.setMotorMode(1000) },
  ];
  for (const { name, invoke } of validCases) {
    await assert.doesNotReject(invoke(), name);
  }

  const invalidCases: Array<{ name: string; invoke: () => Promise<void> }> = [
    { name: "position below range", invoke: () => servo.moveTo(-1) },
    { name: "position above range", invoke: () => servo.moveTo(1001) },
    { name: "duration below range", invoke: () => servo.moveTo(0, { durationMs: -1 }) },
    { name: "duration above range", invoke: () => servo.moveTo(0, { durationMs: 30001 }) },
    { name: "angle minimum below u16", invoke: () => servo.setAngleLimits({ minimum: -1, maximum: 0 }) },
    { name: "angle maximum above u16", invoke: () => servo.setAngleLimits({ minimum: 0, maximum: 0x10000 }) },
    { name: "voltage minimum below u16", invoke: () => servo.setVoltageLimits({ minimumMv: -1, maximumMv: 0 }) },
    { name: "voltage maximum above u16", invoke: () => servo.setVoltageLimits({ minimumMv: 0, maximumMv: 0x10000 }) },
    { name: "offset below i8", invoke: () => servo.adjustOffset(-129) },
    { name: "offset above i8", invoke: () => servo.adjustOffset(128) },
    { name: "temperature below byte", invoke: () => servo.setTemperatureLimit(-1) },
    { name: "temperature above byte", invoke: () => servo.setTemperatureLimit(256) },
    { name: "LED error mask below byte", invoke: () => servo.setLedErrorMask(-1) },
    { name: "LED error mask above byte", invoke: () => servo.setLedErrorMask(256) },
    { name: "motor speed below range", invoke: () => servo.setMotorMode(-1001) },
    { name: "motor speed above range", invoke: () => servo.setMotorMode(1001) },
  ];
  for (const { name, invoke } of invalidCases) {
    await assert.rejects(invoke(), RangeError, name);
  }
});

test("reads the servo ID from its matched response", async () => {
  const port = new FakeSerial(encodeFrame(1, Lx16dCommand.IdRead, Uint8Array.of(42)));
  const servo = new Lx16dBus(port).servo(1);

  assert.equal(await servo.readId(), 42);
  assert.deepEqual(port.writes.map((frame) => [...frame]), [[...encodeFrame(1, Lx16dCommand.IdRead)]]);
});

test("decodes servo mode and rejects an unknown mode response", async () => {
  const port = new FakeSerial();
  port.enqueue(encodeFrame(1, Lx16dCommand.OrMotorModeRead, Uint8Array.of(0, 0, 0, 0)));
  port.enqueue(encodeFrame(1, Lx16dCommand.OrMotorModeRead, Uint8Array.of(2, 0, 0, 0)));
  const servo = new Lx16dBus(port).servo(1);

  assert.deepEqual(await servo.readMode(), { kind: "servo" });
  await assert.rejects(
    servo.readMode(),
    (error: unknown) => error instanceof Lx16dError && error.kind === "responsePayload",
  );
});

test("emits exact payloads for configuration, mode, torque, and LED writes", async () => {
  const port = new FakeSerial();
  const servo = new Lx16dBus(port).servo(1);

  await servo.saveOffset();
  await servo.adjustOffset(-2);
  await servo.setAngleLimits({ minimum: 1, maximum: 1000 });
  await servo.setVoltageLimits({ minimumMv: 5000, maximumMv: 6000 });
  await servo.setTemperatureLimit(80);
  await servo.setServoMode();
  await servo.setMotorMode(-1000);
  await servo.setTorque(true);
  await servo.setTorque(false);
  await servo.setLed(true);
  await servo.setLed(false);
  await servo.setLedErrorMask(7);

  assert.deepEqual(port.writes.map((frame) => [...frame]), [
    [...encodeFrame(1, Lx16dCommand.AngleOffsetWrite)],
    [...encodeFrame(1, Lx16dCommand.AngleOffsetAdjust, Uint8Array.of(0xfe))],
    [...encodeFrame(1, Lx16dCommand.AngleLimitWrite, Uint8Array.of(1, 0, 0xe8, 0x03))],
    [...encodeFrame(1, Lx16dCommand.VinLimitWrite, Uint8Array.of(0x88, 0x13, 0x70, 0x17))],
    [...encodeFrame(1, Lx16dCommand.TempMaxLimitWrite, Uint8Array.of(80))],
    [...encodeFrame(1, Lx16dCommand.OrMotorModeWrite, Uint8Array.of(0, 0, 0, 0))],
    [...encodeFrame(1, Lx16dCommand.OrMotorModeWrite, Uint8Array.of(1, 0, 0x18, 0xfc))],
    [...encodeFrame(1, Lx16dCommand.LoadOrUnloadWrite, Uint8Array.of(1))],
    [...encodeFrame(1, Lx16dCommand.LoadOrUnloadWrite, Uint8Array.of(0))],
    [...encodeFrame(1, Lx16dCommand.LedControlWrite, Uint8Array.of(1))],
    [...encodeFrame(1, Lx16dCommand.LedControlWrite, Uint8Array.of(0))],
    [...encodeFrame(1, Lx16dCommand.LedErrorWrite, Uint8Array.of(7))],
  ]);
});
