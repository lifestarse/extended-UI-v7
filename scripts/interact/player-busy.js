const SELECT_COOLDOWN_TICKS = 30;

let lastSelectTime = -SELECT_COOLDOWN_TICKS - 1;

Events.run(Trigger.update, () => {
    try {
        if (Core.input.keyDown(Binding.select)) {
            lastSelectTime = Time.time;
        }
    } catch (e) {}
});

// True while Binding.select is held (or just released, within cooldown).
// Inventory script actions race with manual taps on buildings, drag-build,
// and drag-mine setup -- so they should pause while this is true.
exports.isPlayerInteracting = function() {
    return Time.time - lastSelectTime < SELECT_COOLDOWN_TICKS;
}

// True if the player is actively steering the unit by any means
// (Binding.select, mine key, WASD/move axes, or the unit is mining a tile).
// Used by auto-pilot, which fights with manual movement / mining position.
exports.isPlayerSteering = function() {
    if (exports.isPlayerInteracting()) return true;
    try {
        if (Core.input.keyDown(Binding.mine)) return true;
        if (Math.abs(Core.input.axis(Binding.move_x)) > 0.1) return true;
        if (Math.abs(Core.input.axis(Binding.move_y)) > 0.1) return true;
    } catch (e) {}
    try {
        const unit = Vars.player ? Vars.player.unit() : null;
        if (unit && unit.mining && unit.mining()) return true;
    } catch (e) {}
    return false;
}
