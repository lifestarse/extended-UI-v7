const FACTORY_KEY_PREFIX = "eui-collect-factory-";
const DRILL_KEY_PREFIX = "eui-collect-drill-";

exports.FACTORY_KEY_PREFIX = FACTORY_KEY_PREFIX;
exports.DRILL_KEY_PREFIX = DRILL_KEY_PREFIX;

exports.isFactoryEnabled = function(block) {
    return Core.settings.getBool(FACTORY_KEY_PREFIX + block.name, false);
}

exports.setFactoryEnabled = function(block, value) {
    Core.settings.put(FACTORY_KEY_PREFIX + block.name, !!value);
}

exports.isDrillItemEnabled = function(item) {
    return Core.settings.getBool(DRILL_KEY_PREFIX + item.name, false);
}

exports.setDrillItemEnabled = function(item, value) {
    Core.settings.put(DRILL_KEY_PREFIX + item.name, !!value);
}

// % of the producer's *achievable* output cap. For a GenericCrafter
// the output buffer never reaches itemCapacity in practice — the
// crafter stalls one craft cycle before that (next craft would
// overflow itemCapacity, so it can't run). The steady-state max for
// the matching output is itemCapacity - craftAmount: at that stock
// the next craft can still fit, then briefly hits cap and gets pulled
// back down. silicon-crucible has itemCapacity=30 and silicon
// craftAmount=6, so silicon caps at 24 — a 100 % slider must trigger
// at 24, not 30, otherwise the drone never collects from it. Drills
// (no craftAmount) keep using itemCapacity directly; producing 1 unit
// at a time, they really do reach cap before stalling.
exports.getPickupThreshold = function(block, item) {
    if (!block) return 1;
    const baseCap = block.itemCapacity || 1;
    let effective = baseCap;
    if (item) {
        try {
            if (block instanceof GenericCrafter && block.outputItems) {
                for (let i = 0; i < block.outputItems.length; i++) {
                    const out = block.outputItems[i];
                    if (out.item === item) {
                        effective = Math.max(1, baseCap - out.amount);
                        break;
                    }
                }
            }
        } catch (e) {}
    }
    const percent = Core.settings.getInt("eui-collect-threshold", 50);
    const t = Math.floor(effective * percent / 100);
    return t < 1 ? 1 : t;
}
