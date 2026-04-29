const PREFIX = "eui-storage-fill-";
const DRAIN_PREFIX = "eui-storage-drain-";
const MAX_THRESHOLD = 99999;

exports.PREFIX = PREFIX;
exports.MAX_THRESHOLD = MAX_THRESHOLD;

function key(b, item) {
    return PREFIX + b.tile.x + "_" + b.tile.y + "-" + item.name;
}

function drainKey(b, item) {
    return DRAIN_PREFIX + b.tile.x + "_" + b.tile.y + "-" + item.name;
}

exports.getKey = key;
exports.getDrainKey = drainKey;

exports.getThreshold = function(b, item) {
    try {
        const raw = Core.settings.getString(key(b, item), "");
        if (!raw) return 0;
        const v = parseInt(raw);
        return isNaN(v) ? 0 : v;
    } catch (e) {
        return 0;
    }
}

exports.setThreshold = function(b, item, value) {
    const v = value | 0;
    if (v <= 0) {
        Core.settings.remove(key(b, item));
    } else {
        Core.settings.put(key(b, item), v + "");
    }
}

exports.countConfigured = function(b) {
    let count = 0;
    Vars.content.items().each(item => {
        if (exports.getThreshold(b, item) > 0 || exports.getDrain(b, item)) count++;
    });
    return count;
}

exports.getDrain = function(b, item) {
    return Core.settings.getBool(drainKey(b, item), false);
}

exports.setDrain = function(b, item, value) {
    if (value) {
        Core.settings.put(drainKey(b, item), true);
    } else {
        Core.settings.remove(drainKey(b, item));
    }
}

exports.countDrains = function(b) {
    let count = 0;
    Vars.content.items().each(item => {
        if (exports.getDrain(b, item)) count++;
    });
    return count;
}

// Pick an item this storage is configured to drain and currently has stock for.
// `coreAccepts` is an optional predicate (item -> bool) that filters by whether
// the core can still accept the item without overflow.
exports.findDrainItem = function(b, coreAccepts) {
    let result = null;
    Vars.content.items().each(item => {
        if (result) return;
        if (!exports.getDrain(b, item)) return;
        if (!b.items || b.items.get(item) <= 0) return;
        if (coreAccepts && !coreAccepts(item)) return;
        result = item;
    });
    return result;
}

exports.findNeededItem = function(b, coreSupply, minDeficit) {
    let result = null;
    Vars.content.items().each(item => {
        if (result) return;
        const threshold = exports.getThreshold(b, item);
        if (threshold <= 0) return;
        if (!b.items) return;
        const stock = b.items.get(item);
        if (stock >= threshold) return;
        if (minDeficit > 0 && (threshold - stock) < minDeficit) return;
        if (coreSupply && !coreSupply(item)) return;
        result = item;
    });
    return result;
}
