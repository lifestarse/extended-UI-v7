const coreLimits = require("extended-ui/interact/core-limits");
const collectConfig = require("extended-ui/interact/collect-config");
const storageConfig = require("extended-ui/interact/storage-config");
const storageFill = require("extended-ui/interact/storage-fill");
const consumerConfig = require("extended-ui/interact/consumer-config");
const turretAmmoConfig = require("extended-ui/interact/turret-ammo-config");
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
        contentTable.sliderPref("eui-auto-fill-min-amount", consumerConfig.DEFAULT_MIN_AMOUNT, 1, 50, 1, i => i);
        contentTable.checkPref("eui-auto-pilot", false);
        contentTable.sliderPref("eui-steering-cooldown-sec", 2, 0, 10, 1, i => i + " s");
        contentTable.sliderPref("eui-action-delay", 500, 0, 3000, 25, i => i + " ms");
        if (!Vars.mobile) {
            contentTable.checkPref("eui-DragBlock", false);
            contentTable.checkPref("eui-DragPathfind", false);
        }

        // Register sub-dialog buttons as proper Settings via pref() so the
        // SettingsTable's auto-rebuild slots them in BEFORE the trailing
        // "reset to defaults" button. Falls back to a plain .button() append
        // if the Setting subclass can't be created on this Mindustry build.
        function pushButton(labelKey, dialog) {
            try {
                const Setting = SettingsMenuDialog.SettingsTable.Setting;
                const setting = new JavaAdapter(Setting, {
                    add: function(table) {
                        table.row();
                        table.button(Core.bundle.get(labelKey), Icon.box, () => dialog.show())
                            .width(360).height(50).pad(8);
                        table.row();
                    }
                }, "eui-btn-" + labelKey.replace(/\./g, "-"));
                contentTable.pref(setting);
            } catch (e) {
                contentTable.row();
                contentTable.button(Core.bundle.get(labelKey), Icon.box, () => dialog.show())
                    .width(360).height(50).pad(8);
            }
        }
        pushButton("eui.core-limits.open", coreLimitsDialog);
        pushButton("eui.collect-targets.open", collectTargetsDialog);
        pushButton("eui.storage.open", storageListDialog);
        pushButton("eui.task-priority.open", taskPriorityDialog);

        return contentTable;
    })());

    global.eui.settings = extendedUIDialogSettings;
    global.eui.coreLimitsDialog = coreLimitsDialog;
    global.eui.collectTargetsDialog = collectTargetsDialog;
    global.eui.storageListDialog = storageListDialog;
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
    dialog.cont.pane(t => { listTable = t; t.top(); }).grow().maxHeight(560);

    function rebuild() {
        if (!listTable) return;
        listTable.clearChildren();

        listTable.add(Core.bundle.get("eui.task-priority.section-tasks")).left().colspan(5).pad(8);
        listTable.row();
        const tasks = taskPriority.TASKS.slice();
        tasks.sort((a, b) => taskPriority.get(b.id) - taskPriority.get(a.id));
        for (let i = 0; i < tasks.length; i++) {
            addTaskRow(listTable, tasks[i]);
        }

        listTable.add(Core.bundle.get("eui.task-priority.section-consumers")).left().colspan(5).pad(8).padTop(20);
        listTable.row();

        const byCategory = {};
        for (let i = 0; i < consumerConfig.CATEGORIES.length; i++) {
            byCategory[consumerConfig.CATEGORIES[i]] = [];
        }
        Vars.content.blocks().each(block => {
            try {
                if (block.isHidden()) return;
                if (!consumerConfig.consumesItems(block)) return;
                const cat = consumerConfig.categorize(block);
                byCategory[cat].push(block);
            } catch (e) {}
        });

        for (let i = 0; i < consumerConfig.CATEGORIES.length; i++) {
            const cat = consumerConfig.CATEGORIES[i];
            const blocks = byCategory[cat];
            if (blocks.length === 0) continue;
            blocks.sort((a, b) => {
                const pa = consumerConfig.getPriority(a);
                const pb = consumerConfig.getPriority(b);
                if (pa !== pb) return pb - pa;
                return a.id - b.id;
            });
            addCategoryHeader(listTable, cat, blocks);
            if (consumerConfig.isCategoryExpanded(cat)) {
                for (let j = 0; j < blocks.length; j++) {
                    addBlockRow(listTable, blocks[j]);
                }
            }
        }
    }

    function addTaskRow(parent, task) {
        parent.add(Core.bundle.get(task.bundleKey)).left().colspan(2).width(360).pad(4);

        const fieldCell = parent.field(taskPriority.get(task.id) + "", text => {
            const v = parseInt(text);
            if (!isNaN(v)) taskPriority.set(task.id, Math.max(0, Math.min(999, v)));
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

    function addCategoryHeader(parent, category, blocks) {
        const expanded = consumerConfig.isCategoryExpanded(category);
        const label = (expanded ? "[ - ] " : "[ + ] ")
            + Core.bundle.get("eui.task-priority.cat-" + category)
            + " (" + blocks.length + ")";
        parent.button(label, Styles.cleart, () => {
            consumerConfig.setCategoryExpanded(category, !consumerConfig.isCategoryExpanded(category));
            rebuild();
        }).colspan(5).left().growX().pad(4);
        parent.row();
    }

    function addBlockRow(parent, block) {
        parent.image(iconsUtil.getByName(block.name)).size(28).pad(2).padLeft(20);

        parent.check("", consumerConfig.isEnabled(block), v => {
            consumerConfig.setEnabled(block, v);
        }).pad(4);

        parent.add(block.localizedName).left().growX().pad(4);

        const fieldCell = parent.field(consumerConfig.getPriority(block) + "", text => {
            const v = parseInt(text);
            if (!isNaN(v)) consumerConfig.setPriority(block, Math.max(0, Math.min(consumerConfig.MAX_PRIORITY, v)));
        });
        fieldCell.valid(text => /^\d+$/.test(text) && parseInt(text) <= consumerConfig.MAX_PRIORITY);
        fieldCell.width(80).pad(4);

        if (block instanceof ItemTurret && block.ammoTypes && !block.ammoTypes.isEmpty()) {
            parent.button(Icon.pencil, Styles.cleari, () => {
                buildTurretAmmoDialog(block).show();
            }).size(36).pad(4).tooltip(Core.bundle.get("eui.turret-ammo.button-tooltip"));
        } else {
            parent.add().size(36).pad(4);
        }

        parent.row();
    }

    dialog.shown(() => rebuild());
    return dialog;
}

function buildTurretAmmoDialog(turretBlock) {
    const dialog = new BaseDialog(turretBlock.localizedName + " — " + Core.bundle.get("eui.turret-ammo.title"));
    dialog.addCloseButton();

    let listTable = null;
    dialog.cont.add(Core.bundle.get("eui.turret-ammo.hint")).width(580).wrap().pad(6).get().setAlignment(Align.center);
    dialog.cont.row();
    dialog.cont.pane(t => { listTable = t; t.top(); }).grow().maxHeight(540);

    function rebuild() {
        if (!listTable) return;
        listTable.clearChildren();

        const entries = [];
        turretBlock.ammoTypes.each((item, bullet) => {
            entries.push({ item: item, bullet: bullet });
        });
        entries.sort((a, b) => {
            const pa = turretAmmoConfig.getPriority(turretBlock, a.item);
            const pb = turretAmmoConfig.getPriority(turretBlock, b.item);
            if (pa !== pb) return pb - pa;
            const da = a.bullet.damage + a.bullet.splashDamage;
            const db = b.bullet.damage + b.bullet.splashDamage;
            return db - da;
        });

        for (let i = 0; i < entries.length; i++) {
            addRow(listTable, entries[i]);
        }
    }

    function addRow(parent, entry) {
        parent.image(iconsUtil.getByName(entry.item.name)).size(32).pad(4);

        parent.check("", turretAmmoConfig.isEnabled(turretBlock, entry.item), v => {
            turretAmmoConfig.setEnabled(turretBlock, entry.item, v);
        }).pad(4);

        parent.add(entry.item.localizedName).left().width(160).pad(4);

        const dmg = entry.bullet.damage + entry.bullet.splashDamage;
        parent.label(() => Core.bundle.format("eui.turret-ammo.damage", Math.round(dmg))).pad(4);

        const fieldCell = parent.field(turretAmmoConfig.getPriority(turretBlock, entry.item) + "", text => {
            const v = parseInt(text);
            if (!isNaN(v)) turretAmmoConfig.setPriority(turretBlock, entry.item, Math.max(0, Math.min(turretAmmoConfig.MAX_PRIORITY, v)));
        });
        fieldCell.valid(text => /^\d+$/.test(text) && parseInt(text) <= turretAmmoConfig.MAX_PRIORITY);
        fieldCell.width(80).pad(4);

        parent.row();
    }

    dialog.shown(() => rebuild());
    return dialog;
}
