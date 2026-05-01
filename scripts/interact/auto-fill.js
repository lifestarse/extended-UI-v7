const timer = require("extended-ui/interact/interact-timer");
const coreLimits = require("extended-ui/interact/core-limits");
const storageFill = require("extended-ui/interact/storage-fill");
const consumerConfig = require("extended-ui/interact/consumer-config");
const turretAmmoConfig = require("extended-ui/interact/turret-ammo-config");
const autoPilot = require("extended-ui/interact/auto-pilot");
const logger = require("extended-ui/utils/logger").make("eui-af");
const teamBuildingsCache = require("extended-ui/utils/team-buildings-cache");
const turretFetchPending = require("extended-ui/utils/turret-fetch-pending");

const FETCH_PENDING_TTL_SECONDS = 2.0;

// Debug logging shares the auto-pilot toggle (see utils/logger.js) so
// one switch covers the whole pipeline.
function dbg() { return logger.enabled(); }
function dlog(s) { logger.log(s); }
function bTag(b) { return logger.tag(b); }

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
    // For FETCH (request is an Item) we need the originating turret so
    // the pending-cache below knows who we asked for. Delivery sets
    // request to the Building directly, no separate tracking needed.
    let requestBuilding = null;
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

        // Skip if we just queued a Call.requestItem for this building and
        // the drone isn't carrying that item yet. Lets the in-flight
        // request actually complete instead of being re-issued every tick.
        // If the drone already carries the pending item, fall through —
        // we WANT the delivery branch to fire below.
        const pendingEntry = turretFetchPending.get(b);
        if (pendingEntry && !(stack.amount > 0 && stack.item === pendingEntry.item)) {
            if (dbg()) dlog("range-iter " + bTag(b) + " skip: pending fetch of " + pendingEntry.item.name);
            return;
        }

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
            // Per-ammo whitelist: a turret with this specific ammo
            // unchecked must NEVER be a delivery target. Without this
            // gate the drone happily dumps pyratite into a spectre that
            // had pyratite explicitly disabled, because acceptStack still
            // returns >0 (slot is empty) and stock<target still holds.
            if (isItemTurret && !turretAmmoConfig.isEnabled(block, stack.item)) {
                // fall through — block can't be the delivery target,
                // but we still let the fetch path below decide whether
                // to request a different ammo for this turret.
            } else {
                const target = consumerConfig.getTargetFill(b, stack.item);
                const stock = consumerConfig.getItemStock(b, stack.item);
                const accepted = b.acceptStack(stack.item, stack.amount, player.unit());
                if (stock < target && accepted > 0) {
                    if (dbg()) dlog("range-iter " + bTag(b) + " wants " + stack.item.name + " (stock=" + stock + " target=" + target + " accepted=" + accepted + ")");
                    request = b;
                    requestPriority = blockPriority;
                    return;
                }
            }
        }

        if (blockPriority <= requestPriority) return;

        let newRequest = null;
        if (!isCoreAvailible) return;
        if (block instanceof ItemTurret) {
            // Drop the strict "ammo empty" gate: getBestAmmo's
            // acceptStack check already filters out turrets that
            // can't take more of any ammo type, and waiting until a
            // turret runs fully dry causes a firing pause that the
            // user explicitly didn't want. Refill on any room.
            newRequest = getBestAmmo(b, core);
        } else if (block instanceof UnitFactory) {
            newRequest = getUnitFactoryRequest(b, block, core);
        } else if (b.items) {
            newRequest = getItemRequest(b, block, core);
        }
        if (newRequest) {
            if (dbg()) dlog("range-iter " + bTag(b) + " requests " + newRequest.name + " from core");
            request = newRequest;
            requestBuilding = b;
            requestPriority = blockPriority;
        }
    });

    if (request instanceof Building) {
        if (dbg()) dlog("transfer " + (stack.item ? stack.item.name : "?") + "x" + stack.amount + " -> " + bTag(request));
        Call.transferInventory(player, request);
        // Delivery succeeded for this turret as far as we asked — clear
        // the pending entry so a follow-up request can fire next tick.
        turretFetchPending.clear(request);
        timer.increase();
        return;
    }

    if (!isCoreAvailible || !player.within(core, Vars.buildingRange)) return;

    if (stack.amount) {
        // Storage-reservation guard uses a fixed 5-unit floor (matches the
        // hardcoded floor in storage-fill.js): if the stack is at least
        // that big and a storage is reserving the item, hold it.
        if (stack.amount >= 5 && storageFill.isItemReservedForStorage(stack.item, team)) {
            if (dbg()) dlog("dump-suppressed: storage reserves " + stack.item.name + " stack=" + stack.amount);
            return;
        }
        if (autopilotHeadingNonCore()) {
            if (dbg()) {
                const t = autoPilot.getTarget();
                dlog("dump-suppressed: autopilot heading " + (t && t.kind ? t.kind : "?") + " (" + (t && t.item ? t.item.name : "?") + ")");
            }
            return;
        }
        if (dbg()) {
            const t = autoPilot.getTarget();
            dlog("DUMP " + (stack.item ? stack.item.name : "?") + "x" + stack.amount
                + " to core (autopilot target=" + (t ? (t.kind || "?") : "null") + ")");
        }
        Call.transferInventory(player, core);
        if (stack.amount > 0) {
            Call.dropItem(0);
        }
        timer.increase();
    } else if (request) {
        const amount = computeFetchAmount(request, team, player);
        if (dbg()) dlog("FETCH " + request.name + " x" + amount + " from core");
        Call.requestItem(player, core, request, amount);
        // Mark the originating turret as pending so the next ticks skip
        // it until the requestItem completes (or TTL expires). Without
        // this, eui-action-delay=0 spams requestItem every render tick
        // and the drone never catches up.
        if (requestBuilding) {
            turretFetchPending.markRequested(requestBuilding, request, FETCH_PENDING_TTL_SECONDS);
        }
        timer.increase();
    }
});

// Slider=0 % is "smart batch" mode: drone fetches exactly enough to
// top each stuck consumer up to its smart-batch target (largest clean
// multiple of recipe within cap). "Stuck" means stock < recipe — the
// consumer can't start another cycle on its own. A consumer at or
// above recipe is left alone (it can run, possibly fed externally).
//   drone cap 30, two empty crucibles (need 28 each): fetch=28
//     (first crucible fits, second trip handles the other)
//   drone cap 30, three empty smelters (need 10 each): fetch=30
//   drone cap 70, two empty crucibles + one empty smelter: fetch=66
//   reconstructor with stock=20 / recipe=40 / smartBatch=80: need=60
//   any consumer with stock >= recipe: skipped; if no consumer
//     contributes we fall back to 999 (legacy behavior, lets the
//     game-side cap handle it).
// Other slider values keep the legacy "request 999, game caps"
// behavior unchanged.
function computeFetchAmount(item, team, player) {
    const debugging = dbg();
    // Smart-fetch activates when either slider is at 0 % — that's the
    // user's "fetch only what's actually needed" mode. With both at
    // non-zero we fall back to 999 (legacy: drone takes a full load,
    // delivers to whoever, dumps surplus). One slider at 0 % is enough
    // to flip smart mode on for the whole fetch since an empty turret
    // and an empty crafter wanting the same item should both be
    // counted toward the same trip's sum.
    if (consumerConfig.getFillPct() !== 0 && consumerConfig.getTurretFillPct() !== 0) {
        if (debugging) dlog("computeFetchAmount(" + item.name + "): both sliders !=0 -> 999");
        return 999;
    }
    const unit = player.unit();
    if (!unit || !unit.type) return 999;
    const droneCap = unit.type.itemCapacity || 0;
    if (droneCap <= 0) return 999;

    const turretsOn = Core.settings.getBool("eui-auto-fill-turrets", true);
    let total = 0;
    const counts = { added: 0, stocked: 0, ammoOff: 0, noRoom: 0, wouldOverflow: 0 };

    const visit = b => {
        if (total >= droneCap) return;
        try {
            const block = b.block;
            if (!block || !consumerConfig.isEnabled(block)) return;
            const isItemTurret = block instanceof ItemTurret;
            if (isItemTurret && !turretsOn) return;
            let need = 0;
            if (!isItemTurret) {
                if (!block.consumers) return;
                if (!block.consumers.find(c =>
                    c instanceof ConsumeItems
                    || c instanceof ConsumeItemFilter
                    || c instanceof ConsumeItemDynamic)) return;
                // Trigger when the consumer can't run another cycle
                // (stock < recipe via getTargetFill at slider=0 %).
                const target = consumerConfig.getTargetFill(b, item);
                if (target <= 0) return;
                const stock = consumerConfig.getItemStock(b, item);
                if (stock >= target) { counts.stocked++; return; }
                // Top up to the smart-batch target so the buffer
                // drains cleanly. need = clean batch size minus what
                // the consumer already holds.
                need = consumerConfig.getSmartBatchAmount(b, item) - stock;
            } else {
                // Turrets: refill only ammo types not currently loaded
                // (no race against external feeds). need = acceptStack
                // room so the drone fetches exactly what fits.
                if (!b.ammo) return;
                // Per-ammo whitelist: respect the turret-ammo config so
                // a disabled (unchecked) ammo type isn't summed into the
                // fetch — otherwise drone fetches an item it'll refuse
                // to deliver to this turret (and may dump back to core).
                if (!turretAmmoConfig.isEnabled(block, item)) { counts.ammoOff++; return; }
                // Slider gate via real ammo stock — items[] is always 0
                // for turrets, so without getItemStock the slider is
                // effectively ignored and drone refills 1 unit per
                // visit regardless of %.
                const tTarget = consumerConfig.getTargetFill(b, item);
                if (tTarget <= 0) return;
                const tStock = consumerConfig.getItemStock(b, item);
                if (tStock >= tTarget) { counts.stocked++; return; }
                need = b.acceptStack(item, droneCap, unit);
                if (need <= 0) { counts.noRoom++; return; }
            }
            if (need <= 0) return;
            if (total + need <= droneCap) {
                total += need;
                counts.added++;
            } else {
                counts.wouldOverflow++;
            }
        } catch (e) {}
    };

    // Autopilot will steer the drone anywhere on the team's map after
    // the fetch, so summing across the whole team gives the drone the
    // chance to fill multiple consumers with one trip. Without
    // autopilot we limit to in-range so non-pilot mode stays local.
    if (Core.settings.getBool("eui-auto-pilot", false)) {
        const builds = teamBuildingsCache.get(team);
        if (builds) builds.each(visit);
    } else {
        Vars.indexer.eachBlock(team, player.x, player.y, Vars.buildingRange, () => true, visit);
    }

    if (debugging) {
        dlog("computeFetchAmount(" + item.name + ") added=" + counts.added
            + " skipped(S=" + counts.stocked + ",A=" + counts.ammoOff
            + ",F=" + counts.noRoom + ",O=" + counts.wouldOverflow + ")"
            + " -> " + (total > 0 ? total + "/" + droneCap : "0 (fallback 999)"));
    }
    return total > 0 ? total : 999;
}

function getBestAmmo(turretBuild, core) {
    const turret = turretBuild.block;
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
        // acceptStack lives on the Building, not the Block — the old
        // signature took the Block here and crashed with "Cannot find
        // function acceptStack in object duo" the moment a turret
        // with empty ammo entered the auto-fill loop.
        if (turretBuild.acceptStack(item, 1, probeUnit) <= 0) return;
        // Slider gate: skip when the turret already holds at least
        // 'target' worth of this ammo. At slider=0 % target=1 so any
        // loaded ammo skips (drone helps only when truly empty); at
        // higher % the threshold scales with cap. Reading getItemStock
        // (b.ammo aware) — not items[] (always 0 for turrets) — is
        // what makes the slider actually do anything.
        const ggTarget = consumerConfig.getTargetFill(turretBuild, item);
        const ggStock = consumerConfig.getItemStock(turretBuild, item);
        if (ggStock >= ggTarget) return;
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
        const target = consumerConfig.getTargetFill(build, item);
        const stock = consumerConfig.getItemStock(build, item);
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
