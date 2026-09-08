/// <reference path="../node_modules/@types/jaculus/build/types/serial.d.ts" />

import * as serial from "serial";
import { Lx16dBus } from "./lx16d.js";

// Board-specific example pins: change these for the connected Jaculus board.
const SERVO_TX_PIN = 17;
const SERVO_RX_PIN = 18;
// Board-specific example servo ID: change this for the addressed servo.
const SERVO_ID = 1;

async function main(): Promise<void> {
  serial.Serial1.setup({
    tx: SERVO_TX_PIN,
    rx: SERVO_RX_PIN,
    baudRate: 115_200,
    dataBits: serial.DataBits.Eight,
    parity: serial.Parity.None,
    stopBits: serial.StopBits.One,
  });

  // A single-wire/tri-state half-duplex circuit may require beforeTransmit and beforeReceive hooks for direction switching.
  const bus = new Lx16dBus(serial.Serial1, { timeoutMs: 50, retries: 3 });
  const servo = bus.servo(SERVO_ID);

  await servo.moveTo(500, { durationMs: 750 });
  console.log(`Position: ${await servo.readPosition()}`);
  console.log(`Temperature: ${await servo.readTemperature()} °C`);
  console.log(`Voltage: ${await servo.readVoltage()} mV`);
}

void main().catch((error) => console.error(error));
