const timer = require("extended-ui/interact/interact-timer");
const coreLimits = require("extended-ui/interact/core-limits");
const storageFill = require("extended-ui/interact/storage-fill");
const consumerConfig = require("extended-ui/interact/consumer-config");
const turretAmmoConfig = require("extended-ui/interact/turret-ammo-config");
const playerBusy = require("extended-ui/interact/player-busy");

Events.run(Trigger.update, () => {
    if (!Core.settings.getBool("eui-auto-fill", false) || !timer.canInteract()) return;
    if (playerBusy.isPlayerInteracting()) return;
    const player = Vars.player;
    if (player.unit() == null) return;
    const stack = player.unit().stack;
    const team = player.team();
    const core = player.closestCore();
    const isCoreAvailible = Core.settings.getBool("eui-interact-core", false) && core;

    let request = null;
    let requestPriority = -1;
    let config = Core.settings.getJson("eui.autofill.priority", ObjectMap, () => new ObjectMap());

    const turretsOn = Core.settings.getBool("eui-auto-fill-turrets", true);

    Vars.indexer.eachBlock(team, player.x, player.y, Vars.buildingRange, () => true, b => {
        if (!timer.canInteract()) return;

        const block = b.tile.block();
        if (block instanceof ItemTurret && !turretsOn) return;
        if (!consumerConfig.isEnabled(block)) return;
        if (!block.consumers.find(c => c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic)) return;
        let blockPriority = config.get(block.name, 0);
        const custom = consumerConfig.getPriority(block);
        if (custom > 0) blockPriority = custom;

        // We want insert requests to have priority over deposit requests
        if (blockPriority < requestPriority) return;
        if (blockPriority == requestPriority && request instanceof Building) return;

        if (b.acceptStack(stack.item, stack.amount, player.unit()) >= 5) {
            request = b;
            requestPriority = blockPriority;
            return;
        }

        if (blockPriority <= requestPriority) return;

        let newRequest = null;
        if (!isCoreAvailible) return;
        if (block instanceof ItemTurret) {
            if (!b.ammo.isEmpty()) return;
            newRequest = getBestAmmo(block, core);
        } else if (block instanceof UnitFactory) {
            newRequest = getUnitFactoryRequest(b, block, core);
        } else if (b.items) {
            newRequest = getItemRequest(b, block, core);
        }
        if (newRequest) {
            request = newRequest;
            requestPriority = blockPriority;
        }
    });

    if (request instanceof Building) {
        Call.transferInventory(player, request);
        timer.increase();
        return;
    }

    if (!isCoreAvailible || !player.within(core, Vars.buildingRange)) return;

    if (stack.amount) {
        if (storageFill.isItemReservedForStorage(stack.item, team)) return;
        Call.transferInventory(player, core);
        if (stack.amount > 0) {
            Call.dropItem(0);
        }
        timer.increase();
    } else if (request) {
        Call.requestItem(player, core, request, 999);
        timer.increase();
    }
});

function getBestAmmo(turret, core) {
    let best = null;
    let bestScore = -Infinity;
    turret.ammoTypes.each((item, ammo) => {
        if (!turretAmmoConfig.isEnabled(turret, item)) return;
        if (core.items.get(item) < coreLimits.getLimit(item)) return;
        const damage = ammo.damage + ammo.splashDamage;
        const priority = turretAmmoConfig.getPriority(turret, item);
        // Priority dominates when set; damage breaks ties (and is the
        // sole signal when nobody set priorities).
        const score = priority * 100000 + damage;
        if (score > bestScore) {
            best = item;
            bestScore = score;
        }
    });
    return best;
}

function getUnitFactoryRequest(build, block, core) {
    if (build.currentPlan == -1) return null;
    const stacks = block.plans.get(build.currentPlan).requirements

    return findRequiredItem(stacks, build, core);
}

function getItemRequest(build, block, core) {
    const consumesItems = block.consumers.find(c => c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic);
    if (!consumesItems) return null;

    if (consumesItems instanceof ConsumeItemFilter) {
        return getFilterRequest(consumesItems, build, core);
    } else if (consumesItems instanceof ConsumeItems) {
        return findRequiredItem(consumesItems.items, build, core);
    } else {
        return null;
    }
}

function getFilterRequest(filter, build, core) {
    let request = null;
    let stop = false;
    Vars.content.items().each(item => {
        if (filter.filter.get(item) && item != Items.blastCompound && core.items.get(item) >= coreLimits.getLimit(item)) {
            if (build.acceptStack(item, 20, Vars.player.unit()) >= 5 && request == null && !stop) {
                request = item;
            } else {
                stop = true;
            }
        }
    });
    return request;
}

function findRequiredItem(stacks, build, core) {
    for (let itemStack of stacks) {
        let item = itemStack.item;
        if (core.items.get(item) >= coreLimits.getLimit(item) && build.acceptStack(item, 20, Vars.player.unit()) >= 5) {
            return item;
        }
    }
    return null;
}
