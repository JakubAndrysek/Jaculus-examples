# Task 4 report: Jaculus demo and documentation

## Status

Completed.

## Changed files

- `src/index.ts`
  - Replaced the GPIO LED blink program with a single-run LX-16D Jaculus demo.
  - Added clearly configurable, board-specific `SERVO_TX_PIN`, `SERVO_RX_PIN`, and `SERVO_ID` constants using example pins `17` and `18` and servo ID `1`.
  - Configures `serial.Serial1` in application code at 115200 baud, 8 data bits, no parity, and 1 stop bit.
  - Constructs `new Lx16dBus(serial.Serial1, { timeoutMs: 50, retries: 3 })`, obtains the configured servo, moves it to position 500 in 750 ms, then logs position, temperature, and voltage.
  - Includes the required half-duplex direction-switching hook caveat; it does not loop or close the serial port.
  - Added a local reference to the installed `@types/jaculus` `serial.d.ts`. Version 0.1.0 ships this declaration but its root `index.d.ts` does not reference it, so the configured `--types jaculus` typecheck otherwise cannot resolve `import "serial"`.
- `docs/research/lx16d-protocol.md`
  - Added a **Jaculus usage** section with the same setup ownership rule and bus construction pattern.
  - States that compatibility evidence is LX-16A protocol evidence and that each individual LX-16D command requires target-hardware verification.
- `docs/superpowers/sdd/lx16d-driver/task-4-report.md`
  - Added this task report.

`test/lx16d.test.ts` was not changed. The updated executable demo is compiled by `npm run typecheck`, and the existing suite already exercises the bus and servo public API; a separate compilation-only API snippet would duplicate that coverage.

## Validation

Command run:

```sh
npm test && npm run typecheck
```

Result: exited successfully (status 0).

Test output summary:

```text
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 225.170125
```

Typecheck output summary:

```text
> template-jaculus@0.1.0 typecheck
> find src -type f -name '*.ts' -print0 | xargs -0 tsc --noEmit --target es2023 --module nodenext --lib es2023 --moduleResolution nodenext --types jaculus --rootDir src
```

`tsc` emitted no diagnostics and exited successfully, confirming that `src/index.ts` typechecks with the available Jaculus serial declarations.

The environment emitted the pre-existing npm warning `Unknown user config "min-release-age"`; it did not affect either validation result.

## Hardware caveat

The documented protocol compatibility evidence is for LX-16A. Each LX-16D command must be verified with the target servo and wiring. In particular, a single-wire or tri-state half-duplex circuit may need `beforeTransmit` and `beforeReceive` hooks to switch transceiver direction before transmitting and receiving.

## Review findings addressed

- Corrected the stale protocol-note scope statement. It now describes `src/lx16d.ts` as the implemented local TypeScript driver using an LX-16A-compatible protocol, while retaining the upstream-source and LX-16D hardware-verification cautions.
- Changed the demo entry point to `void main().catch((error) => console.error(error));`, so rejected setup, movement, or telemetry promises are reported. This does not add a loop, close the serial port, or change driver lifecycle ownership.

Fresh validation run:

```sh
npm test && npm run typecheck
```

Result: exited successfully (status 0). The test runner reported 31 tests, 31 passes, and 0 failures; `tsc` emitted no diagnostics. The environment again emitted the non-blocking npm warning `Unknown user config "min-release-age"`.
