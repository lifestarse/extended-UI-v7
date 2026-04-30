const timer = require("extended-ui/interact/interact-timer");
const collectConfig = require("extended-ui/interact/collect-config");
const storageFill = require("extended-ui/interact/storage-fill");
const autoPilot = require("extended-ui/interact/auto-pilot");
const consumerConfig = require("extended-ui/interact/consumer-config");

// Same gating as auto-fill: when autopilot is steering toward a non-core
// destination, don't intercept the stack with a core deposit just because
// the path momentarily crossed core range.
function autopilotHeadingNonCore() {
    if (!Core.settings.getBool("eui-auto-pilot", false)) return false;
    const target = autoPilot.getTarget();
    if (!target) return false;
    return target.kind !== "core-dump" && target.kind !== "core-fetch";
}

Events.run(Trigger.update, () => {
    if (!Core.settings.getBool("eui-auto-fill", false)) return;
    if (!timer.canInteract()) return;

    const factoryEnabled = Core.settings.getBool("eui-auto-collect-factory", false);
    const drillEnabled = Core.settings.getBool("eui-auto-collect-drill", false);
    if (!factoryEnabled && !drillEnabled) return;

    const player = Vars.player;
    if (player.unit() == null) return;
    const unit = player.unit();
    const stack = unit.stack;
    const team = player.team();
    const core = player.closestCore();

    const capacity = unit.type ? unit.type.itemCapacity : 0;

    if (stack.amount > 0) {
        // Top up: drone has the item already and isn't full -- if any
        // configured same-item producer is in range, take more from it
        // instead of flying off to deliver a tiny stack.
        if (stack.item && stack.amount < capacity) {
            const topUp = findTopUpTarget(team, player, unit, stack.item, factoryEnabled, drillEnabled);
            if (topUp) {
                Call.requestItem(player, topUp, stack.item, 999);
                timer.increase();
                return;
            }
        }
        // Reservation only blocks core-dump when the drone is actually carrying
        // enough for storage-fill / auto-fill to pick up (their minimum is 5).
        // Otherwise the drone deadlocks: too few items to deliver anywhere, but
        // forbidden from dumping back to core.
        if (stack.amount >= 5 && storageFill.isItemReservedForStorage(stack.item, team)) return;
        if (autopilotHeadingNonCore()) return;
        if (core && player.within(core, Vars.buildingRange)) {
            if (!Core.settings.getBool("eui-interact-core", false)) return;
            Call.transferInventory(player, core);
            timer.increase();
        }
        return;
    }

    let target = null;
    let targetItem = null;

    Vars.indexer.eachBlock(team, player.x, player.y, Vars.buildingRange, () => true, b => {
        if (target) return;
        const block = b.tile.block();

        if (factoryEnabled && block instanceof GenericCrafter && collectConfig.isFactoryEnabled(block)) {
            const out = block.outputItems;
            if (out && b.items) {
                const thr = collectConfig.getPickupThreshold(block);
                for (let i = 0; i < out.length; i++) {
                    const it = out[i].item;
                    if (b.items.get(it) >= thr) {
                        target = b;
                        targetItem = it;
                        return;
                    }
                }
            }
        }

        if (!target && drillEnabled && block instanceof Drill) {
            const dom = b.dominantItem;
            if (dom != null && b.items && collectConfig.isDrillItemEnabled(dom)
                && b.items.get(dom) >= collectConfig.getPickupThreshold(block)) {
                target = b;
                targetItem = dom;
            }
        }
    });

    if (!target || !targetItem) return;

    Call.requestItem(player, target, targetItem, 999);
    timer.increase();
});

function findTopUpTarget(team, player, unit, item, factoryEnabled, drillEnabled) {
    // Top-up reaches here when the drone already carries `item` and is
    // standing at a same-item producer. Drills always get pulled from on
    // any positive stock — the drone is intentionally waiting on the
    // mining cycle. Factories use the same drip-feed guard as auto-fill:
    // with a substantial stack already in hand, refuse to trickle 2 at a
    // time from a slow factory; with only a leftover scrap, take whatever
    // is on offer.
    let target = null;
    const stack = unit.stack;
    Vars.indexer.eachBlock(team, player.x, player.y, Vars.buildingRange, () => true, b => {
        if (target) return;
        const block = b.tile.block();
        if (factoryEnabled && block instanceof GenericCrafter && collectConfig.isFactoryEnabled(block)
            && block.outputItems && b.items) {
            const blockMin = consumerConfig.getMinAmountFor(block, item);
            const factoryThr = stack.amount >= blockMin ? blockMin : 1;
            for (let i = 0; i < block.outputItems.length; i++) {
                if (block.outputItems[i].item !== item) continue;
                if (b.items.get(item) >= factoryThr) {
                    target = b;
                    return;
                }
            }
        }
        if (!target && drillEnabled && block instanceof Drill && b.items
            && b.dominantItem === item
            && collectConfig.isDrillItemEnabled(item)
            && b.items.get(item) > 0) {
            target = b;
        }
    });
    return target;
}
