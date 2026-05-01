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

        // Same gate as the autopilot's findBestConsumer / isStale: the
        // consumer must be below the user's fill target for the item the
        // drone is carrying, AND must physically accept at least one
        // unit. Without the stock<target check the drone would deliver
        // tiny amounts to nearly-full consumers in range, or — worse —
        // refuse to deliver to a partially-filled consumer because room
        // < blockMin (the bug visible in last_log.txt: pyratite-mixer
        // with sand=6/10 got skipped because 4 < 10, even though the
        // user set fillPct=100 % meaning "top up to full").
        const wantsItem = stack.amount > 0 && stack.item != null;
        if (wantsItem) {
            const target = consumerConfig.getTargetFill(block, stack.item);
            const stock = b.items ? b.items.get(stack.item) : 0;
            const accepted = b.acceptStack(stack.item, stack.amount, player.unit());
            if (stock < target && accepted > 0) {
                request = b;
                requestPriority = blockPriority;
                return;
            }
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

// Same gate as findBestConsumer: the consumer's stock for this item
// must be below its fill target AND the consumer must accept at
// least one unit right now. Anything stricter (room ≥ minAmount)
// would refuse partially-filled consumers and shuttle items back to
// the core instead of topping them up.
function consumerWantsItem(build, item) {
    try {
        const target = consumerConfig.getTargetFill(build.block, item);
        const stock = build.items ? build.items.get(item) : 0;
        if (stock >= target) return false;
        return build.acceptStack(item, 1, Vars.player.unit()) > 0;
    } catch (e) { return false; }
}

function getUnitFactoryRequest(build, block, core) {
    if (build.currentPlan == -1) return null;
    const stacks = block.plans.get(build.currentPlan).requirements;
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
    Vars.content.items().each(item => {
        if (request) return;
        if (!filter.filter.get(item)) return;
        if (item == Items.blastCompound) return;
        if (core.items.get(item) < coreLimits.getLimit(item)) return;
        if (!consumerWantsItem(build, item)) return;
        request = item;
    });
    return request;
}

function findRequiredItem(stacks, build, core) {
    for (let itemStack of stacks) {
        let item = itemStack.item;
        if (core.items.get(item) >= coreLimits.getLimit(item) && consumerWantsItem(build, item)) {
            return item;
        }
    }
    return null;
}
