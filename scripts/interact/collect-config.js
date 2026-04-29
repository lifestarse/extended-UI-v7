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
