const ENABLED_PREFIX = "eui-consumer-enabled-";
const PRIORITY_PREFIX = "eui-consumer-priority-";
const EXPANDED_PREFIX = "eui-consumer-cat-expanded-";
const LEGACY_TURRET_PRIORITY_PREFIX = "eui-turret-priority-";
const MAX_PRIORITY = 999;
const FILL_PCT_KEY = "eui-consumer-fill-pct";
const DEFAULT_FILL_PCT = 50;

exports.MAX_PRIORITY = MAX_PRIORITY;
exports.DEFAULT_FILL_PCT = DEFAULT_FILL_PCT;
exports.CATEGORIES = ["turrets", "crafters", "unit-factories", "generators", "other"];

// Returns the configured fill threshold as a percentage of consumer
// capacity (0-100). The auto-pilot uses it to derive a per-block batch
// size: a 10-cap factory and a 100-cap one share one slider that scales
// to each, so the same setting works whether you have small or large
// consumers in the line.
exports.getFillPct = function() {
    const v = Core.settings.getInt(FILL_PCT_KEY, DEFAULT_FILL_PCT);
    if (v <= 0) return 1;
    if (v > 100) return 100;
    return v;
}

// Per-block batch size derived from the fill-pct slider.
// floor(cap * pct / 100), clamped to a minimum of 1 so blocks with tiny
// capacity (or unknown cap) still get a workable threshold.
exports.getMinAmountFor = function(block) {
    const cap = (block && block.itemCapacity) || 0;
    if (cap <= 0) return 1;
    return Math.max(1, Math.floor(cap * exports.getFillPct() / 100));
}

exports.isEnabled = function(block) {
    return Core.settings.getBool(ENABLED_PREFIX + block.name, true);
}

exports.setEnabled = function(block, value) {
    Core.settings.put(ENABLED_PREFIX + block.name, !!value);
}

exports.getPriority = function(block) {
    try {
        let raw = Core.settings.getString(PRIORITY_PREFIX + block.name, "");
        if (!raw) {
            raw = Core.settings.getString(LEGACY_TURRET_PRIORITY_PREFIX + block.name, "");
        }
        if (!raw) return 0;
        const v = parseInt(raw);
        return isNaN(v) ? 0 : v;
    } catch (e) {
        return 0;
    }
}

exports.setPriority = function(block, value) {
    const v = value | 0;
    if (v <= 0) {
        Core.settings.remove(PRIORITY_PREFIX + block.name);
    } else {
        Core.settings.put(PRIORITY_PREFIX + block.name, v + "");
    }
}

exports.isCategoryExpanded = function(category) {
    return Core.settings.getBool(EXPANDED_PREFIX + category, false);
}

exports.setCategoryExpanded = function(category, value) {
    Core.settings.put(EXPANDED_PREFIX + category, !!value);
}

exports.categorize = function(block) {
    try { if (block instanceof ItemTurret) return "turrets"; } catch (e) {}
    try { if (block instanceof UnitFactory) return "unit-factories"; } catch (e) {}
    try { if (block instanceof GenericCrafter) return "crafters"; } catch (e) {}
    try {
        const PG = Packages.mindustry.world.blocks.power.PowerGenerator;
        if (block instanceof PG) return "generators";
    } catch (e) {}
    return "other";
}

exports.consumesItems = function(block) {
    if (!block || !block.consumers) return false;
    try {
        return block.consumers.find(c =>
            c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic) != null;
    } catch (e) {
        return false;
    }
}
