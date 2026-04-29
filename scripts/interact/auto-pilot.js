const collectConfig = require("extended-ui/interact/collect-config");

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

    if (hasPlayerMoveInput()) {
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

function hasPlayerMoveInput() {
    try {
        const x = Core.input.axis(Binding.move_x);
        const y = Core.input.axis(Binding.move_y);
        return Math.abs(x) > 0.1 || Math.abs(y) > 0.1;
    } catch (e) {
        return false;
    }
}

function isStale(target, unit) {
    if (!target.b || target.b.dead() || target.b.tile == null || target.b.tile.build !== target.b) return true;
    const stack = unit.stack;
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
    if (stack.amount > 0 && stack.item) {
        if (!Core.settings.getBool("eui-auto-fill", false)) return null;
        return findBestConsumer(unit, stack.item, team);
    }

    const factoryOn = Core.settings.getBool("eui-auto-collect-factory", false);
    const drillOn = Core.settings.getBool("eui-auto-collect-drill", false);
    if (!factoryOn && !drillOn) return null;
    return findBestProducer(unit, team, factoryOn, drillOn);
}

function findBestConsumer(unit, item, team) {
    let bestB = null;
    let bestStock = Infinity;

    Groups.build.each(b => {
        try {
            if (b.team !== team) return;
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

function findBestProducer(unit, team, factoryOn, drillOn) {
    let bestB = null;
    let bestItem = null;
    let bestScore = -1;

    Groups.build.each(b => {
        try {
            if (b.team !== team) return;
            const block = b.block;
            if (!block) return;

            if (factoryOn && block instanceof GenericCrafter
                && block.outputItems != null
                && collectConfig.isFactoryEnabled(block)) {
                if (!b.items) return;
                for (let i = 0; i < block.outputItems.length; i++) {
                    const it = block.outputItems[i].item;
                    const stock = b.items.get(it);
                    if (stock > 0 && stock > bestScore) {
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
                if (!collectConfig.isDrillItemEnabled(dom)) return;
                const stock = b.items.get(dom);
                if (stock > 0 && stock > bestScore) {
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
