const SELECT_COOLDOWN_TICKS = 30;
const STEERING_COOLDOWN_TICKS = 90;

let lastSelectTime = -SELECT_COOLDOWN_TICKS - 1;
let lastSteeringTime = -STEERING_COOLDOWN_TICKS - 1;

Events.run(Trigger.update, () => {
    let select = false;
    let steering = false;

    try {
        if (Core.input.keyDown(Binding.select)) {
            select = true;
            steering = true;
        }
    } catch (e) {}

    if (!steering) {
        try {
            if (Core.input.keyDown(Binding.mine)) steering = true;
        } catch (e) {}
    }
    if (!steering) {
        try {
            if (Math.abs(Core.input.axis(Binding.move_x)) > 0.1) steering = true;
            else if (Math.abs(Core.input.axis(Binding.move_y)) > 0.1) steering = true;
        } catch (e) {}
    }
    if (!steering) {
        try {
            const unit = Vars.player ? Vars.player.unit() : null;
            if (unit && unit.mining && unit.mining()) steering = true;
        } catch (e) {}
    }

    if (select) lastSelectTime = Time.time;
    if (steering) lastSteeringTime = Time.time;
});

// True while/just-after Binding.select is held -- used by inventory script
// actions (auto-fill, auto-collect, storage-fill) to avoid racing with the
// player's manual transferInventory clicks. Short cooldown (~0.5s).
exports.isPlayerInteracting = function() {
    return Time.time - lastSelectTime < SELECT_COOLDOWN_TICKS;
}

// True if the player did any kind of unit-steering input recently (select,
// mine, WASD, or unit.mining()). Used by auto-pilot. Longer cooldown
// (~1.5s) so the player gets a clear stretch of manual control after
// touching the keys -- otherwise autopilot's moveAt jumps back in on the
// next tick and feels like a tug-of-war.
exports.isPlayerSteering = function() {
    return Time.time - lastSteeringTime < STEERING_COOLDOWN_TICKS;
}
