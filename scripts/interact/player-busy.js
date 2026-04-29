const SELECT_COOLDOWN_TICKS = 30;
const STEERING_COOLDOWN_TICKS = 90;

let lastSelectTime = -SELECT_COOLDOWN_TICKS - 1;
let lastSteeringTime = -STEERING_COOLDOWN_TICKS - 1;

Events.run(Trigger.update, () => {
    if (isSelectActive()) {
        lastSelectTime = Time.time;
        lastSteeringTime = Time.time;
        return;
    }
    if (isSteeringActive()) {
        lastSteeringTime = Time.time;
    }
});

function isSelectActive() {
    try {
        if (Core.input.keyDown(Binding.select)) return true;
    } catch (e) {}
    return false;
}

function isSteeringActive() {
    // Default WASD / arrow keys via physical scancodes (works regardless
    // of keyboard layout, doesn't need Binding to be reachable from Rhino).
    try {
        if (Core.input.keyDown(KeyCode.w)) return true;
        if (Core.input.keyDown(KeyCode.a)) return true;
        if (Core.input.keyDown(KeyCode.s)) return true;
        if (Core.input.keyDown(KeyCode.d)) return true;
        if (Core.input.keyDown(KeyCode.up)) return true;
        if (Core.input.keyDown(KeyCode.down)) return true;
        if (Core.input.keyDown(KeyCode.left)) return true;
        if (Core.input.keyDown(KeyCode.right)) return true;
    } catch (e) {}
    // Binding-based axes for users who remapped movement to other keys.
    try {
        if (Math.abs(Core.input.axis(Binding.move_x)) > 0.1) return true;
        if (Math.abs(Core.input.axis(Binding.move_y)) > 0.1) return true;
    } catch (e) {}
    // Mine / boost keys via Binding (so remaps are honoured).
    try {
        if (Core.input.keyDown(Binding.mine)) return true;
    } catch (e) {}
    try {
        if (Core.input.keyDown(Binding.boost)) return true;
    } catch (e) {}
    // Unit is actively mining a tile.
    try {
        const unit = Vars.player ? Vars.player.unit() : null;
        if (unit && unit.mining && unit.mining()) return true;
    } catch (e) {}
    return false;
}

exports.isPlayerInteracting = function() {
    return Time.time - lastSelectTime < SELECT_COOLDOWN_TICKS;
}

exports.isPlayerSteering = function() {
    return Time.time - lastSteeringTime < STEERING_COOLDOWN_TICKS;
}
