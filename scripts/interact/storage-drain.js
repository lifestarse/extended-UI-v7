const storageConfig = require("extended-ui/interact/storage-config");
const storageFill = require("extended-ui/interact/storage-fill");
const timer = require("extended-ui/interact/interact-timer");
const playerBusy = require("extended-ui/interact/player-busy");

let carrying = false;

exports.isCarrying = function() { return carrying; }

// Pick the storage with the most stock of any item flagged for drain. The
// auto-pilot uses this to plan the trip; the actual fetch happens here once
// the drone is in range.
exports.findDrainSource = function(team) {
    if (!team) return null;
    const data = team.data();
    if (!data || !data.buildings) return null;
    let best = null;
    let bestStock = 0;
    data.buildings.each(b => {
        try {
            if (!storageFill.isManagedStorage(b.block)) return;
            const item = storageConfig.findDrainItem(b);
            if (!item || !b.items) return;
            const stock = b.items.get(item);
            if (stock > bestStock) {
                bestStock = stock;
                best = { x: b.x, y: b.y, b: b, item: item, expectsConsumer: false, kind: "drain-fetch" };
            }
        } catch (e) {}
    });
    return best;
}

Events.run(Trigger.update, () => {
    // Master switch: the bottom-bar auto-fill button gates every automation.
    // Drain has no per-feature switch (per-item flags configure it instead),
    // so we also gate on interact-core because drain only delivers to core.
    if (!Core.settings.getBool("eui-auto-fill", false)) {
        carrying = false;
        return;
    }
    if (!Core.settings.getBool("eui-interact-core", false)) {
        carrying = false;
        return;
    }
    if (!timer.canInteract()) return;
    if (playerBusy.isPlayerInteracting()) return;
    const player = Vars.player;
    if (!player) return;
    const unit = player.unit();
    if (!unit) return;
    const stack = unit.stack;
    const team = player.team();

    if (stack.amount === 0) {
        carrying = false;
        // If standing on / next to a drain storage, pull from it.
        let pickup = null;
        Vars.indexer.eachBlock(team, player.x, player.y, Vars.buildingRange, () => true, b => {
            if (pickup) return;
            try {
                if (!storageFill.isManagedStorage(b.block)) return;
                const item = storageConfig.findDrainItem(b);
                if (item) pickup = { b: b, item: item };
            } catch (e) {}
        });
        if (pickup) {
            Call.requestItem(player, pickup.b, pickup.item, 999);
            carrying = true;
            timer.increase();
        }
        return;
    }

    // Carrying drained items: dump to the closest core when in range. We do
    // this here (bypassing auto-fill / auto-collect) because the storage
    // reservation guard there would otherwise refuse the drop for items that
    // some other storage still wants to fill.
    if (carrying) {
        const core = player.closestCore();
        if (core && player.within(core, Vars.buildingRange)) {
            Call.transferInventory(player, core);
            timer.increase();
        }
    }
});
