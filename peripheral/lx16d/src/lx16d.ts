export enum Lx16dCommand {
  MoveTimeWrite = 1,
  MoveTimeRead = 2,
  MoveTimeWaitWrite = 7,
  MoveTimeWaitRead = 8,
  MoveStart = 11,
  MoveStop = 12,
  IdWrite = 13,
  IdRead = 14,
  AngleOffsetAdjust = 17,
  AngleOffsetWrite = 18,
  AngleOffsetRead = 19,
  AngleLimitWrite = 20,
  AngleLimitRead = 21,
  VinLimitWrite = 22,
  VinLimitRead = 23,
  TempMaxLimitWrite = 24,
  TempMaxLimitRead = 25,
  TempRead = 26,
  VinRead = 27,
  PositionRead = 28,
  OrMotorModeWrite = 29,
  OrMotorModeRead = 30,
  LoadOrUnloadWrite = 31,
  LoadOrUnloadRead = 32,
  LedControlWrite = 33,
  LedControlRead = 34,
  LedErrorWrite = 35,
  LedErrorRead = 36,
}

export type Lx16dErrorKind =
  | "header"
  | "length"
  | "checksum"
  | "timeout"
  | "transport"
  | "responseId"
  | "responseCommand"
  | "responseLength"
  | "responsePayload";

export class Lx16dError extends Error {
  constructor(
    readonly kind: Lx16dErrorKind,
    message: string,
    readonly id?: number,
    readonly command?: Lx16dCommand,
    readonly received?: Uint8Array,
  ) {
    super(message);
    this.name = "Lx16dError";
  }
}

export interface Lx16dFrame {
  id: number;
  command: Lx16dCommand;
  payload: Uint8Array;
}

const HEADER = 0x55;
const MIN_LENGTH = 3;
const MAX_SERVO_ID = 0xfe;

export function encodeFrame(
  id: number,
  command: Lx16dCommand,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  assertServoId(id);
  assertByte(command, "command");

  const length = payload.length + MIN_LENGTH;
  if (length > 0xff) {
    throw new RangeError("payload is too long for an LX-16D frame");
  }

  const frame = new Uint8Array(length + 3);
  frame[0] = HEADER;
  frame[1] = HEADER;
  frame[2] = id;
  frame[3] = length;
  frame[4] = command;
  frame.set(payload, 5);
  frame[frame.length - 1] = checksum(frame.subarray(2, -1));
  return frame;
}

export function decodeFrame(bytes: Uint8Array): Lx16dFrame {
  if (bytes.length < 2 || bytes[0] !== HEADER || bytes[1] !== HEADER) {
    throw new Lx16dError("header", "invalid LX-16D frame header");
  }

  if (bytes.length < 4) {
    throw new Lx16dError("length", "truncated LX-16D frame");
  }

  const length = bytes[3];
  if (length < MIN_LENGTH || length !== bytes.length - 3) {
    throw new Lx16dError("length", "invalid LX-16D frame length");
  }

  const expectedChecksum = checksum(bytes.subarray(2, -1));
  if (bytes[bytes.length - 1] !== expectedChecksum) {
    throw new Lx16dError("checksum", "invalid LX-16D frame checksum");
  }

  return {
    id: bytes[2],
    command: bytes[4] as Lx16dCommand,
    payload: bytes.slice(5, -1),
  };
}

export function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readI16LE(bytes: Uint8Array, offset: number): number {
  const value = readU16LE(bytes, offset);
  return value > 0x7fff ? value - 0x10000 : value;
}

export function writeU16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
}

export function writeI16LE(bytes: Uint8Array, offset: number, value: number): void {
  writeU16LE(bytes, offset, value & 0xffff);
}

function findHeader(bytes: number[]): number {
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === HEADER && bytes[index + 1] === HEADER) {
      return index;
    }
  }
  return -1;
}

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const byte of bytes) {
    sum = (sum + byte) & 0xff;
  }
  return (~sum) & 0xff;
}

function assertServoId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > MAX_SERVO_ID) {
    throw new RangeError("servo ID must be an integer from 0 to 254");
  }
}

function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${name} must be an unsigned byte`);
  }
}

export interface Lx16dSerial {
  write(data: Uint8Array): void;
  flush(): void;
  get(): Promise<Uint8Array>;
}

export interface Lx16dBusOptions {
  timeoutMs?: number;
  retries?: number;
  beforeTransmit?: () => void | Promise<void>;
  beforeReceive?: () => void | Promise<void>;
}

export class Lx16dBus {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly incomingBytes: number[] = [];
  private byteWaiter: ((result: ByteResult) => void) | undefined;
  private readerRunning = false;
  private readerError: unknown;

  constructor(
    private readonly port: Lx16dSerial,
    private readonly options: Lx16dBusOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 50;
    this.retries = options.retries ?? 0;

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 0) {
      throw new RangeError("timeoutMs must be a non-negative finite number");
    }
    if (!Number.isInteger(this.retries) || this.retries < 0) {
      throw new RangeError("retries must be a non-negative integer");
    }
  }

  servo(id: number): Lx16dServo {
    assertFacadeServoId(id);
    return new Lx16dServo(this, id);
  }

  send(
    id: number,
    command: Lx16dCommand,
    payload: Uint8Array = new Uint8Array(0),
  ): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.transmit(id, command, payload);
        await this.options.beforeReceive?.();
      } catch (error) {
        throw requestError(error, id, command);
      }
    });
  }

  transact(
    id: number,
    command: Lx16dCommand,
    expectedPayloadLength: number,
    payload: Uint8Array = new Uint8Array(0),
  ): Promise<Uint8Array> {
    if (id === 0xfe) {
      return Promise.reject(new RangeError("broadcast requests cannot receive a response"));
    }
    if (!Number.isInteger(expectedPayloadLength) || expectedPayloadLength < 0) {
      return Promise.reject(new RangeError("expectedPayloadLength must be a non-negative integer"));
    }

    return this.enqueue(async () => {
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        try {
          await this.transmit(id, command, payload);
          await this.options.beforeReceive?.();
          const receivedFrame = await this.receiveFrame(expectedPayloadLength, Date.now() + this.timeoutMs);
          if (receivedFrame.frame.id !== id) {
            throw new Lx16dError("responseId", "response servo ID does not match request", undefined, undefined, receivedFrame.received);
          }
          if (receivedFrame.frame.command !== command) {
            throw new Lx16dError("responseCommand", "response command does not match request", undefined, undefined, receivedFrame.received);
          }
          return receivedFrame.frame.payload;
        } catch (error) {
          const contextualError = requestError(error, id, command);
          if (attempt === this.retries) {
            throw contextualError;
          }
        }
      }

      throw new Error("unreachable");
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async transmit(id: number, command: Lx16dCommand, payload: Uint8Array): Promise<void> {
    await this.options.beforeTransmit?.();
    this.port.write(encodeFrame(id, command, payload));
    this.port.flush();
  }

  private async receiveFrame(expectedPayloadLength: number, deadline: number): Promise<ReceivedFrame> {
    const bytes: number[] = [];
    while (true) {
      bytes.push(await this.readByte(deadline));

      const headerOffset = findHeader(bytes);
      if (headerOffset < 0) {
        bytes.splice(0, Math.max(0, bytes.length - 1));
        continue;
      }
      if (headerOffset > 0) {
        bytes.splice(0, headerOffset);
      }
      if (bytes.length < 4) {
        continue;
      }

      const length = bytes[3];
      if (length < MIN_LENGTH) {
        bytes.shift();
        continue;
      }
      const expectedLength = expectedPayloadLength + MIN_LENGTH;
      if (length !== expectedLength) {
        throw new Lx16dError(
          "responseLength",
          "response payload length does not match request",
          undefined,
          undefined,
          Uint8Array.from(bytes),
        );
      }

      const frameLength = length + 3;
      if (bytes.length < frameLength) {
        continue;
      }
      const received = Uint8Array.from(bytes.slice(0, frameLength));
      try {
        return { frame: decodeFrame(received), received };
      } catch (error) {
        if (error instanceof Lx16dError) {
          throw new Lx16dError(error.kind, error.message, undefined, undefined, received);
        }
        throw error;
      }
    }
  }

  private async readByte(deadline: number): Promise<number> {
    if (this.incomingBytes.length > 0) {
      return this.incomingBytes.shift() as number;
    }
    if (this.readerError !== undefined) {
      const error = this.readerError;
      this.readerError = undefined;
      throw error;
    }

    this.startReader();
    const remainingMs = Math.max(0, deadline - Date.now());
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.byteWaiter = undefined;
        reject(new Lx16dError("timeout", "timed out waiting for LX-16D response frame"));
      }, remainingMs);
      this.byteWaiter = (result) => {
        clearTimeout(timer);
        this.byteWaiter = undefined;
        if ("error" in result) {
          reject(result.error);
        } else {
          resolve(result.byte);
        }
      };
      this.deliverBufferedByte();
    });
  }

  private startReader(): void {
    if (this.readerRunning) {
      return;
    }
    this.readerRunning = true;
    void this.pumpReader();
  }

  private async pumpReader(): Promise<void> {
    try {
      while (true) {
        const bytes = await this.port.get();
        if (bytes.length !== 1) {
          throw new Lx16dError("length", "serial get() must return exactly one byte");
        }
        this.incomingBytes.push(bytes[0]);
        this.deliverBufferedByte();
      }
    } catch (error) {
      this.readerRunning = false;
      this.readerError = error;
      this.deliverReaderError(error);
    }
  }

  private deliverBufferedByte(): void {
    if (this.byteWaiter === undefined || this.incomingBytes.length === 0) {
      return;
    }
    const waiter = this.byteWaiter;
    this.byteWaiter = undefined;
    waiter({ byte: this.incomingBytes.shift() as number });
  }

  private deliverReaderError(error: unknown): void {
    if (this.byteWaiter === undefined) {
      return;
    }
    const waiter = this.byteWaiter;
    this.byteWaiter = undefined;
    waiter({ error });
  }
}

interface ReceivedFrame {
  frame: Lx16dFrame;
  received: Uint8Array;
}

type ByteResult = { byte: number } | { error: unknown };

function requestError(error: unknown, id: number, command: Lx16dCommand): Lx16dError {
  if (error instanceof Lx16dError) {
    return new Lx16dError(error.kind, error.message, id, command, error.received);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Lx16dError("transport", `LX-16D transport failure: ${message}`, id, command);
}

export interface Lx16dMovement {
  position: number;
  durationMs: number;
}

export interface Lx16dAngleLimits {
  minimum: number;
  maximum: number;
}

export interface Lx16dVoltageLimits {
  minimumMv: number;
  maximumMv: number;
}

export type Lx16dMotorMode =
  | { kind: "servo" }
  | { kind: "motor"; speed: number };

export class Lx16dServo {
  constructor(
    private readonly bus: Lx16dBus,
    public id: number,
  ) {}

  async moveTo(position: number, options: { durationMs?: number } = {}): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.MoveTimeWrite, movementPayload(position, options.durationMs ?? 0));
  }

  async readMove(): Promise<Lx16dMovement> {
    return movementFromPayload(await this.bus.transact(this.id, Lx16dCommand.MoveTimeRead, 4));
  }

  async queueMove(position: number, options: { durationMs?: number } = {}): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.MoveTimeWaitWrite, movementPayload(position, options.durationMs ?? 0));
  }

  async readQueuedMove(): Promise<Lx16dMovement> {
    return movementFromPayload(await this.bus.transact(this.id, Lx16dCommand.MoveTimeWaitRead, 4));
  }

  async start(): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.MoveStart);
  }

  async stop(): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.MoveStop);
  }

  async setId(newId: number): Promise<void> {
    assertFacadeServoId(newId);
    await this.bus.send(this.id, Lx16dCommand.IdWrite, Uint8Array.of(newId));
    this.id = newId;
  }

  async readId(): Promise<number> {
    return (await this.bus.transact(this.id, Lx16dCommand.IdRead, 1))[0];
  }

  async adjustOffset(offset: number): Promise<void> {
    assertI8(offset, "offset");
    await this.bus.send(this.id, Lx16dCommand.AngleOffsetAdjust, Uint8Array.of(offset & 0xff));
  }

  async saveOffset(): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.AngleOffsetWrite);
  }

  async readOffset(): Promise<number> {
    const value = (await this.bus.transact(this.id, Lx16dCommand.AngleOffsetRead, 1))[0];
    return value > 0x7f ? value - 0x100 : value;
  }

  async setAngleLimits(limits: Lx16dAngleLimits): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.AngleLimitWrite, limitsPayload(limits.minimum, limits.maximum, "angle limit"));
  }

  async readAngleLimits(): Promise<Lx16dAngleLimits> {
    const payload = await this.bus.transact(this.id, Lx16dCommand.AngleLimitRead, 4);
    return { minimum: readU16LE(payload, 0), maximum: readU16LE(payload, 2) };
  }

  async setVoltageLimits(limits: Lx16dVoltageLimits): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.VinLimitWrite, limitsPayload(limits.minimumMv, limits.maximumMv, "voltage limit"));
  }

  async readVoltageLimits(): Promise<Lx16dVoltageLimits> {
    const payload = await this.bus.transact(this.id, Lx16dCommand.VinLimitRead, 4);
    return { minimumMv: readU16LE(payload, 0), maximumMv: readU16LE(payload, 2) };
  }

  async setTemperatureLimit(limit: number): Promise<void> {
    assertByte(limit, "temperature limit");
    await this.bus.send(this.id, Lx16dCommand.TempMaxLimitWrite, Uint8Array.of(limit));
  }

  async readTemperatureLimit(): Promise<number> {
    return (await this.bus.transact(this.id, Lx16dCommand.TempMaxLimitRead, 1))[0];
  }

  async readTemperature(): Promise<number> {
    return (await this.bus.transact(this.id, Lx16dCommand.TempRead, 1))[0];
  }

  async readVoltage(): Promise<number> {
    return readU16LE(await this.bus.transact(this.id, Lx16dCommand.VinRead, 2), 0);
  }

  async readPosition(): Promise<number> {
    return readI16LE(await this.bus.transact(this.id, Lx16dCommand.PositionRead, 2), 0);
  }

  async setServoMode(): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.OrMotorModeWrite, Uint8Array.of(0, 0, 0, 0));
  }

  async setMotorMode(speed: number): Promise<void> {
    if (!Number.isInteger(speed) || speed < -1000 || speed > 1000) {
      throw new RangeError("motor speed must be an integer from -1000 to 1000");
    }
    const payload = Uint8Array.of(1, 0, 0, 0);
    writeI16LE(payload, 2, speed);
    await this.bus.send(this.id, Lx16dCommand.OrMotorModeWrite, payload);
  }

  async readMode(): Promise<Lx16dMotorMode> {
    const payload = await this.bus.transact(this.id, Lx16dCommand.OrMotorModeRead, 4);
    if (payload[0] === 0) {
      return { kind: "servo" };
    }
    if (payload[0] === 1) {
      return { kind: "motor", speed: readI16LE(payload, 2) };
    }
    throw new Lx16dError(
      "responsePayload",
      "invalid servo-or-motor mode response payload",
      this.id,
      Lx16dCommand.OrMotorModeRead,
      payload,
    );
  }

  async setTorque(enabled: boolean): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.LoadOrUnloadWrite, Uint8Array.of(enabled ? 1 : 0));
  }

  async readTorque(): Promise<boolean> {
    return (await this.bus.transact(this.id, Lx16dCommand.LoadOrUnloadRead, 1))[0] !== 0;
  }

  async setLed(enabled: boolean): Promise<void> {
    await this.bus.send(this.id, Lx16dCommand.LedControlWrite, Uint8Array.of(enabled ? 1 : 0));
  }

  async readLed(): Promise<boolean> {
    return (await this.bus.transact(this.id, Lx16dCommand.LedControlRead, 1))[0] !== 0;
  }

  async setLedErrorMask(mask: number): Promise<void> {
    assertByte(mask, "LED error mask");
    await this.bus.send(this.id, Lx16dCommand.LedErrorWrite, Uint8Array.of(mask));
  }

  async readLedErrorMask(): Promise<number> {
    return (await this.bus.transact(this.id, Lx16dCommand.LedErrorRead, 1))[0];
  }
}

function assertFacadeServoId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id >= MAX_SERVO_ID) {
    throw new RangeError("servo ID must be an integer from 0 to 253");
  }
}

function assertU16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit integer`);
  }
}

function assertI8(value: number, name: string): void {
  if (!Number.isInteger(value) || value < -0x80 || value > 0x7f) {
    throw new RangeError(`${name} must be a signed byte`);
  }
}

function movementPayload(position: number, durationMs: number): Uint8Array {
  if (!Number.isInteger(position) || position < 0 || position > 1000) {
    throw new RangeError("position must be an integer from 0 to 1000");
  }
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 30000) {
    throw new RangeError("movement duration must be an integer from 0 to 30000");
  }
  const payload = new Uint8Array(4);
  writeU16LE(payload, 0, position);
  writeU16LE(payload, 2, durationMs);
  return payload;
}

function movementFromPayload(payload: Uint8Array): Lx16dMovement {
  return { position: readU16LE(payload, 0), durationMs: readU16LE(payload, 2) };
}

function limitsPayload(minimum: number, maximum: number, name: string): Uint8Array {
  assertU16(minimum, `${name} minimum`);
  assertU16(maximum, `${name} maximum`);
  const payload = new Uint8Array(4);
  writeU16LE(payload, 0, minimum);
  writeU16LE(payload, 2, maximum);
  return payload;
}
