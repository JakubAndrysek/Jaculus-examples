export function steeringFromTilt(accelerationX) {
    if (accelerationX > 0.22) return 1;
    if (accelerationX < -0.22) return -1;
    return 0;
}

export function advanceMeteor(meteor, delta, lane) {
    const y = meteor.y + meteor.speed * delta / 1000;
    if (y <= 64) return { ...meteor, y };
    return { ...meteor, x: lane, y: -5 };
}
