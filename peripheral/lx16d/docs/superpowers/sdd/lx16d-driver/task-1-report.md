# Task 1 Report: Test harness and frame codec

## Scope completed

Implemented only the Task 1 protocol codec and test harness. No bus, serial I/O, servo facade, `src/index.ts`, design, plan, research note, or demo was changed.

## Files changed

- `package.json`
  - Added `tsx` and `typescript` development dependencies.
  - Added `test` and source-scoped `typecheck` scripts.
- `src/lx16d.ts`
  - Added the `Lx16dCommand` enum for upstream LX-16 command IDs used by later tasks.
  - Added `Lx16dError` with `header`, `length`, and `checksum` kinds.
  - Added `encodeFrame` and `decodeFrame`, including header, length, and checksum validation.
  - Added internal signed and unsigned little-endian codec helpers.
- `test/lx16d.test.ts`
  - Added codec tests for the specified movement frame, decoding, checksum rejection, and declared-length rejection.
- `docs/superpowers/sdd/lx16d-driver/task-1-report.md`
  - This report.

## TDD evidence

### Failing test before implementation

Command:

```sh
npm test -- test/lx16d.test.ts
```

Output:

```text
> template-jaculus@0.1.0 test
> tsx --test test/**/*.test.ts test/lx16d.test.ts

/Users/kuba/Documents/git/robo/RoboCamp-24/robutek-test/servo/test/lx16d.test.ts:4
import { Lx16dCommand, Lx16dError, decodeFrame, encodeFrame } from "../src/lx16d.js";
         ^
SyntaxError: The requested module '../src/lx16d.js' does not provide an export named 'Lx16dCommand'

✖ test/lx16d.test.ts
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

This was the expected missing-export failure from the initially empty `src/lx16d.ts`.

## Final validation

Command:

```sh
npm test -- test/lx16d.test.ts && npm run typecheck
```

Output:

```text
> template-jaculus@0.1.0 test
> tsx --test test/**/*.test.ts test/lx16d.test.ts

✔ encodes a move frame with the LX-16 checksum
✔ decodes a complete frame into its protocol fields
✔ rejects a frame with an invalid checksum
✔ rejects a frame whose declared length differs from its byte count
ℹ tests 4
ℹ pass 4
ℹ fail 0

> template-jaculus@0.1.0 typecheck
> tsc --noEmit --target es2023 --module nodenext --lib es2023 --moduleResolution nodenext --types jaculus --rootDir src src/*.ts
```

## Test count

- 4 tests passed.

## Concerns

- `npm` prints an environment-level warning about the unsupported `min-release-age` user config. It does not affect test or type-check exit status.
- The type-check script explicitly supplies the existing TypeScript compiler settings and `src/*.ts` so production type checking excludes Node-only test types without modifying `tsconfig.json`, which is outside Task 1's authorized modification paths.

---

# Task 1 Review-Finding Fix Report

## Review findings addressed

1. Exported `readU16LE`, `readI16LE`, `writeU16LE`, and `writeI16LE` as a deliberate public codec surface for later driver tasks, then added behavioral tests for signed and unsigned little-endian reads and writes.
2. Changed `decodeFrame` validation order: it now validates the two-byte header first, then reports header-valid frames that lack enough bytes to declare or fulfill their length as `Lx16dError` kind `length`.
3. Added tests for frames missing either required header byte.
4. Replaced the non-recursive `src/*.ts` TypeScript input with recursive `find src -type f -name '*.ts'` discovery. This includes future files anywhere under `src/` and continues to exclude `test/`.

## Files changed for review fixes

- `package.json`
  - Updated `typecheck` to recursively discover only `.ts` files under `src/`.
- `src/lx16d.ts`
  - Exported the LE codec helpers.
  - Corrected header-versus-length error classification for truncated frames.
- `test/lx16d.test.ts`
  - Added six regression tests: two header/length-validation tests and four signed/unsigned LE codec tests.
- `docs/superpowers/sdd/lx16d-driver/task-1-report.md`
  - Appended this fix report.

## Failing-test evidence before the fix

Command:

```sh
npm test -- test/lx16d.test.ts
```

Output:

```text
SyntaxError: The requested module '../src/lx16d.js' does not provide an export named 'readI16LE'

✖ test/lx16d.test.ts
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

The new tests failed because the requested intentional codec surface was not exported.

## Passing validation

Command:

```sh
npm test -- test/lx16d.test.ts && npm run typecheck
```

Output:

```text
✔ encodes a move frame with the LX-16 checksum
✔ decodes a complete frame into its protocol fields
✔ rejects a frame with an invalid checksum
✔ rejects a frame whose declared length differs from its byte count
✔ rejects frames without exactly two header bytes
✔ rejects a header-valid truncated frame as a length error
✔ reads an unsigned 16-bit little-endian value
✔ reads a signed 16-bit little-endian value
✔ writes an unsigned 16-bit little-endian value
✔ writes a signed 16-bit little-endian value
ℹ tests 10
ℹ pass 10
ℹ fail 0

> template-jaculus@0.1.0 typecheck
> find src -type f -name '*.ts' -print0 | xargs -0 tsc --noEmit --target es2023 --module nodenext --lib es2023 --moduleResolution nodenext --types jaculus --rootDir src
```

## Test count

- 10 tests passed.

## Concerns

- `npm` continues to print the environment-level warning about the unsupported `min-release-age` user config. It does not affect the test or type-check exit status.
