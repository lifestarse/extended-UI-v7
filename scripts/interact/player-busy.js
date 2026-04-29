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

// True only while the player is actively steering the unit right now.
// No cooldown -- the only requirement is "don't move the unit on the
// same tick as the player".
exports.isPlayerSteering = function() {
    if (exports.isPlayerInteracting()) return true;

    // [primary] InputHandler's computed movement intent vector. This is
    // populated by DesktopInput (from Binding.move_x/y axes, regardless
    // of remapping), by mouse-follow mode (vector toward cursor), and by
    // gamepad sticks. If non-zero, the player is steering somehow that
    // would normally drive moveAt on this same tick.
    try {
        const ih = Vars.control ? Vars.control.input : null;
        if (ih && ih.movement && (Math.abs(ih.movement.x) > 0.1 || Math.abs(ih.movement.y) > 0.1)) return true;
    } catch (e) {}

    // [mobile] On phones / tablets there are no key axes. MobileInput
    // moves the player by setting a destination on tap; check the unit's
    // moving flag if available, plus a few likely fields.
    try {
        if (Vars.mobile) {
            const unit = Vars.player.unit();
            if (unit) {
                if (unit.isFlying && typeof unit.moving === "function" && unit.moving()) return true;
                if (typeof unit.isShooting === "function" && unit.isShooting()) return true;
            }
            const ih = Vars.control ? Vars.control.input : null;
            if (ih && ih.lineMode) return true;
            if (ih && ih.selectedUnit) return true;
        }
    } catch (e) {}

    // [desktop fallback] Default WASD / arrow keys via physical scancodes.
    // Works on any keyboard layout for the default mapping without
    // depending on the Binding API round-tripping through Rhino.
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

    // [remap fallback] Binding axes if they happen to round-trip --
    // covers users who remapped to keys outside the WASD/arrows set.
    try {
        if (Math.abs(Core.input.axis(Binding.move_x)) > 0.1) return true;
        if (Math.abs(Core.input.axis(Binding.move_y)) > 0.1) return true;
    } catch (e) {}

    // [mouse-follow fallback] Even if the InputHandler.movement read
    // didn't land, "follow cursor" mode is detectable by checking the
    // setting and the cursor distance from the unit.
    try {
        if (Core.settings.getBool("mousemove", false) || Core.settings.getBool("mouseMove", false)) {
            const unit = Vars.player.unit();
            if (unit) {
                const m = Core.input.mouseWorld();
                const dx = m.x - unit.x;
                const dy = m.y - unit.y;
                // ~3 tiles -- if cursor is right on top of unit there's
                // no real steering intent, otherwise count it.
                if (dx * dx + dy * dy > Vars.tilesize * Vars.tilesize * 9) return true;
            }
        }
    } catch (e) {}

    // [bindings] Mine / boost so remaps are honoured.
    try {
        if (Core.input.keyDown(Binding.mine)) return true;
    } catch (e) {}
    try {
        if (Core.input.keyDown(Binding.boost)) return true;
    } catch (e) {}

    // [state] Unit is actively mining a tile.
    try {
        const unit = Vars.player ? Vars.player.unit() : null;
        if (unit && unit.mining && unit.mining()) return true;
    } catch (e) {}
    return false;
}
