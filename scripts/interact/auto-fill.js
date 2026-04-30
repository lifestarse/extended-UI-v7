const timer = require("extended-ui/interact/interact-timer");
const coreLimits = require("extended-ui/interact/core-limits");
const storageFill = require("extended-ui/interact/storage-fill");
const consumerConfig = require("extended-ui/interact/consumer-config");
const turretAmmoConfig = require("extended-ui/interact/turret-ammo-config");
const playerBusy = require("extended-ui/interact/player-busy");
const autoPilot = require("extended-ui/interact/auto-pilot");

// True when the autopilot is steering the drone to a non-core destination.
// We use this to suppress the core-dump fallback in this module: otherwise
// the drone deposits its stack the moment its path crosses core range,
// even though the autopilot intends it for a producer-topup / consumer
// delivery / storage fill elsewhere.
function autopilotHeadingNonCore() {
    if (!Core.settings.getBool("eui-auto-pilot", false)) return false;
    const target = autoPilot.getTarget();
    if (!target) return false;
    return target.kind !== "core-dump" && target.kind !== "core-fetch";
}

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
    const minAmount = consumerConfig.getMinAmount();
    const probeAmount = Math.max(20, minAmount);
    // When autopilot is steering, pickTarget already vetted the trip — its
    // findBestConsumer probes the consumer's *capacity* with minAmount, not
    // the drone's stack. So the drone may legitimately arrive holding fewer
    // than minAmount items (e.g. partial leftover after a previous delivery
    // when the same-item producer was below the collect threshold). Refusing
    // to deliver here parks the drone at the consumer holding 3 of an item
    // it could just hand over.
    const autopilotOn = Core.settings.getBool("eui-auto-pilot", false);
    const deliverThreshold = autopilotOn ? 1 : minAmount;

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

        if (stack.amount > 0 && b.acceptStack(stack.item, stack.amount, player.unit()) >= deliverThreshold) {
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
            newRequest = getUnitFactoryRequest(b, block, core, minAmount, probeAmount);
        } else if (b.items) {
            newRequest = getItemRequest(b, block, core, minAmount, probeAmount);
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
        if (stack.amount >= minAmount && storageFill.isItemReservedForStorage(stack.item, team)) return;
        if (autopilotHeadingNonCore()) return;
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

function getUnitFactoryRequest(build, block, core, minAmount, probeAmount) {
    if (build.currentPlan == -1) return null;
    const stacks = block.plans.get(build.currentPlan).requirements

    return findRequiredItem(stacks, build, core, minAmount, probeAmount);
}

function getItemRequest(build, block, core, minAmount, probeAmount) {
    const consumesItems = block.consumers.find(c => c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic);
    if (!consumesItems) return null;

    if (consumesItems instanceof ConsumeItemFilter) {
        return getFilterRequest(consumesItems, build, core, minAmount, probeAmount);
    } else if (consumesItems instanceof ConsumeItems) {
        return findRequiredItem(consumesItems.items, build, core, minAmount, probeAmount);
    } else {
        return null;
    }
}

function getFilterRequest(filter, build, core, minAmount, probeAmount) {
    let request = null;
    let stop = false;
    Vars.content.items().each(item => {
        if (filter.filter.get(item) && item != Items.blastCompound && core.items.get(item) >= coreLimits.getLimit(item)) {
            if (build.acceptStack(item, probeAmount, Vars.player.unit()) >= minAmount && request == null && !stop) {
                request = item;
            } else {
                stop = true;
            }
        }
    });
    return request;
}

function findRequiredItem(stacks, build, core, minAmount, probeAmount) {
    for (let itemStack of stacks) {
        let item = itemStack.item;
        if (core.items.get(item) >= coreLimits.getLimit(item) && build.acceptStack(item, probeAmount, Vars.player.unit()) >= minAmount) {
            return item;
        }
    }
    return null;
}
