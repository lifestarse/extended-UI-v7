const PREFIX = "eui-storage-fill-";
const DRAIN_PREFIX = "eui-storage-drain-";
const PRIORITY_PREFIX = "eui-storage-priority-";
const MAX_THRESHOLD = 99999;
const MAX_PRIORITY = 999;

exports.PREFIX = PREFIX;
exports.DRAIN_PREFIX = DRAIN_PREFIX;
exports.PRIORITY_PREFIX = PRIORITY_PREFIX;
exports.MAX_THRESHOLD = MAX_THRESHOLD;
exports.MAX_PRIORITY = MAX_PRIORITY;

function key(b, item) {
    return PREFIX + b.tile.x + "_" + b.tile.y + "-" + item.name;
}

function drainKey(b, item) {
    return DRAIN_PREFIX + b.tile.x + "_" + b.tile.y + "-" + item.name;
}

function priorityKey(b) {
    return PRIORITY_PREFIX + b.tile.x + "_" + b.tile.y;
}

exports.getKey = key;
exports.getDrainKey = drainKey;
exports.getPriorityKey = priorityKey;

exports.getPriority = function(b) {
    try {
        const raw = Core.settings.getString(priorityKey(b), "");
        if (!raw) return 0;
        const v = parseInt(raw);
        return isNaN(v) ? 0 : v;
    } catch (e) {
        return 0;
    }
}

exports.setPriority = function(b, value) {
    const v = value | 0;
    if (v <= 0) {
        Core.settings.remove(priorityKey(b));
    } else {
        Core.settings.put(priorityKey(b), v + "");
    }
}

// Snapshot of every per-item config a storage holds. Used for the
// copy/paste UX in the storage-list dialog.
exports.snapshot = function(b) {
    const data = { thresholds: {}, drains: {}, priority: exports.getPriority(b) };
    Vars.content.items().each(item => {
        const t = exports.getThreshold(b, item);
        if (t > 0) data.thresholds[item.name] = t;
        if (exports.getDrain(b, item)) data.drains[item.name] = true;
    });
    return data;
}

exports.applySnapshot = function(b, data) {
    if (!data) return;
    // Wipe existing config first so paste replaces (not merges).
    Vars.content.items().each(item => {
        Core.settings.remove(key(b, item));
        Core.settings.remove(drainKey(b, item));
    });
    Vars.content.items().each(item => {
        const t = data.thresholds && data.thresholds[item.name];
        if (t) Core.settings.put(key(b, item), (t | 0) + "");
        const d = data.drains && data.drains[item.name];
        if (d) Core.settings.put(drainKey(b, item), true);
    });
    exports.setPriority(b, (data.priority | 0));
}

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
        // Mutually exclusive with drain: setting a fill goal clears the drain
        // flag so the drone never shuttles the same item in and out of the
        // same storage forever.
        Core.settings.remove(drainKey(b, item));
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
        Core.settings.remove(key(b, item));
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
