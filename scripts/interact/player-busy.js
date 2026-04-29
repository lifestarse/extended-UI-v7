// True only while the player has Binding.select held right now.
// Used by inventory script actions (auto-fill, auto-collect, storage-fill)
// so a manual transferInventory click doesn't race with a scripted Call
// on the same tick. No cooldown -- once the button is released the
// scripts can act on the very next tick.
exports.isPlayerInteracting = function() {
    try {
        if (Core.input.keyDown(Binding.select)) return true;
    } catch (e) {}
    return false;
}

// True only while the player is actively steering the unit right now
// (movement key, mine key, boost, or unit.mining()). Used by auto-pilot
// so it doesn't call moveAt on the same tick as the player's own input.
// No cooldown -- the only requirement is "don't move the unit at the
// same time as the player".
exports.isPlayerSteering = function() {
    if (exports.isPlayerInteracting()) return true;
    // Default WASD / arrow keys via physical scancodes -- works on any
    // keyboard layout for the default mapping without depending on the
    // Binding API round-tripping correctly through Rhino.
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
    // Binding axes for users who remapped movement to other keys.
    try {
        if (Math.abs(Core.input.axis(Binding.move_x)) > 0.1) return true;
        if (Math.abs(Core.input.axis(Binding.move_y)) > 0.1) return true;
    } catch (e) {}
    // Mine / boost via Binding so remaps are honoured.
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
