import * as adc from "adc";
import * as gpio from "gpio";
import { GameLoop } from "game-loop";
import { Font } from "renderer";
import { Rectangle } from "shapes";
import { createSaturn, SaturnPins } from "saturn";


// const JOYSTICK_X_PIN = SaturnPins.Pmod3.Pin2;
// const JOYSTICK_Y_PIN = SaturnPins.Pmod3.Pin1;
// const ROTATE_BUTTON_PIN = SaturnPins.Pmod3.Pin6;
// const DROP_BUTTON_PIN = SaturnPins.Pmod3.Pin8;
// const PAUSE_BUTTON_PIN = SaturnPins.Pmod3.Pin7;
// const RESTART_BUTTON_PIN = SaturnPins.Pmod3.Pin5;


const JOYSTICK_X_PIN = SaturnPins.Pmod3.Pin6;
const JOYSTICK_Y_PIN = SaturnPins.Pmod3.Pin5;
const ROTATE_BUTTON_PIN = SaturnPins.Pmod1.Pin2;
const DROP_BUTTON_PIN = SaturnPins.Pmod1.Pin4;
const PAUSE_BUTTON_PIN = SaturnPins.Pmod1.Pin3;
const RESTART_BUTTON_PIN = SaturnPins.Pmod1.Pin2;

const BUTTON_ACTIVE_LOW = true;

const PANEL_WIDTH = 64;
const PANEL_HEIGHT = 64;
const COLS = 10;
const ROWS = 20;
const CELL_SIZE = 3;
const BOARD_X = Math.floor((PANEL_WIDTH - COLS * CELL_SIZE) / 2);
const BOARD_Y = Math.floor((PANEL_HEIGHT - ROWS * CELL_SIZE) / 2);

const JOYSTICK_CENTER = 512;
const JOYSTICK_DEADZONE = 220;
const DAS_MS = 150;
const ARR_MS = 45;
const SOFT_DROP_MS = 45;
const START_DROP_MS = 700;
const MIN_DROP_MS = 110;
const RESET_CONFIRM_MS = 2000;

type Cell = number | null;
type Direction = "left" | "right" | null;
type PieceTemplate = { shape: number[][]; color: number };
type Piece = PieceTemplate & { x: number; y: number; ghostColor: number };

const TETROMINOES: PieceTemplate[] = [
    { shape: [[1, 1, 1, 1]], color: 0x00ffff },
    { shape: [[1, 0, 0], [1, 1, 1]], color: 0x0000ff },
    { shape: [[0, 0, 1], [1, 1, 1]], color: 0xffa500 },
    { shape: [[1, 1], [1, 1]], color: 0xffff00 },
    { shape: [[0, 1, 1], [1, 1, 0]], color: 0x00ff00 },
    { shape: [[0, 1, 0], [1, 1, 1]], color: 0x800080 },
    { shape: [[1, 1, 0], [0, 1, 1]], color: 0xff0000 },
];

const saturn = createSaturn();
const loop = new GameLoop(saturn.display);
const font = new Font();
const scoreText = loop.drawText("0", 2, 2, font, 0xffffff);
const statusText = loop.drawText("", 2, 54, font, 0xffffff);

adc.configure(JOYSTICK_X_PIN);
adc.configure(JOYSTICK_Y_PIN);
for (const pin of [ROTATE_BUTTON_PIN, DROP_BUTTON_PIN, PAUSE_BUTTON_PIN, RESTART_BUTTON_PIN]) {
    gpio.pinMode(pin, gpio.PinMode.INPUT_PULLUP);
}

let board: Cell[][];
let piece: Piece;
let nextPiece: PieceTemplate;
let score: number;
let lines: number;
let paused: boolean;
let gameOver: boolean;
let gravityElapsed: number;
let horizontalElapsed: number;
let softDropElapsed: number;
let heldDirection: Direction;
let resetConfirmRemaining = 0;
let previousRotate = false;
let previousDrop = false;
let previousPause = false;
let previousRestart = false;
let sceneDirty = true;

function copyShape(shape: number[][]): number[][] {
    return shape.map((row) => [...row]);
}

function randomTemplate(): PieceTemplate {
    return TETROMINOES[Math.floor(Math.random() * TETROMINOES.length)];
}

function dimColor(color: number, factor: number): number {
    const red = Math.floor(((color >> 16) & 0xff) * factor);
    const green = Math.floor(((color >> 8) & 0xff) * factor);
    const blue = Math.floor((color & 0xff) * factor);
    return (red << 16) | (green << 8) | blue;
}

function rotate(shape: number[][]): number[][] {
    return shape[0].map((_, x) => shape.map((row) => row[x]).reverse());
}

function collides(candidate: Piece, x: number, y: number): boolean {
    for (let pieceY = 0; pieceY < candidate.shape.length; pieceY++) {
        for (let pieceX = 0; pieceX < candidate.shape[pieceY].length; pieceX++) {
            if (!candidate.shape[pieceY][pieceX]) continue;
            const boardX = x + pieceX;
            const boardY = y + pieceY;
            if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true;
            if (boardY >= 0 && board[boardY][boardX] !== null) return true;
        }
    }
    return false;
}

function ghostY(): number {
    let y = piece.y;
    while (!collides(piece, piece.x, y + 1)) y++;
    return y;
}

function spawnPiece(): void {
    const template = nextPiece;
    piece = {
        shape: copyShape(template.shape),
        color: template.color,
        ghostColor: dimColor(template.color, 0.35),
        x: Math.floor(COLS / 2) - Math.floor(template.shape[0].length / 2),
        y: 0,
    };
    nextPiece = randomTemplate();
    gameOver = collides(piece, piece.x, piece.y);
}

function startGame(): void {
    board = Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
    score = 0;
    lines = 0;
    paused = false;
    gameOver = false;
    gravityElapsed = 0;
    horizontalElapsed = 0;
    softDropElapsed = 0;
    heldDirection = null;
    resetConfirmRemaining = 0;
    nextPiece = randomTemplate();
    spawnPiece();
    sceneDirty = true;
}

function move(dx: number, dy: number): boolean {
    if (collides(piece, piece.x + dx, piece.y + dy)) return false;
    piece.x += dx;
    piece.y += dy;
    sceneDirty = true;
    return true;
}

function mergePiece(): void {
    for (let y = 0; y < piece.shape.length; y++) {
        for (let x = 0; x < piece.shape[y].length; x++) {
            if (piece.shape[y][x] && piece.y + y >= 0) {
                board[piece.y + y][piece.x + x] = piece.color;
            }
        }
    }
}

function clearLines(): number {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
        if (board[y].every((cell) => cell !== null)) {
            board.splice(y, 1);
            board.unshift(Array<Cell>(COLS).fill(null));
            cleared++;
            y++;
        }
    }
    return cleared;
}

function lockPiece(): void {
    mergePiece();
    const cleared = clearLines();
    const points = [0, 100, 300, 500, 800];
    score += points[cleared];
    lines += cleared;
    spawnPiece();
    gravityElapsed = 0;
    sceneDirty = true;
}

function hardDrop(): void {
    piece.y = ghostY();
    lockPiece();
}

function readButton(pin: number): boolean {
    const high = gpio.read(pin) === 1;
    return BUTTON_ACTIVE_LOW ? !high : high;
}

function readJoystick(): { direction: Direction; up: boolean; down: boolean } {
    const x = adc.read(JOYSTICK_X_PIN) - JOYSTICK_CENTER;
    const y = adc.read(JOYSTICK_Y_PIN) - JOYSTICK_CENTER;
    const horizontal = Math.abs(x) >= Math.abs(y);
    return {
        direction: horizontal && Math.abs(x) > JOYSTICK_DEADZONE ? (x < 0 ? "left" : "right") : null,
        up: !horizontal && y < -JOYSTICK_DEADZONE,
        down: !horizontal && y > JOYSTICK_DEADZONE,
    };
}

function updateHorizontal(direction: Direction, delta: number): void {
    if (direction === null) {
        heldDirection = null;
        horizontalElapsed = 0;
        return;
    }
    const dx = direction === "left" ? -1 : 1;
    if (direction !== heldDirection) {
        heldDirection = direction;
        horizontalElapsed = 0;
        move(dx, 0);
        return;
    }
    horizontalElapsed += delta;
    if (horizontalElapsed < DAS_MS) return;
    while (horizontalElapsed >= DAS_MS + ARR_MS) {
        horizontalElapsed -= ARR_MS;
        move(dx, 0);
    }
}

function drawBlock(x: number, y: number, color: number, fill = true): void {
    loop.addShape(new Rectangle({
        x: BOARD_X + x * CELL_SIZE,
        y: BOARD_Y + y * CELL_SIZE,
        width: CELL_SIZE,
        height: CELL_SIZE,
        color,
        fill,
    }));
}

function render(): void {
    loop.scene.clear();
    loop.addShape(new Rectangle({
        x: BOARD_X - 1,
        y: BOARD_Y - 1,
        width: COLS * CELL_SIZE + 2,
        height: ROWS * CELL_SIZE + 2,
        color: 0x323232,
        fill: false,
    }));
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (board[y][x] !== null) drawBlock(x, y, board[y][x]!);
        }
    }
    if (!gameOver) {
        const landingY = ghostY();
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x]) {
                    drawBlock(piece.x + x, landingY + y, piece.ghostColor, false);
                    drawBlock(piece.x + x, piece.y + y, piece.color);
                }
            }
        }
    }
    const previewX = BOARD_X + COLS * CELL_SIZE + 4;
    const previewY = BOARD_Y + 6;
    for (let y = 0; y < nextPiece.shape.length; y++) {
        for (let x = 0; x < nextPiece.shape[y].length; x++) {
            if (nextPiece.shape[y][x]) {
                loop.addShape(new Rectangle({
                    x: previewX + x * CELL_SIZE,
                    y: previewY + y * CELL_SIZE,
                    width: CELL_SIZE,
                    height: CELL_SIZE,
                    color: nextPiece.color,
                    fill: true,
                }));
            }
        }
    }
    scoreText.text = String(score);
    statusText.text = resetConfirmRemaining > 0
        ? "RESET ZNOVU"
        : gameOver ? "GAME OVER" : paused ? "PAUSE" : `L${lines}`;
    sceneDirty = false;
}

startGame();

loop.on("tick", (rawDelta) => {
    // A paused debugger can create a huge delta; never make a piece skip the board.
    const delta = Math.min(rawDelta, 100);
    const joystick = readJoystick();
    const rotatePressed = joystick.up || readButton(ROTATE_BUTTON_PIN);
    const dropPressed = readButton(DROP_BUTTON_PIN);
    const pausePressed = readButton(PAUSE_BUTTON_PIN);
    const restartPressed = readButton(RESTART_BUTTON_PIN);

    if (resetConfirmRemaining > 0) {
        resetConfirmRemaining = Math.max(0, resetConfirmRemaining - delta);
        if (resetConfirmRemaining === 0) sceneDirty = true;
    }
    if (restartPressed && !previousRestart) {
        if (resetConfirmRemaining > 0) {
            startGame();
        } else {
            resetConfirmRemaining = RESET_CONFIRM_MS;
            sceneDirty = true;
        }
    }
    if (pausePressed && !previousPause && !gameOver) {
        paused = !paused;
        sceneDirty = true;
    }
    if (!paused && !gameOver) {
        if (rotatePressed && !previousRotate) {
            const rotated = rotate(piece.shape);
            if (!collides({ ...piece, shape: rotated }, piece.x, piece.y)) {
                piece.shape = rotated;
                sceneDirty = true;
            }
        }
        if (dropPressed && !previousDrop) hardDrop();

        updateHorizontal(joystick.direction, delta);
        if (joystick.down) {
            softDropElapsed += delta;
            if (softDropElapsed >= SOFT_DROP_MS) {
                move(0, 1);
                softDropElapsed = 0;
            }
        } else {
            softDropElapsed = 0;
        }
        gravityElapsed += delta;
        const dropInterval = Math.max(MIN_DROP_MS, START_DROP_MS - lines * 25);
        if (gravityElapsed >= dropInterval) {
            gravityElapsed = 0;
            if (!move(0, 1)) lockPiece();
        }
    }
    previousRotate = rotatePressed;
    previousDrop = dropPressed;
    previousPause = pausePressed;
    previousRestart = restartPressed;
    if (sceneDirty) render();
});
