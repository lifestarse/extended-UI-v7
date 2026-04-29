const ENABLED_PREFIX = "eui-consumer-enabled-";
const PRIORITY_PREFIX = "eui-consumer-priority-";
const EXPANDED_PREFIX = "eui-consumer-cat-expanded-";
const LEGACY_TURRET_PRIORITY_PREFIX = "eui-turret-priority-";
const MAX_PRIORITY = 999;
const MIN_AMOUNT_KEY = "eui-auto-fill-min-amount";
const DEFAULT_MIN_AMOUNT = 5;

exports.MAX_PRIORITY = MAX_PRIORITY;
exports.DEFAULT_MIN_AMOUNT = DEFAULT_MIN_AMOUNT;
exports.CATEGORIES = ["turrets", "crafters", "unit-factories", "generators", "other"];

exports.getMinAmount = function() {
    const v = Core.settings.getInt(MIN_AMOUNT_KEY, DEFAULT_MIN_AMOUNT);
    return v > 0 ? v : DEFAULT_MIN_AMOUNT;
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
