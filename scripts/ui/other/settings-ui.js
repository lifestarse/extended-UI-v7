const coreLimits = require("extended-ui/interact/core-limits");
const collectConfig = require("extended-ui/interact/collect-config");
const storageConfig = require("extended-ui/interact/storage-config");
const storageFill = require("extended-ui/interact/storage-fill");
const consumerConfig = require("extended-ui/interact/consumer-config");
const turretAmmoConfig = require("extended-ui/interact/turret-ammo-config");
const taskPriority = require("extended-ui/interact/task-priority");
const storageEditDialog = require("extended-ui/ui/dialogs/storage-edit-dialog");
const iconsUtil = require("extended-ui/utils/icons");

// === Per-sub-dialog reset helpers ============================================
// Each one removes only the prefix-keyed Core.settings entries that its own
// dialog owns. We enumerate keys directly from Vars.content (items, blocks,
// team buildings, task list) instead of walking Core.settings.values, because
// the values map's key iterator (orderedKeys/keys) doesn't behave reliably
// from Rhino in this Mindustry build — that's why earlier prefix-sweep
// attempts looked like the reset button "did nothing".

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

// Standard "Сбросить по умолчанию" button for sub-dialogs. Uses the mod's
// own confirm-text bundle key — Mindustry's "settings.reset.confirm" key
// resolves fine for the engine's native showConfirm but comes back as
// "???settings.reset.confirm???" through Core.bundle.get from Rhino.
function addStandardReset(dialog, doReset) {
    dialog.buttons.button(Core.bundle.get("settings.reset"), () => {
        Vars.ui.showConfirm(
            Core.bundle.get("confirm"),
            Core.bundle.get("eui.reset-confirm"),
            doReset
        );
    }).size(240, 60);
}

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

        // Track every pref name so the custom reset below can remove it.
        // We replace SettingsTable's auto-appended "reset to defaults"
        // entirely: it has no confirm in this Mindustry build, and its
        // loop only walks these prefs (not the sub-dialog configs the
        // user also wants cleared). Resetting via Core.settings.remove
        // sidesteps the Rhino-Double pitfall (Core.settings.put with a
        // JS number crashes — getInt/getBool read defaults instead when
        // the key is absent, so rebuild() restores the slider/check UIs).
        const REGISTERED_PREF_NAMES = [];
        const checkPref = (name, def) => {
            REGISTERED_PREF_NAMES.push(name);
            contentTable.checkPref(name, def);
        };
        const sliderPref = (name, def, min, max, step, formatter) => {
            REGISTERED_PREF_NAMES.push(name);
            contentTable.sliderPref(name, def, min, max, step, formatter);
        };

        checkPref("eui-showPowerBar", true);
        checkPref("eui-showFactoryProgress", true);
        checkPref("eui-showUnitBar", true);
        checkPref("eui-ShowUnitTable", true);
        checkPref("eui-ShowBlockInfo", true);
        checkPref("eui-ShowAlerts", true);
        checkPref("eui-ShowAlertsBottom", false);
        checkPref("eui-ShowResourceRate", false);
        checkPref("eui-ShowSchematicsTable", true);
        checkPref("eui-ShowSchematicsPreview", true);
        sliderPref("eui-SchematicsTableRows", 4, 2, 20, 1, i => i);
        sliderPref("eui-SchematicsTableColumns", 5, 4, 16, 1, i => i);
        sliderPref("eui-SchematicsTableButtonSize", 30, 20, 80, 2, i => i);
        checkPref("eui-ShowEfficiency", false);
        sliderPref("eui-EfficiencyTimer", 15, 10, 180, 5, i => i);
        checkPref("eui-TrackPlayerCursor", false);
        sliderPref("eui-playerCursorStyle", 7, 1, 7, 1, i => i);
        checkPref("eui-ShowOwnCursor", false);
        checkPref("eui-TrackLogicControl", false);
        sliderPref("eui-maxZoom", 10, 1, 10, 1, i => i);
        checkPref("eui-makeMineble", false);
        checkPref("eui-showInteractSettings", true);
        sliderPref("eui-core-limit-global", coreLimits.DEFAULT_LIMIT, 0, 1000, 10, i => i);
        checkPref("eui-auto-collect-factory", false);
        checkPref("eui-auto-collect-drill", false);
        sliderPref("eui-collect-threshold", 50, 0, 100, 5, i => i + " %");
        checkPref("eui-storage-fill", false);
        checkPref("eui-storage-click-ui", true);
        checkPref("eui-storage-hover-ui", true);
        checkPref("eui-auto-fill-turrets", true);
        sliderPref("eui-auto-fill-min-amount", consumerConfig.DEFAULT_MIN_AMOUNT, 1, 50, 1, i => i);
        checkPref("eui-auto-pilot", false);
        sliderPref("eui-steering-cooldown-sec", 2, 0, 10, 1, i => i + " s");
        sliderPref("eui-action-delay", 500, 0, 3000, 25, i => i + " ms");
        if (!Vars.mobile) {
            checkPref("eui-DragBlock", false);
            checkPref("eui-DragPathfind", false);
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

        // Replace SettingsTable's auto-appended reset:
        // 1. Hide the trailing auto-reset cell (size 0 + invisible).
        // 2. Append our own button at the end, sized like the sub-dialog
        //    buttons above it (Arc otherwise picks a min-width that wraps
        //    "Сбросить по умолчанию" one character per line).
        // 3. Click handler runs through showConfirm before doing anything,
        //    then resets every registered pref AND every sub-dialog config,
        //    rebuilds the table, and re-applies steps 1-2.
        function hideAutoReset() {
            try {
                const cells = contentTable.getCells();
                if (cells && cells.size > 0) {
                    const last = cells.peek();
                    const elem = last.get();
                    if (elem) elem.visible = false;
                    last.size(0, 0).pad(0).space(0);
                }
            } catch (e) {
                log("eui hide auto-reset: " + e);
            }
        }
        function resetAllRegisteredPrefs() {
            for (let i = 0; i < REGISTERED_PREF_NAMES.length; i++) {
                try { Core.settings.remove(REGISTERED_PREF_NAMES[i]); } catch (e) {}
            }
        }
        function addCustomReset() {
            contentTable.row();
            contentTable.button(Core.bundle.get("settings.reset"), () => {
                Vars.ui.showConfirm(
                    Core.bundle.get("confirm"),
                    Core.bundle.get("eui.reset-confirm"),
                    () => {
                        resetAllRegisteredPrefs();
                        resetAllSubDialogSettings();
                        try { contentTable.rebuild(); } catch (e) {}
                        hideAutoReset();
                        addCustomReset();
                    }
                );
            }).width(360).height(50).pad(8);
        }
        hideAutoReset();
        addCustomReset();

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
    addStandardReset(dialog, () => {
        resetCoreLimitsSettings();
        rebuild();
    });

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
    addStandardReset(dialog, () => {
        resetCollectTargetsSettings();
        rebuild();
    });

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
    addStandardReset(dialog, () => {
        resetStorageSettings();
        rebuild();
    });

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

    addStandardReset(dialog, () => {
        resetTaskPrioritySettings();
        rebuild();
    });

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
