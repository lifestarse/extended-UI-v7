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
//
// For ItemTurrets the relevant cap is ammo, not items: maxAmmo is in
// ammo-units and each item produces ammoMultiplier ammo-units, so the
// item-equivalent capacity is maxAmmo / ammoMultiplier. When the caller
// knows which item the drone is delivering we use the matching turret
// multiplier; otherwise we fall back to itemCapacity (which on most
// turrets is the default 10) so the threshold is at least workable.
exports.getMinAmountFor = function(block, item) {
    if (!block) return 1;
    let cap = 0;
    try {
        if (block instanceof ItemTurret && block.maxAmmo > 0 && block.ammoTypes) {
            if (item != null) {
                const ammoType = block.ammoTypes.get(item);
                if (ammoType && ammoType.ammoMultiplier > 0) {
                    cap = Math.floor(block.maxAmmo / ammoType.ammoMultiplier);
                }
            }
        }
    } catch (e) {}
    if (cap <= 0) cap = block.itemCapacity || 0;
    if (cap <= 0) return 1;
    return Math.max(1, Math.floor(cap * exports.getFillPct() / 100));
}

// Same as getMinAmountFor but never exceeds the drone's own item
// capacity. Without this clamp a high-cap consumer (multi-press,
// silicon crucible — both cap=30) requires more room than a small
// drone can ever deliver in one trip (Mono cap=4, Poly cap=12), so
// the autopilot's findBestConsumer / auto-fill loop never matches it
// and the drone never visits.
exports.getDeliverableMinFor = function(block, item, droneCap) {
    const v = exports.getMinAmountFor(block, item);
    return (droneCap > 0 && v > droneCap) ? droneCap : v;
}

// Item-equivalent capacity for a block — handles ItemTurret ammo math
// the same way getMinAmountFor does, but returns the raw cap instead
// of the percentage-derived batch size.
exports.getCapacityFor = function(block, item) {
    if (!block) return 0;
    let cap = 0;
    try {
        if (block instanceof ItemTurret && block.maxAmmo > 0 && block.ammoTypes) {
            if (item != null) {
                const ammoType = block.ammoTypes.get(item);
                if (ammoType && ammoType.ammoMultiplier > 0) {
                    cap = Math.floor(block.maxAmmo / ammoType.ammoMultiplier);
                }
            }
        }
    } catch (e) {}
    if (cap <= 0) cap = block.itemCapacity || 0;
    return cap;
}

// Stock level the drone is supposed to keep this consumer at:
// floor(cap * fillPct / 100). Drone visits when current stock falls
// below this; isStale fires when stock climbs back to or above it.
exports.getTargetFill = function(block, item) {
    const cap = exports.getCapacityFor(block, item);
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
