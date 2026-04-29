const COOLDOWN_TICKS = 30;

let lastActiveTime = -COOLDOWN_TICKS - 1;

Events.run(Trigger.update, () => {
    if (isInputActive()) {
        lastActiveTime = Time.time;
    }
});

exports.isPlayerInteracting = function() {
    return Time.time - lastActiveTime < COOLDOWN_TICKS;
}

function isInputActive() {
    try {
        if (Core.input.keyDown(Binding.select)) return true;
        if (Core.input.keyDown(Binding.mine)) return true;
    } catch (e) {}
    try {
        const unit = Vars.player ? Vars.player.unit() : null;
        if (unit && unit.mining && unit.mining()) return true;
    } catch (e) {}
    return false;
}
