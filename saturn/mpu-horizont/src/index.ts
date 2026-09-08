import { GameLoop } from "game-loop";
import { MPU6050 } from "mpu6050";
import { Font } from "renderer";
import { Circle, Polygon, Rectangle } from "shapes";
import { createSaturn, SaturnPins } from "saturn";
import { I2C1 } from "i2c";
import { advanceMeteor, steeringFromTilt } from "./game-logic.js";

I2C1.setup({ sda: SaturnPins.uSupB.SDA, scl: SaturnPins.uSupB.SCL, bitrate: 400000 });
const mpu = new MPU6050(I2C1);

const WIDTH = 64;
const HEIGHT = 64;
const PLAYER_Y = 54;
const PLAYER_RADIUS = 4;
const CALIBRATION_SAMPLES = 24;
const DEBUG_INTERVAL_MS = 500;

type Meteor = { x: number; y: number; speed: number; size: number; color: number };

const saturn = createSaturn();
const loop = new GameLoop(saturn.display);
const font = new Font();
const title = loop.drawText("TILT RUN", 2, 1, font, 0x7cf7ff);
const scoreLabel = loop.drawText("000", 48, 1, font, 0xffffff);
const hint = loop.drawText("KALIBRACE", 7, 29, font, 0xffd166);

const stars = Array.from({ length: 22 }, (_, index) => ({
    x: (index * 23 + 7) % WIDTH,
    y: (index * 37 + 11) % HEIGHT,
    size: index % 6 === 0 ? 2 : 1,
    color: index % 4 === 0 ? 0x4960a8 : 0x172554,
}));

let calibrationTotal = 0;
let calibrationCount = 0;
let tiltOffset = 0;
let playerX = WIDTH / 2;
let score = 0;
let elapsed = 0;
let gameOver = false;
let gameOverElapsed = 0;
let meteors: Meteor[] = [];
let sceneDirty = true;
let debugElapsed = 0;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function randomMeteor(index: number): Meteor {
    return {
        x: 5 + Math.floor(Math.random() * 54),
        y: -8 - index * 15,
        speed: 18 + Math.random() * 15,
        size: 2 + Math.floor(Math.random() * 3),
        color: [0xff4d6d, 0xff9f1c, 0xff6b35][index % 3],
    };
}

function resetGame(): void {
    playerX = WIDTH / 2;
    score = 0;
    elapsed = 0;
    gameOver = false;
    gameOverElapsed = 0;
    meteors = Array.from({ length: 4 }, (_, index) => randomMeteor(index));
    hint.text = "NAKLAPEJ DO STRAN";
    sceneDirty = true;
}

function hitMeteor(meteor: Meteor): boolean {
    const dx = meteor.x - playerX;
    const dy = meteor.y - PLAYER_Y;
    const radius = PLAYER_RADIUS + meteor.size;
    return dx * dx + dy * dy < radius * radius;
}

function drawShip(): void {
    loop.addShape(new Circle({ x: playerX, y: PLAYER_Y + 2, radius: 6, color: 0x103a5c, fill: true }));
    loop.addShape(new Polygon({ x: playerX, y: PLAYER_Y, color: 0xff8c42, vertices: [[-2, 4], [0, 9], [2, 4]], fill: true }));
    loop.addShape(new Polygon({ x: playerX, y: PLAYER_Y, color: 0x7cf7ff, vertices: [[0, -7], [-5, 5], [0, 3], [5, 5]], fill: true }));
}

function render(): void {
    loop.scene.clear();
    loop.addShape(new Rectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, color: 0x020617, fill: true }));
    for (const star of stars) {
        const y = (star.y + Math.floor(elapsed / 45) * star.size) % HEIGHT;
        loop.addShape(new Rectangle({ x: star.x, y, width: star.size, height: star.size, color: star.color, fill: true }));
    }
    loop.addShape(new Rectangle({ x: 0, y: 10, width: WIDTH, height: 1, color: 0x0e7490, fill: true }));
    for (const meteor of meteors) {
        loop.addShape(new Circle({ x: meteor.x, y: meteor.y, radius: meteor.size + 1, color: 0x431227, fill: true }));
        loop.addShape(new Circle({ x: meteor.x, y: meteor.y, radius: meteor.size, color: meteor.color, fill: true }));
        loop.addShape(new Circle({ x: meteor.x - 1, y: meteor.y - 1, radius: 1, color: 0xffd6a5, fill: true }));
    }
    drawShip();
    scoreLabel.text = String(Math.floor(score)).padStart(3, "0");
    title.text = gameOver ? "CRASH!" : "TILT RUN";
    sceneDirty = false;
}

function updateCalibration(accelerationX: number): boolean {
    if (calibrationCount >= CALIBRATION_SAMPLES) return true;
    calibrationTotal += accelerationX;
    calibrationCount++;
    if (calibrationCount === CALIBRATION_SAMPLES) {
        tiltOffset = calibrationTotal / CALIBRATION_SAMPLES;
        resetGame();
    }
    return calibrationCount >= CALIBRATION_SAMPLES;
}

function logTelemetry(accelerationX: number, steering: number): void {
    console.log(
        `MPU x=${accelerationX.toFixed(2)} offset=${tiltOffset.toFixed(2)} steer=${steering} ` +
        `player=${playerX.toFixed(1)} score=${Math.floor(score)} state=${gameOver ? "CRASH" : "RUN"}`,
    );
}

loop.on("tick", (rawDelta) => {
    const delta = Math.min(rawDelta, 80);
    const [accelerationX] = mpu.getAcceleration();
    debugElapsed += delta;
    if (!updateCalibration(accelerationX)) {
        hint.text = `KALIBRACE ${Math.floor(calibrationCount * 100 / CALIBRATION_SAMPLES)}%`;
        sceneDirty = true;
    } else {
        const steering = steeringFromTilt(accelerationX - tiltOffset);
        if (debugElapsed >= DEBUG_INTERVAL_MS) {
            logTelemetry(accelerationX, steering);
            debugElapsed = 0;
        }
        if (gameOver) {
            gameOverElapsed += delta;
            hint.text = "NAKLON PRO NOVOU HRU";
            if (gameOverElapsed > 700 && steering !== 0) resetGame();
        } else {
            elapsed += delta;
            score += delta / 100;
            playerX = clamp(playerX + steering * delta * 0.055, PLAYER_RADIUS + 1, WIDTH - PLAYER_RADIUS - 1);
            meteors = meteors.map((meteor, index) => {
                const next = advanceMeteor(meteor, delta, 5 + Math.floor(Math.random() * 54));
                return next.y === -5 ? randomMeteor(index) : next;
            });
            if (meteors.some(hitMeteor)) {
                gameOver = true;
                gameOverElapsed = 0;
                hint.text = "CRASH!";
            }
        }
        sceneDirty = true;
    }
    if (sceneDirty) render();
});
