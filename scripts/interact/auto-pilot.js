const collectConfig = require("extended-ui/interact/collect-config");
const storageConfig = require("extended-ui/interact/storage-config");
const storageFill = require("extended-ui/interact/storage-fill");
const storageDrain = require("extended-ui/interact/storage-drain");
const coreLimits = require("extended-ui/interact/core-limits");
const playerBusy = require("extended-ui/interact/player-busy");
const taskPriority = require("extended-ui/interact/task-priority");
const consumerConfig = require("extended-ui/interact/consumer-config");
const turretAmmoConfig = require("extended-ui/interact/turret-ammo-config");

const RESCAN_TICKS = 30;
const ARRIVE_PADDING = Vars.tilesize * 2;

let cached = null;
let scanTick = RESCAN_TICKS;

// Debug logging — gated on the eui-debug-autopilot setting. Logs hit
// every time pickTarget runs (≈ once per RESCAN_TICKS = 0.5s), so
// they're noisy but only fire while the toggle is on. When the user
// can't tell why the drone ignores a particular consumer, switching
// this on for a few seconds and grepping last_log.txt for the block
// name shows exactly which filter rejected it.
function dbg() { return Core.settings.getBool("eui-debug-autopilot", false); }
// log() goes through Mindustry's Log facility and ends up in
// last_log.txt; print() only writes to stdout, which the user can't
// read after the fact.
function dlog(s) { if (dbg()) try { log("[eui-ap] " + s); } catch (e) {} }
function blockTag(b) {
    try { return b.block.name + "@" + b.tile.x + "," + b.tile.y; } catch (e) { return "?"; }
}

// Other modules (auto-fill, auto-collect) consult this so they don't dump
// the drone's stack into the core just because the autopilot's path took
// it through core range -- only "core-dump" / "core-fetch" trips should
// trigger the core transfer there.
exports.getTarget = function() { return cached; };

Events.run(Trigger.update, () => {
    // Master switch: bottom-bar auto-fill button gates every automation.
    if (!Core.settings.getBool("eui-auto-fill", false)
        || !Core.settings.getBool("eui-auto-pilot", false)) {
        cached = null;
        return;
    }

    const player = Vars.player;
    if (player.unit() == null) return;
    const unit = player.unit();
    if (unit.dead) return;

    if (playerBusy.isPlayerSteering()) {
        cached = null;
        return;
    }

    scanTick++;
    if (scanTick >= RESCAN_TICKS || !cached || isStale(cached, unit)) {
        scanTick = 0;
        cached = pickTarget(unit, player.team());
    }
    if (!cached) return;

    const dx = cached.x - unit.x;
    const dy = cached.y - unit.y;
    const dist2 = dx * dx + dy * dy;
    const inRange = Vars.buildingRange - ARRIVE_PADDING;
    if (dist2 <= inRange * inRange) return;

    const dist = Math.sqrt(dist2);
    const speed = unit.type.speed > 0 ? unit.type.speed : 1;
    const v = Tmp.v1.set(dx / dist, dy / dist).scl(speed);
    unit.moveAt(v);
});

function isStale(target, unit) {
    if (!target.b || target.b.dead || target.b.tile == null || target.b.tile.build !== target.b) return true;
    const stack = unit.stack;
    // Core trips self-stale on completion so pickTarget can flip the
    // drone to consumer-deliver / producer-collect immediately. Without
    // this the drone parks at the core after a fetch and auto-fill's
    // own at-core deposit branch dumps the stack right back in (this
    // was the turret-graphite loop: fetch -> dump -> fetch -> ...).
    if (target.kind === "core-fetch") return stack.amount > 0;
    if (target.kind === "core-dump") return stack.amount === 0;
    if (target.kind === "producer-topup") {
        if (stack.amount === 0 || stack.item !== target.item) return true;
        const cap = unit.type ? unit.type.itemCapacity : 0;
        if (cap > 0 && stack.amount >= cap) return true;
        // Drill vein depleted / tile swap — abandon.
        if (target.b.block instanceof Drill && target.b.dominantItem !== target.item) return true;
        if (!target.b.items) return true;
        // Same pickup-threshold gate as findBestProducer / findTopUpTarget:
        // once stock drops below it the drone moves on to a fuller
        // producer (or back to delivery) instead of trickle-pulling.
        const pickupThr = collectConfig.getPickupThreshold(target.b.block, target.item);
        return target.b.items.get(target.item) < pickupThr;
    }
    if (stack.amount > 0 && stack.item) {
        if (!target.expectsConsumer) return true;
        if (target.item !== stack.item) return true;
        // Stale once the consumer is at or above the user's fill target,
        // OR if it physically can't accept anything right now (full
        // buffer for this item). Note: NOT gated on "drone could deliver
        // a full batch" — a drone with 3 items left should still finish
        // delivering to a consumer that needs more.
        const tgt = consumerConfig.getTargetFill(target.b, stack.item);
        const stk = target.b.items ? target.b.items.get(stack.item) : 0;
        if (stk >= tgt) return true;
        return target.b.acceptStack(stack.item, 1, unit) <= 0;
    }
    if (target.expectsConsumer) return true;
    return !target.b.items || target.b.items.get(target.item) <= 0;
}

function pickTarget(unit, team) {
    const stack = unit.stack;
    const storageOn = Core.settings.getBool("eui-storage-fill", false);
    const fillOn = Core.settings.getBool("eui-auto-fill", false);
    const factoryOn = Core.settings.getBool("eui-auto-collect-factory", false);
    const drillOn = Core.settings.getBool("eui-auto-collect-drill", false);
    // Bottom-bar interact-core button gates every core trip.
    const coreOn = Core.settings.getBool("eui-interact-core", false);

    // Drain trips override everything else: once items are picked up from
    // a drain storage, the drone heads straight to core to unload them.
    if (stack.amount > 0 && stack.item && storageDrain.isCarrying() && coreOn) {
        const core = Vars.player.closestCore();
        if (core) {
            return { x: core.x, y: core.y, b: core, item: stack.item, expectsConsumer: false, kind: "core-dump" };
        }
    }

    const candidates = [];

    if (stack.amount > 0 && stack.item) {
        const capacity = unit.type ? unit.type.itemCapacity : 0;
        const isFull = capacity > 0 && stack.amount >= capacity;

        if (!isFull && (factoryOn || drillOn)) {
            const p = findBestProducer(unit, team, factoryOn, drillOn, stack.item);
            if (p) {
                p.kind = "producer-topup";
                candidates.push({ task: "producer-topup", target: p });
            }
        }
        if (fillOn) {
            const c = findBestConsumer(unit, stack.item, team);
            if (c) {
                c.kind = "consumer-deliver";
                candidates.push({ task: "consumer-deliver", target: c });
            }
        }
        if (storageOn) {
            const s = findBestStorageNeed(unit, stack.item, team);
            if (s) {
                s.kind = "storage-deliver";
                candidates.push({ task: "storage-deliver", target: s });
            }
        }
        if (coreOn) {
            const dumpCore = Vars.player.closestCore();
            if (dumpCore) {
                candidates.push({
                    task: "core-dump",
                    target: { x: dumpCore.x, y: dumpCore.y, b: dumpCore, item: stack.item, expectsConsumer: false, kind: "core-dump" }
                });
            }
        }
    } else {
        if (storageOn && coreOn) {
            const fetch = findCoreFetchForStorage(unit, team);
            if (fetch) candidates.push({ task: "storage-fetch", target: fetch });
        }
        if (coreOn) {
            const drain = storageDrain.findDrainSource(team);
            if (drain) candidates.push({ task: "storage-drain-fetch", target: drain });
        }
        if (fillOn && coreOn) {
            const consumerFetch = findCoreFetchForConsumer(unit, team);
            if (consumerFetch) candidates.push({ task: "consumer-core-fetch", target: consumerFetch });
        }
        if (factoryOn || drillOn) {
            const p = findBestProducer(unit, team, factoryOn, drillOn, null);
            if (p) {
                p.kind = "producer-collect";
                candidates.push({ task: "producer-collect", target: p });
            }
        }
    }

    return taskPriority.pickHighest(candidates);
}

function teamBuildings(team) {
    if (!team) return null;
    const data = team.data();
    if (!data || !data.buildings) return null;
    return data.buildings;
}

function findBestStorageNeed(unit, item, team) {
    const builds = teamBuildings(team);
    if (!builds) return null;
    let bestB = null;
    let bestPriority = -1;
    let bestDeficit = 0;
    const cap = (unit.type && unit.type.itemCapacity) || 0;
    builds.each(b => {
        try {
            if (!storageFill.isManagedStorage(b.block)) return;
            const threshold = storageConfig.getThreshold(b, item);
            if (threshold <= 0) return;
            if (!b.items) return;
            const stock = b.items.get(item);
            if (stock >= threshold) return;
            const deficit = threshold - stock;
            if (cap > 0 && deficit < cap) return;
            if (b.acceptStack(item, 5, unit) < 5) return;
            // Priority dominates; deficit breaks ties so the same-priority
            // storage with the larger gap gets visited first.
            const prio = storageConfig.getPriority(b);
            if (prio > bestPriority || (prio === bestPriority && deficit > bestDeficit)) {
                bestPriority = prio;
                bestDeficit = deficit;
                bestB = b;
            }
        } catch (e) {}
    });
    if (!bestB) return null;
    return { x: bestB.x, y: bestB.y, b: bestB, item: item, expectsConsumer: true };
}

function findCoreFetchForStorage(unit, team) {
    const core = Vars.player.closestCore();
    if (!core) return null;
    const builds = teamBuildings(team);
    if (!builds) return null;
    const cap = (unit.type && unit.type.itemCapacity) || 0;
    // Highest-priority storage with a needed item the core can supply
    // wins. Without the priority sort, the iteration order of the team
    // building list decides which storage gets fed first.
    let chosenItem = null;
    let chosenPriority = -1;
    builds.each(b => {
        try {
            if (!storageFill.isManagedStorage(b.block)) return;
            const item = storageConfig.findNeededItem(b, it =>
                core.items.get(it) >= coreLimits.getLimit(it), cap);
            if (!item) return;
            const prio = storageConfig.getPriority(b);
            if (prio > chosenPriority) {
                chosenPriority = prio;
                chosenItem = item;
            }
        } catch (e) {}
    });
    if (!chosenItem) return null;
    return { x: core.x, y: core.y, b: core, item: chosenItem, expectsConsumer: false, kind: "core-fetch" };
}

// Pick an item the drone should fetch from the core to feed a consumer
// (factory or item-turret). Without this trip the autopilot has no path
// from "drone empty" to "drone carries an input the core supplies",
// which is why core->factory and core->turret refused to work.
function findCoreFetchForConsumer(unit, team) {
    const core = Vars.player.closestCore();
    if (!core || !core.items) return null;
    const builds = teamBuildings(team);
    if (!builds) return null;
    const turretsOn = Core.settings.getBool("eui-auto-fill-turrets", true);
    const probeUnit = Vars.player.unit();

    let chosenItem = null;

    // Pass 1: turrets get their own gating — any room (acceptStack>0)
    // counts, not just fully-empty ammo. This is the "separate logic"
    // turrets need: with the recipe-aware trigger non-turrets fire on
    // (stock<recipe), partial-stock reconstructors and crafters would
    // otherwise hog every fetch trip and turrets would just drain to
    // empty waiting their turn. Iterating turrets first guarantees
    // they get serviced before the iteration reaches a consumer that's
    // also asking.
    if (turretsOn) {
        builds.each(b => {
            if (chosenItem) return;
            try {
                const block = b.block;
                if (!(block instanceof ItemTurret)) return;
                if (!consumerConfig.isEnabled(block)) return;
                if (!block.ammoTypes) return;
                let pick = null;
                block.ammoTypes.each((item, ammo) => {
                    if (pick) return;
                    if (!turretAmmoConfig.isEnabled(block, item)) return;
                    if (core.items.get(item) < coreLimits.getLimit(item)) return;
                    if (b.acceptStack(item, 1, probeUnit) <= 0) return;
                    pick = item;
                });
                if (pick) chosenItem = pick;
            } catch (e) {}
        });
        if (chosenItem) {
            return { x: core.x, y: core.y, b: core, item: chosenItem, expectsConsumer: false, kind: "core-fetch" };
        }
    }

    // Pass 2: non-turret consumers (crafters, generators, unit factories).
    builds.each(b => {
        if (chosenItem) return;
        try {
            const block = b.block;
            if (!block || block instanceof ItemTurret) return;
            if (!consumerConfig.isEnabled(block)) return;
            if (!block.consumers) return;
            const ci = block.consumers.find(c =>
                c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic);
            if (!ci) return;

            // Same gate as findBestConsumer / auto-fill: only fetch when
            // this consumer's stock is below the user's fill target AND
            // it physically accepts the item right now. Otherwise the
            // drone fetches an item it can't deliver (consumer's slot is
            // already at target) and shuttles it back to the core.
            const stockOf = (item) => b.items ? b.items.get(item) : 0;
            const wants = (item) => {
                const target = consumerConfig.getTargetFill(b, item);
                if (stockOf(item) >= target) return false;
                return b.acceptStack(item, 1, probeUnit) > 0;
            };

            if (ci instanceof ConsumeItems) {
                for (let i = 0; i < ci.items.length; i++) {
                    const item = ci.items[i].item;
                    if (core.items.get(item) < coreLimits.getLimit(item)) continue;
                    if (!wants(item)) continue;
                    chosenItem = item;
                    return;
                }
            } else if (ci instanceof ConsumeItemFilter) {
                Vars.content.items().each(item => {
                    if (chosenItem) return;
                    if (!ci.filter.get(item)) return;
                    try { if (item == Items.blastCompound) return; } catch (e) {}
                    if (core.items.get(item) < coreLimits.getLimit(item)) return;
                    if (!wants(item)) return;
                    chosenItem = item;
                });
            } else {
                // ConsumeItemDynamic — UnitFactory currentPlan path.
                if (block instanceof UnitFactory && b.currentPlan != -1) {
                    const reqs = block.plans.get(b.currentPlan).requirements;
                    for (let i = 0; i < reqs.length; i++) {
                        const item = reqs[i].item;
                        if (core.items.get(item) < coreLimits.getLimit(item)) continue;
                        if (!wants(item)) continue;
                        chosenItem = item;
                        return;
                    }
                }
            }
        } catch (e) {}
    });

    if (!chosenItem) return null;
    return { x: core.x, y: core.y, b: core, item: chosenItem, expectsConsumer: false, kind: "core-fetch" };
}

function findBestConsumer(unit, item, team) {
    const builds = teamBuildings(team);
    if (!builds) return null;
    let bestB = null;
    let bestStock = Infinity;
    const debugging = dbg();

    builds.each(b => {
        try {
            const block = b.block;
            if (!block) return;
            const isItemTurret = block instanceof ItemTurret;
            if (!isItemTurret) {
                if (!block.consumers) return;
                const wantsItem = block.consumers.find(c =>
                    c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic);
                if (!wantsItem) return;
            }
            if (!consumerConfig.isEnabled(block)) return;

            // The fill-pct slider is the user's "top up consumers to X%
            // of capacity" knob, so the right gate is "is this consumer
            // BELOW that target?" — not "could the drone deliver a
            // full batch?". With the old room-based filter and pct=100
            // any partially-filled consumer was rejected (room < cap)
            // even though the drone could top up the remaining slot,
            // and the autopilot kept fetching from core only to dump
            // back ("shuttle" loop).
            const target = consumerConfig.getTargetFill(b, item);
            const stock = b.items ? b.items.get(item) : 0;
            if (stock >= target) {
                if (debugging) dlog(blockTag(b) + " skip(" + item.name + "): stock=" + stock + " >= target=" + target);
                return;
            }
            if (b.acceptStack(item, 1, unit) <= 0) {
                if (debugging) dlog(blockTag(b) + " skip(" + item.name + "): acceptStack=0 (buffer full / refused)");
                return;
            }

            if (debugging) dlog(blockTag(b) + " cand(" + item.name + "): stock=" + stock + " target=" + target);
            if (stock < bestStock) {
                bestStock = stock;
                bestB = b;
            }
        } catch (e) {
            if (debugging) dlog(blockTag(b) + " error: " + e);
        }
    });

    if (!bestB) {
        if (debugging) dlog("findBestConsumer(" + item.name + "): no candidate");
        return null;
    }
    if (debugging) dlog("findBestConsumer(" + item.name + ") -> " + blockTag(bestB) + " stock=" + bestStock);
    return { x: bestB.x, y: bestB.y, b: bestB, item: item, expectsConsumer: true };
}

function findBestProducer(unit, team, factoryOn, drillOn, requireItem) {
    const builds = teamBuildings(team);
    if (!builds) return null;
    let bestB = null;
    let bestItem = null;
    let bestScore = -1;
    // requireItem set === top-up mode (drone is already carrying the item).
    // The pickup-threshold guards the "should the drone visit this producer
    // from idle?" decision. For a top-up the drone is committed to the item
    // anyway, so any positive stock is fair game — otherwise a drone that
    // partial-delivered to a factory parks at the consumer with 3 of an
    // item because every drill is just under the user's collect threshold.
    const topUp = requireItem != null;

    builds.each(b => {
        try {
            const block = b.block;
            if (!block) return;

            // Both top-up and from-empty collection respect the user's
            // pickup-threshold slider. For a top-up trip we'd otherwise
            // strand the drone trickle-pulling 1 unit at a time from a
            // slow drill while a fully-stocked drill nearby is ignored.
            // Threshold is per-item: GenericCrafter outputs cap below
            // itemCapacity (cap - craftAmount), so it must be computed
            // against the specific output, not the block as a whole.
            if (factoryOn && block instanceof GenericCrafter
                && block.outputItems != null
                && collectConfig.isFactoryEnabled(block)) {
                if (!b.items) return;
                for (let i = 0; i < block.outputItems.length; i++) {
                    const it = block.outputItems[i].item;
                    if (requireItem && it !== requireItem) continue;
                    const stock = b.items.get(it);
                    const pickupThr = collectConfig.getPickupThreshold(block, it);
                    if (stock >= pickupThr && stock > bestScore) {
                        bestScore = stock;
                        bestB = b;
                        bestItem = it;
                    }
                }
                return;
            }

            if (drillOn && block instanceof Drill && b.items) {
                const dom = b.dominantItem;
                if (dom == null) return;
                if (requireItem && dom !== requireItem) return;
                if (!collectConfig.isDrillItemEnabled(dom)) return;
                const stock = b.items.get(dom);
                const pickupThr = collectConfig.getPickupThreshold(block, dom);
                if (stock >= pickupThr && stock > bestScore) {
                    bestScore = stock;
                    bestB = b;
                    bestItem = dom;
                }
            }
        } catch (e) {}
    });

    if (!bestB || !bestItem) return null;
    return { x: bestB.x, y: bestB.y, b: bestB, item: bestItem, expectsConsumer: false };
}
