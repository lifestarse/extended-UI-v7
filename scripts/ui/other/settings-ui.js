const coreLimits = require("extended-ui/interact/core-limits");
const collectConfig = require("extended-ui/interact/collect-config");
const storageConfig = require("extended-ui/interact/storage-config");
const storageFill = require("extended-ui/interact/storage-fill");
const turretConfig = require("extended-ui/interact/turret-config");
const taskPriority = require("extended-ui/interact/task-priority");
const storageEditDialog = require("extended-ui/ui/dialogs/storage-edit-dialog");
const iconsUtil = require("extended-ui/utils/icons");

Events.on(EventType.ClientLoadEvent, () => {
    Vars.ui.settings.addCategory("@eui.name", t => {
        t.row();
        t.button(Core.bundle.get("eui.name"), Styles.defaultt, () => extendedUIDialogSettings.show()).width(240).height(50);
    })

    const extendedUIDialogSettings = new BaseDialog(Core.bundle.get("eui.settings"));
    extendedUIDialogSettings.addCloseButton();
    extendedUIDialogSettings.buttons.defaults().size(240, 60);

    const coreLimitsDialog = buildCoreLimitsDialog();
    const collectTargetsDialog = buildCollectTargetsDialog();
    const storageListDialog = buildStorageListDialog();
    const turretPriorityDialog = buildTurretPriorityDialog();
    const taskPriorityDialog = buildTaskPriorityDialog();

    extendedUIDialogSettings.cont.pane((() => {

        let contentTable;
        if (Version.number < 7) {
            contentTable = new Packages.arc.scene.ui.SettingsDialog.SettingsTable();
        } else {
            contentTable = new SettingsMenuDialog.SettingsTable();
        }

        contentTable.checkPref("eui-showPowerBar", true);
        contentTable.checkPref("eui-showFactoryProgress", true);
        contentTable.checkPref("eui-showUnitBar", true);
        contentTable.checkPref("eui-ShowUnitTable", true);
        contentTable.checkPref("eui-ShowBlockInfo", true);
        contentTable.checkPref("eui-ShowAlerts", true);
        contentTable.checkPref("eui-ShowAlertsBottom", false);
        contentTable.checkPref("eui-ShowResourceRate", false);
        contentTable.checkPref("eui-ShowSchematicsTable", true);
        contentTable.checkPref("eui-ShowSchematicsPreview", true);
        contentTable.sliderPref("eui-SchematicsTableRows", 4, 2, 20, 1, i => i);
        contentTable.sliderPref("eui-SchematicsTableColumns", 5, 4, 16, 1, i => i);
        contentTable.sliderPref("eui-SchematicsTableButtonSize", 30, 20, 80, 2, i => i);
        contentTable.checkPref("eui-ShowEfficiency", false);
        contentTable.sliderPref("eui-EfficiencyTimer", 15, 10, 180, 5, i => i);
        contentTable.checkPref("eui-TrackPlayerCursor", false);
        contentTable.sliderPref("eui-playerCursorStyle", 7, 1, 7, 1, i => i);
        contentTable.checkPref("eui-ShowOwnCursor", false);
        contentTable.checkPref("eui-TrackLogicControl", false);
        contentTable.sliderPref("eui-maxZoom", 10, 1, 10, 1, i => i);
        contentTable.checkPref("eui-makeMineble", false);
        contentTable.checkPref("eui-showInteractSettings", true);
        contentTable.sliderPref("eui-core-limit-global", coreLimits.DEFAULT_LIMIT, 0, 1000, 10, i => i);
        contentTable.checkPref("eui-auto-collect-factory", false);
        contentTable.checkPref("eui-auto-collect-drill", false);
        contentTable.sliderPref("eui-collect-threshold", 50, 0, 100, 5, i => i + " %");
        contentTable.checkPref("eui-storage-fill", false);
        contentTable.checkPref("eui-storage-click-ui", true);
        contentTable.checkPref("eui-storage-hover-ui", true);
        contentTable.checkPref("eui-auto-fill-turrets", true);
        contentTable.checkPref("eui-auto-pilot", false);
        contentTable.checkPref("eui-task-overlay", false);
        contentTable.sliderPref("eui-action-delay", 500, 0, 3000, 25, i => i + " ms");
        if (!Vars.mobile) {
            contentTable.checkPref("eui-DragBlock", false);
            contentTable.checkPref("eui-DragPathfind", false);
        }

        return contentTable;
    })());

    extendedUIDialogSettings.cont.row();
    extendedUIDialogSettings.cont.button(
        Core.bundle.get("eui.core-limits.open"),
        Icon.box,
        () => coreLimitsDialog.show()
    ).width(360).height(50).pad(8);
    extendedUIDialogSettings.cont.row();
    extendedUIDialogSettings.cont.button(
        Core.bundle.get("eui.collect-targets.open"),
        Icon.box,
        () => collectTargetsDialog.show()
    ).width(360).height(50).pad(8);
    extendedUIDialogSettings.cont.row();
    extendedUIDialogSettings.cont.button(
        Core.bundle.get("eui.storage.open"),
        Icon.box,
        () => storageListDialog.show()
    ).width(360).height(50).pad(8);
    extendedUIDialogSettings.cont.row();
    extendedUIDialogSettings.cont.button(
        Core.bundle.get("eui.turret-priority.open"),
        Icon.box,
        () => turretPriorityDialog.show()
    ).width(360).height(50).pad(8);
    extendedUIDialogSettings.cont.row();
    extendedUIDialogSettings.cont.button(
        Core.bundle.get("eui.task-priority.open"),
        Icon.box,
        () => taskPriorityDialog.show()
    ).width(360).height(50).pad(8);

    global.eui.settings = extendedUIDialogSettings;
    global.eui.coreLimitsDialog = coreLimitsDialog;
    global.eui.collectTargetsDialog = collectTargetsDialog;
    global.eui.storageListDialog = storageListDialog;
    global.eui.turretPriorityDialog = turretPriorityDialog;
    global.eui.taskPriorityDialog = taskPriorityDialog;
});

function buildCoreLimitsDialog() {
    const dialog = new BaseDialog(Core.bundle.get("eui.core-limits.title"));
    dialog.addCloseButton();
    dialog.buttons.button(Core.bundle.get("eui.core-limits.reset-all"), () => {
        Vars.ui.showConfirm(
            Core.bundle.get("eui.core-limits.reset-all"),
            Core.bundle.get("eui.core-limits.reset-confirm"),
            () => {
                Vars.content.items().each(item => coreLimits.resetLimit(item));
                rebuild();
            }
        );
    }).size(240, 60);

    let listTable = null;
    dialog.cont.add(Core.bundle.get("eui.core-limits.hint")).width(580).wrap().pad(6).get().setAlignment(Align.center);
    dialog.cont.row();
    dialog.cont.pane(t => { listTable = t; t.top(); }).grow().maxHeight(540);

    function rebuild() {
        if (!listTable) return;
        listTable.clearChildren();
        const items = [];
        Vars.content.items().each(item => items.push(item));
        items.sort((a, b) => a.id - b.id);
        for (let i = 0; i < items.length; i++) {
            addItemRow(listTable, items[i]);
        }
    }

    function addItemRow(parent, item) {
        parent.image(iconsUtil.getByName(item.name)).size(32).pad(4);
        parent.add(item.localizedName).left().width(140).pad(4);

        parent.check("", coreLimits.isOverridden(item), b => {
            coreLimits.setOverridden(item, b);
        }).pad(4).tooltip(Core.bundle.get("eui.core-limits.override-tooltip"));

        const fieldCell = parent.field(coreLimits.getStoredLimit(item) + "", text => {
            const v = parseInt(text);
            if (!isNaN(v)) {
                const clamped = Math.max(0, Math.min(coreLimits.LIMIT_MAX, v));
                coreLimits.setLimit(item, clamped);
            }
        });
        fieldCell.valid(text => /^\d+$/.test(text) && parseInt(text) <= coreLimits.LIMIT_MAX);
        fieldCell.width(110).pad(4);
        const fieldElement = fieldCell.get();

        parent.button(Icon.cancel, Styles.cleari, () => {
            coreLimits.resetLimit(item);
            fieldElement.setText(coreLimits.DEFAULT_LIMIT + "");
        }).size(36).pad(4).tooltip(Core.bundle.get("eui.core-limits.reset-tooltip"));

        parent.row();
    }

    dialog.shown(() => rebuild());
    return dialog;
}

function buildCollectTargetsDialog() {
    const dialog = new BaseDialog(Core.bundle.get("eui.collect-targets.title"));
    dialog.addCloseButton();

    let listTable = null;
    dialog.cont.add(Core.bundle.get("eui.collect-targets.hint")).width(580).wrap().pad(6).get().setAlignment(Align.center);
    dialog.cont.row();
    dialog.cont.pane(t => { listTable = t; t.top(); }).grow().maxHeight(540);

    function rebuild() {
        if (!listTable) return;
        listTable.clearChildren();

        listTable.add(Core.bundle.get("eui.collect-targets.factories")).colspan(3).left().pad(8);
        listTable.row();

        const factories = [];
        Vars.content.blocks().each(block => {
            if (block instanceof GenericCrafter
                && block.outputItems != null
                && block.outputItems.length > 0
                && !block.isHidden()) {
                factories.push(block);
            }
        });
        factories.sort((a, b) => a.id - b.id);

        if (factories.length === 0) {
            listTable.add(Core.bundle.get("eui.collect-targets.no-factories")).colspan(3).left().pad(8);
            listTable.row();
        } else {
            for (let i = 0; i < factories.length; i++) {
                addFactoryRow(listTable, factories[i]);
            }
        }

        listTable.add(Core.bundle.get("eui.collect-targets.drills")).colspan(3).left().pad(8);
        listTable.row();

        const items = [];
        Vars.content.items().each(item => items.push(item));
        items.sort((a, b) => a.id - b.id);
        for (let i = 0; i < items.length; i++) {
            addDrillItemRow(listTable, items[i]);
        }
    }

    function addFactoryRow(parent, block) {
        parent.image(iconsUtil.getByName(block.name)).size(32).pad(4);
        parent.add(block.localizedName).left().growX().pad(4);
        parent.check("", collectConfig.isFactoryEnabled(block), b => {
            collectConfig.setFactoryEnabled(block, b);
        }).pad(4);
        parent.row();
    }

    function addDrillItemRow(parent, item) {
        parent.image(iconsUtil.getByName(item.name)).size(32).pad(4);
        parent.add(item.localizedName).left().growX().pad(4);
        parent.check("", collectConfig.isDrillItemEnabled(item), b => {
            collectConfig.setDrillItemEnabled(item, b);
        }).pad(4);
        parent.row();
    }

    dialog.shown(() => rebuild());
    return dialog;
}

function buildStorageListDialog() {
    const dialog = new BaseDialog(Core.bundle.get("eui.storage.title"));
    dialog.addCloseButton();

    let listTable = null;
    dialog.cont.add(Core.bundle.get("eui.storage.hint")).width(580).wrap().pad(6).get().setAlignment(Align.center);
    dialog.cont.row();
    dialog.cont.pane(t => { listTable = t; t.top(); }).grow().maxHeight(540);

    function rebuild() {
        if (!listTable) return;
        listTable.clearChildren();
        const storages = [];
        const team = Vars.player.team();
        const data = team ? team.data() : null;
        const builds = data ? data.buildings : null;
        if (builds) {
            builds.each(b => {
                try {
                    if (storageFill.isManagedStorage(b.block)) storages.push(b);
                } catch (e) {}
            });
        }

        if (storages.length === 0) {
            listTable.add(Core.bundle.get("eui.storage.no-storages")).colspan(4).pad(8);
            listTable.row();
            return;
        }

        storages.sort((a, b) => (a.tile.y * 10000 + a.tile.x) - (b.tile.y * 10000 + b.tile.x));
        for (let i = 0; i < storages.length; i++) {
            addStorageRow(listTable, storages[i]);
        }
    }

    function addStorageRow(parent, building) {
        const block = building.block;
        parent.image(iconsUtil.getByName(block.name)).size(32).pad(4);
        parent.add(block.localizedName + " (" + building.tile.x + ", " + building.tile.y + ")").left().growX().pad(4);

        const configured = storageConfig.countConfigured(building);
        parent.label(() => configured > 0
            ? Core.bundle.format("eui.storage.row-summary", configured)
            : Core.bundle.get("eui.storage.row-empty")).pad(4);

        parent.button(Icon.pencil, Styles.cleari, () => {
            storageEditDialog.build(building, () => rebuild()).show();
        }).size(36).pad(4);

        parent.row();
    }

    dialog.shown(() => rebuild());
    return dialog;
}

function buildTurretPriorityDialog() {
    const dialog = new BaseDialog(Core.bundle.get("eui.turret-priority.title"));
    dialog.addCloseButton();

    let turretBlocks = [];

    dialog.buttons.button(Core.bundle.get("eui.turret-priority.reset-all"), () => {
        Vars.ui.showConfirm(
            Core.bundle.get("eui.turret-priority.reset-all"),
            Core.bundle.get("eui.turret-priority.reset-confirm"),
            () => {
                for (let i = 0; i < turretBlocks.length; i++) {
                    turretConfig.setPriority(turretBlocks[i], 0);
                }
                rebuild();
            }
        );
    }).size(240, 60);

    let listTable = null;
    dialog.cont.add(Core.bundle.get("eui.turret-priority.hint")).width(580).wrap().pad(6).get().setAlignment(Align.center);
    dialog.cont.row();
    dialog.cont.pane(t => { listTable = t; t.top(); }).grow().maxHeight(540);

    function rebuild() {
        if (!listTable) return;
        listTable.clearChildren();
        turretBlocks = [];
        Vars.content.blocks().each(block => {
            if (block instanceof ItemTurret && !block.isHidden()) {
                turretBlocks.push(block);
            }
        });
        turretBlocks.sort((a, b) => {
            const pa = turretConfig.getPriority(a);
            const pb = turretConfig.getPriority(b);
            if (pa !== pb) return pb - pa;
            return a.id - b.id;
        });

        if (turretBlocks.length === 0) {
            listTable.add(Core.bundle.get("eui.turret-priority.empty")).pad(8);
            return;
        }

        for (let i = 0; i < turretBlocks.length; i++) {
            addRow(listTable, turretBlocks[i]);
        }
    }

    function addRow(parent, block) {
        parent.image(iconsUtil.getByName(block.name)).size(32).pad(4);
        parent.add(block.localizedName).left().width(180).pad(4);

        const fieldCell = parent.field(turretConfig.getPriority(block) + "", text => {
            const v = parseInt(text);
            if (!isNaN(v)) {
                turretConfig.setPriority(block, Math.max(0, Math.min(turretConfig.MAX_PRIORITY, v)));
            }
        });
        fieldCell.valid(text => /^\d+$/.test(text) && parseInt(text) <= turretConfig.MAX_PRIORITY);
        fieldCell.width(110).pad(4);
        const fieldElement = fieldCell.get();

        parent.button(Icon.cancel, Styles.cleari, () => {
            turretConfig.setPriority(block, 0);
            fieldElement.setText("0");
        }).size(36).pad(4);

        parent.row();
    }

    dialog.shown(() => rebuild());
    return dialog;
}

function buildTaskPriorityDialog() {
    const dialog = new BaseDialog(Core.bundle.get("eui.task-priority.title"));
    dialog.addCloseButton();

    let listTable = null;

    dialog.buttons.button(Core.bundle.get("eui.task-priority.reset-all"), () => {
        for (let i = 0; i < taskPriority.TASKS.length; i++) {
            taskPriority.reset(taskPriority.TASKS[i].id);
        }
        rebuild();
    }).size(240, 60);

    dialog.cont.add(Core.bundle.get("eui.task-priority.hint")).width(580).wrap().pad(6).get().setAlignment(Align.center);
    dialog.cont.row();
    dialog.cont.pane(t => { listTable = t; t.top(); }).grow().maxHeight(540);

    function rebuild() {
        if (!listTable) return;
        listTable.clearChildren();
        const tasks = taskPriority.TASKS.slice();
        tasks.sort((a, b) => taskPriority.get(b.id) - taskPriority.get(a.id));
        for (let i = 0; i < tasks.length; i++) {
            addRow(listTable, tasks[i]);
        }
    }

    function addRow(parent, task) {
        parent.add(Core.bundle.get(task.bundleKey)).left().width(280).pad(4);

        const fieldCell = parent.field(taskPriority.get(task.id) + "", text => {
            const v = parseInt(text);
            if (!isNaN(v)) {
                taskPriority.set(task.id, Math.max(0, Math.min(999, v)));
            }
        });
        fieldCell.valid(text => /^\d+$/.test(text) && parseInt(text) <= 999);
        fieldCell.width(110).pad(4);
        const fieldElement = fieldCell.get();

        parent.button(Icon.cancel, Styles.cleari, () => {
            taskPriority.reset(task.id);
            fieldElement.setText(task.defaultPriority + "");
        }).size(36).pad(4);

        parent.row();
    }

    dialog.shown(() => rebuild());
    return dialog;
}
