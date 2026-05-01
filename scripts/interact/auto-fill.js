const timer = require("extended-ui/interact/interact-timer");
const coreLimits = require("extended-ui/interact/core-limits");
const storageFill = require("extended-ui/interact/storage-fill");
const consumerConfig = require("extended-ui/interact/consumer-config");
const turretAmmoConfig = require("extended-ui/interact/turret-ammo-config");
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
    // Per-block batch size now scales with each consumer's own capacity
    // via consumerConfig.getMinAmountFor — a 10-cap factory and a 100-cap
    // one share one fill-pct slider that produces sensible thresholds for
    // each. Probe stays a fixed 20 because it's just an acceptance probe;
    // the real gate is the per-block minAmount comparison below.
    const PROBE_AMOUNT = 20;
    const autopilotOn = Core.settings.getBool("eui-auto-pilot", false);

    Vars.indexer.eachBlock(team, player.x, player.y, Vars.buildingRange, () => true, b => {
        if (!timer.canInteract()) return;

        const block = b.tile.block();
        if (block instanceof ItemTurret && !turretsOn) return;
        if (!consumerConfig.isEnabled(block)) return;
        // Turrets accept ammo via ammoTypes (not the consumers[] array),
        // so the ConsumeItems-style filter would skip them — keep them
        // in the loop so getBestAmmo / acceptStack can do their thing.
        const isItemTurret = block instanceof ItemTurret;
        if (!isItemTurret && !block.consumers.find(c => c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic)) return;
        let blockPriority = config.get(block.name, 0);
        const custom = consumerConfig.getPriority(block);
        if (custom > 0) blockPriority = custom;

        // We want insert requests to have priority over deposit requests
        if (blockPriority < requestPriority) return;
        if (blockPriority == requestPriority && request instanceof Building) return;

        const droneCap = (player.unit().type && player.unit().type.itemCapacity) || 0;
        const minAmount = consumerConfig.getDeliverableMinFor(block, stack.item, droneCap);
        // Two competing concerns when autopilot is steering:
        //   1) A leftover stack smaller than this consumer's batch size
        //      must still be deliverable, otherwise the drone parks at
        //      the consumer holding 3 items it could just hand over.
        //   2) A full stack must NOT be drip-fed one item at a time as
        //      the consumer chews through it — otherwise the drone gets
        //      stuck topping up the same factory every tick (10/10 ->
        //      9/10 -> drone delivers 1 -> 10/10 -> ...) and the rest
        //      of the line starves.
        // Manual play keeps the minAmount filter throughout.
        const deliverThreshold = autopilotOn
            ? (stack.amount >= minAmount ? minAmount : 1)
            : minAmount;

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
            newRequest = getUnitFactoryRequest(b, block, core, minAmount, PROBE_AMOUNT);
        } else if (b.items) {
            newRequest = getItemRequest(b, block, core, minAmount, PROBE_AMOUNT);
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
        // Storage-reservation guard uses a fixed 5-unit floor (matches the
        // hardcoded floor in storage-fill.js): if the stack is at least
        // that big and a storage is reserving the item, hold it.
        if (stack.amount >= 5 && storageFill.isItemReservedForStorage(stack.item, team)) return;
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
    const probeUnit = Vars.player.unit();
    turret.ammoTypes.each((item, ammo) => {
        if (!turretAmmoConfig.isEnabled(turret, item)) return;
        if (core.items.get(item) < coreLimits.getLimit(item)) return;
        // Skip ammo the turret can't actually receive — without this,
        // multi-ammo turrets (e.g. double turret) tell us "I want
        // graphite" even when their graphite slot is full, the drone
        // fetches from core, can't deliver, dumps back, and loops.
        if (turret.acceptStack(item, 1, probeUnit) <= 0) return;
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
