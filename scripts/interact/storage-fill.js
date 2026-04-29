const timer = require("extended-ui/interact/interact-timer");
const storageConfig = require("extended-ui/interact/storage-config");
const coreLimits = require("extended-ui/interact/core-limits");

exports.isManagedStorage = function(block) {
    return block instanceof StorageBlock && !(block instanceof CoreBlock);
}

Events.run(Trigger.update, () => {
    if (!Core.settings.getBool("eui-storage-fill", false) || !timer.canInteract()) return;

    const player = Vars.player;
    if (player.unit() == null) return;
    const unit = player.unit();
    const stack = unit.stack;
    const team = player.team();
    const core = player.closestCore();

    if (stack.amount > 0 && stack.item) {
        let target = null;
        Vars.indexer.eachBlock(team, player.x, player.y, Vars.buildingRange, () => true, b => {
            if (target) return;
            if (!exports.isManagedStorage(b.block)) return;
            const threshold = storageConfig.getThreshold(b, stack.item);
            if (threshold <= 0) return;
            if (!b.items || b.items.get(stack.item) >= threshold) return;
            if (b.acceptStack(stack.item, stack.amount, unit) < 5) return;
            target = b;
        });
        if (target) {
            Call.transferInventory(player, target);
            timer.increase();
        }
        return;
    }

    if (!core || !player.within(core, Vars.buildingRange)) return;

    let neededItem = null;
    Groups.build.each(b => {
        if (neededItem) return;
        try {
            if (b.team !== team) return;
            if (!exports.isManagedStorage(b.block)) return;
            const item = storageConfig.findNeededItem(b, it =>
                core.items.get(it) >= coreLimits.getLimit(it));
            if (item) neededItem = item;
        } catch (e) {}
    });

    if (neededItem) {
        Call.requestItem(player, core, neededItem, 999);
        timer.increase();
    }
});
