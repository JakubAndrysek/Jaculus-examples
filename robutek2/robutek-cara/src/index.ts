
import { createRobutek } from "robutek"
const robutek = createRobutek("V2");

const setpoint = 512;
let speed = 500;
let k_p = 0.96;
let k_d = 4.86;

function move(steering: number, speed: number) {
    if(steering < 0) {
        robutek.leftMotor.setSpeed((1 + steering) * speed)
        robutek.rightMotor.setSpeed(speed)
    } else if(steering > 0) {
        robutek.rightMotor.setSpeed((1 - steering) * speed)
        robutek.leftMotor.setSpeed(speed)
    }
}

async function main() {
    let previous_error = 0;
    robutek.leftMotor.move()
    robutek.rightMotor.move()
    console.log("start")
    while(true) {
        const l = robutek.readSensor("LineFR");
        let error = setpoint - l;
        let normalized_error = error / 512;
        let speed_of_change = normalized_error - previous_error;
        move(normalized_error * k_p + speed_of_change * k_d, speed);
        previous_error = normalized_error;
        await sleep(1);
    }
}

main().catch(console.error);