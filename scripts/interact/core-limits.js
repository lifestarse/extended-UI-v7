const DEFAULT_LIMIT = 20;
const LIMIT_MAX = 5000;
const KEY_PREFIX = "eui-core-limit-";

exports.DEFAULT_LIMIT = DEFAULT_LIMIT;
exports.LIMIT_MAX = LIMIT_MAX;
exports.KEY_PREFIX = KEY_PREFIX;

exports.getKey = function(item) {
    return KEY_PREFIX + item.name;
}

exports.getLimit = function(item) {
    try {
        const raw = Core.settings.getString(KEY_PREFIX + item.name, "");
        if (!raw) return DEFAULT_LIMIT;
        const v = parseInt(raw);
        return isNaN(v) ? DEFAULT_LIMIT : v;
    } catch (e) {
        return DEFAULT_LIMIT;
    }
}

exports.setLimit = function(item, value) {
    Core.settings.put(KEY_PREFIX + item.name, ((value | 0)) + "");
}

exports.resetLimit = function(item) {
    Core.settings.remove(KEY_PREFIX + item.name);
}
