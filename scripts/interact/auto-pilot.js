const collectConfig = require("extended-ui/interact/collect-config");
const storageConfig = require("extended-ui/interact/storage-config");
const storageFill = require("extended-ui/interact/storage-fill");
const storageDrain = require("extended-ui/interact/storage-drain");
const coreLimits = require("extended-ui/interact/core-limits");
const playerBusy = require("extended-ui/interact/player-busy");
const taskPriority = require("extended-ui/interact/task-priority");
const consumerConfig = require("extended-ui/interact/consumer-config");

const RESCAN_TICKS = 30;
const ARRIVE_PADDING = Vars.tilesize * 2;

let cached = null;
let scanTick = RESCAN_TICKS;

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
        // Stay put even when the drill just emptied — it'll mine more.
        // Only abandon if the producer can never give us this item again:
        // a drill whose dominantItem changed (vein depleted / tile swap)
        // or a non-drill producer below the drip-feed threshold (so the
        // drone moves on to a faster producer instead of pulling 2 each
        // regen cycle from one slow factory).
        if (target.b.block instanceof Drill) {
            if (target.b.dominantItem !== target.item) return true;
            return false;
        }
        if (!target.b.items) return true;
        const blockMin = consumerConfig.getMinAmountFor(target.b.block);
        const thr = stack.amount >= blockMin ? blockMin : 1;
        return target.b.items.get(target.item) < thr;
    }
    if (stack.amount > 0 && stack.item) {
        if (!target.expectsConsumer) return true;
        if (target.item !== stack.item) return true;
        const blockMin = consumerConfig.getMinAmountFor(target.b.block, stack.item);
        return target.b.acceptStack(stack.item, blockMin, unit) < blockMin;
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
            if (deficit > bestDeficit) {
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
    let chosen = null;
    builds.each(b => {
        if (chosen) return;
        try {
            if (!storageFill.isManagedStorage(b.block)) return;
            const item = storageConfig.findNeededItem(b, it =>
                core.items.get(it) >= coreLimits.getLimit(it), cap);
            if (item) chosen = item;
        } catch (e) {}
    });
    if (!chosen) return null;
    return { x: core.x, y: core.y, b: core, item: chosen, expectsConsumer: false, kind: "core-fetch" };
}

function findBestConsumer(unit, item, team) {
    const builds = teamBuildings(team);
    if (!builds) return null;
    let bestB = null;
    let bestStock = Infinity;

    builds.each(b => {
        try {
            const block = b.block;
            if (!block) return;
            // ItemTurrets accept ammo through their ammoTypes map, not
            // through the consumers[] array — so the ConsumeItems-style
            // filter we use for factories misses them. Treat any
            // ItemTurret that actually accepts the drone's stack item as
            // a valid consumer-deliver target so the autopilot can route
            // ammo (otherwise the drone fetches at the core, finds no
            // valid consumer-deliver candidate, and dumps the ammo back
            // in — the double-turret graphite loop).
            const isItemTurret = block instanceof ItemTurret;
            if (!isItemTurret) {
                if (!block.consumers) return;
                const wantsItem = block.consumers.find(c =>
                    c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic);
                if (!wantsItem) return;
            }
            // Per-block batch threshold: scales with the consumer's own
            // capacity (ammo capacity for turrets) so a 10-cap factory
            // and a 100-cap one share the same fill-percent slider.
            const blockMin = consumerConfig.getMinAmountFor(block, item);
            if (b.acceptStack(item, blockMin, unit) < blockMin) return;

            const stock = b.items ? b.items.get(item) : 0;
            if (stock < bestStock) {
                bestStock = stock;
                bestB = b;
            }
        } catch (e) {}
    });

    if (!bestB) return null;
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
    const stack = unit.stack;
    // Mirror of the auto-fill drip-feed guard. Per-block batch size
    // scales with each producer's capacity (same fill-pct slider as
    // findBestConsumer / auto-fill). With a substantial stack the drone
    // skips slow producers; with a small leftover any positive stock is
    // taken so the drone doesn't get stranded.

    builds.each(b => {
        try {
            const block = b.block;
            if (!block) return;

            if (factoryOn && block instanceof GenericCrafter
                && block.outputItems != null
                && collectConfig.isFactoryEnabled(block)) {
                if (!b.items) return;
                const blockMin = consumerConfig.getMinAmountFor(block);
                const factoryTopUpThr = stack.amount >= blockMin ? blockMin : 1;
                const thr = topUp ? factoryTopUpThr : collectConfig.getPickupThreshold(block);
                for (let i = 0; i < block.outputItems.length; i++) {
                    const it = block.outputItems[i].item;
                    if (requireItem && it !== requireItem) continue;
                    const stock = b.items.get(it);
                    if (stock >= thr && stock > bestScore) {
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
                // Top-up: keep the drill as a candidate even at stock=0.
                // The drone is committed to the item; if the drill just
                // emptied (drone took the last unit) the right move is to
                // wait for the next mining cycle here, not bounce off to
                // deliver one item to a faraway consumer.
                const thr = topUp ? 0 : collectConfig.getPickupThreshold(block);
                if (stock >= thr && stock > bestScore) {
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
