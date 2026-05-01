// Shared debug logger for the auto-pilot pipeline. Modules call make()
// with their own prefix; all loggers read the same eui-debug-autopilot
// toggle so one switch covers the whole chain.
function make(prefix, settingKey) {
    const key = settingKey || "eui-debug-autopilot";
    function enabled() {
        try { return Core.settings.getBool(key, false); } catch (e) { return false; }
    }
    function emit(s) { if (enabled()) try { log("[" + prefix + "] " + s); } catch (e) {} }
    function tag(b) {
        try { return b.block.name + "@" + b.tile.x + "," + b.tile.y; } catch (e) { return "?"; }
    }
    return { enabled: enabled, log: emit, tag: tag };
}

exports.make = make;
