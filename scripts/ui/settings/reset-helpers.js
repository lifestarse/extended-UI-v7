// Per-sub-dialog reset helpers — each one removes only the prefix-keyed
// Core.settings entries that its own dialog owns. Keys are enumerated
// from Vars.content (items, blocks, team buildings, task list) instead
// of walking Core.settings.values, because the values map's key
// iterator (orderedKeys/keys) doesn't behave reliably from Rhino in
// this Mindustry build — earlier prefix-sweep attempts looked like the
// reset button "did nothing".

const coreLimits = require("extended-ui/interact/core-limits");
const storageFill = require("extended-ui/interact/storage-fill");
const consumerConfig = require("extended-ui/interact/consumer-config");
const taskPriority = require("extended-ui/interact/task-priority");

function resetCoreLimitsSettings() {
    Vars.content.items().each(item => coreLimits.resetLimit(item));
}

function resetCollectTargetsSettings() {
    Vars.content.blocks().each(block => {
        Core.settings.remove("eui-collect-factory-" + block.name);
    });
    Vars.content.items().each(item => {
        Core.settings.remove("eui-collect-drill-" + item.name);
    });
}

function resetStorageSettings() {
    // Sweep currently-owned storages by their tile coords. Keys for
    // destroyed storages are inert (no building -> no UI -> no behaviour),
    // so leaving them is acceptable.
    try {
        const team = Vars.player ? Vars.player.team() : null;
        const data = team ? team.data() : null;
        const builds = data ? data.buildings : null;
        if (!builds) return;
        builds.each(b => {
            try {
                if (!storageFill.isManagedStorage(b.block)) return;
                Core.settings.remove("eui-storage-priority-" + b.tile.x + "_" + b.tile.y);
                Vars.content.items().each(item => {
                    Core.settings.remove("eui-storage-fill-" + b.tile.x + "_" + b.tile.y + "-" + item.name);
                    Core.settings.remove("eui-storage-drain-" + b.tile.x + "_" + b.tile.y + "-" + item.name);
                });
            } catch (e) {}
        });
    } catch (e) {
        log("eui reset storage: " + e);
    }
}

function resetTaskPrioritySettings() {
    for (let i = 0; i < taskPriority.TASKS.length; i++) {
        taskPriority.reset(taskPriority.TASKS[i].id);
        Core.settings.remove(taskPriority.ENABLED_PREFIX + taskPriority.TASKS[i].id);
    }
    for (let i = 0; i < consumerConfig.CATEGORIES.length; i++) {
        Core.settings.remove("eui-consumer-cat-expanded-" + consumerConfig.CATEGORIES[i]);
    }
    Vars.content.blocks().each(block => {
        Core.settings.remove("eui-consumer-enabled-" + block.name);
        Core.settings.remove("eui-consumer-priority-" + block.name);
        Core.settings.remove("eui-turret-priority-" + block.name);
        try {
            if (block instanceof ItemTurret && block.ammoTypes) {
                block.ammoTypes.each((item, bullet) => {
                    Core.settings.remove("eui-turret-ammo-enabled-" + block.name + "-" + item.name);
                    Core.settings.remove("eui-turret-ammo-priority-" + block.name + "-" + item.name);
                });
            }
        } catch (e) {}
    });
}

function resetAllSubDialogSettings() {
    try { resetCoreLimitsSettings(); } catch (e) { log("eui reset core-limits: " + e); }
    try { resetCollectTargetsSettings(); } catch (e) { log("eui reset collect: " + e); }
    try { resetStorageSettings(); } catch (e) { log("eui reset storage: " + e); }
    try { resetTaskPrioritySettings(); } catch (e) { log("eui reset task-priority: " + e); }
}

exports.resetCoreLimitsSettings = resetCoreLimitsSettings;
exports.resetCollectTargetsSettings = resetCollectTargetsSettings;
exports.resetStorageSettings = resetStorageSettings;
exports.resetTaskPrioritySettings = resetTaskPrioritySettings;
exports.resetAllSubDialogSettings = resetAllSubDialogSettings;
