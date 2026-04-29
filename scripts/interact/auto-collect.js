const timer = require("extended-ui/interact/interact-timer");
const collectConfig = require("extended-ui/interact/collect-config");
const storageFill = require("extended-ui/interact/storage-fill");
const playerBusy = require("extended-ui/interact/player-busy");

Events.run(Trigger.update, () => {
    if (!timer.canInteract()) return;
    if (playerBusy.isPlayerInteracting()) return;

    const factoryEnabled = Core.settings.getBool("eui-auto-collect-factory", false);
    const drillEnabled = Core.settings.getBool("eui-auto-collect-drill", false);
    if (!factoryEnabled && !drillEnabled) return;

    const player = Vars.player;
    if (player.unit() == null) return;
    const unit = player.unit();
    const stack = unit.stack;
    const team = player.team();
    const core = player.closestCore();

    if (stack.amount > 0) {
        if (storageFill.isItemReservedForStorage(stack.item, team)) return;
        if (core && player.within(core, Vars.buildingRange)) {
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
