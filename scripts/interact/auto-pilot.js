const collectConfig = require("extended-ui/interact/collect-config");
const storageConfig = require("extended-ui/interact/storage-config");
const storageFill = require("extended-ui/interact/storage-fill");
const coreLimits = require("extended-ui/interact/core-limits");
const playerBusy = require("extended-ui/interact/player-busy");
const taskPriority = require("extended-ui/interact/task-priority");

const RESCAN_TICKS = 30;
const ARRIVE_PADDING = Vars.tilesize * 2;

let cached = null;
let scanTick = RESCAN_TICKS;

Events.run(Trigger.update, () => {
    if (!Core.settings.getBool("eui-auto-pilot", false)) {
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
    if (target.kind === "core-fetch" || target.kind === "core-dump") return false;
    const stack = unit.stack;
    if (target.kind === "producer-topup") {
        if (stack.amount === 0 || stack.item !== target.item) return true;
        if (!target.b.items || target.b.items.get(target.item) <= 0) return true;
        const cap = unit.type ? unit.type.itemCapacity : 0;
        if (cap > 0 && stack.amount >= cap) return true;
        return false;
    }
    if (stack.amount > 0 && stack.item) {
        if (!target.expectsConsumer) return true;
        if (target.item !== stack.item) return true;
        return target.b.acceptStack(stack.item, 5, unit) < 5;
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
            if (c) candidates.push({ task: "consumer-deliver", target: c });
        }
        if (storageOn) {
            const s = findBestStorageNeed(unit, stack.item, team);
            if (s) candidates.push({ task: "storage-deliver", target: s });
        }
        const dumpCore = Vars.player.closestCore();
        if (dumpCore) {
            candidates.push({
                task: "core-dump",
                target: { x: dumpCore.x, y: dumpCore.y, b: dumpCore, item: stack.item, expectsConsumer: false, kind: "core-dump" }
            });
        }
    } else {
        if (storageOn) {
            const fetch = findCoreFetchForStorage(unit, team);
            if (fetch) candidates.push({ task: "storage-fetch", target: fetch });
        }
        if (factoryOn || drillOn) {
            const p = findBestProducer(unit, team, factoryOn, drillOn, null);
            if (p) candidates.push({ task: "producer-collect", target: p });
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
    builds.each(b => {
        try {
            if (!storageFill.isManagedStorage(b.block)) return;
            const threshold = storageConfig.getThreshold(b, item);
            if (threshold <= 0) return;
            if (!b.items) return;
            const stock = b.items.get(item);
            if (stock >= threshold) return;
            if (b.acceptStack(item, 5, unit) < 5) return;
            const deficit = threshold - stock;
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
    let chosen = null;
    builds.each(b => {
        if (chosen) return;
        try {
            if (!storageFill.isManagedStorage(b.block)) return;
            const item = storageConfig.findNeededItem(b, it =>
                core.items.get(it) >= coreLimits.getLimit(it));
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
            if (!block || !block.consumers) return;
            const wantsItem = block.consumers.find(c =>
                c instanceof ConsumeItems || c instanceof ConsumeItemFilter || c instanceof ConsumeItemDynamic);
            if (!wantsItem) return;
            if (b.acceptStack(item, 5, unit) < 5) return;

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

    builds.each(b => {
        try {
            const block = b.block;
            if (!block) return;

            if (factoryOn && block instanceof GenericCrafter
                && block.outputItems != null
                && collectConfig.isFactoryEnabled(block)) {
                if (!b.items) return;
                const thr = collectConfig.getPickupThreshold(block);
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
                const thr = collectConfig.getPickupThreshold(block);
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
