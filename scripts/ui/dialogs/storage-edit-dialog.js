const storageConfig = require("extended-ui/interact/storage-config");
const iconsUtil = require("extended-ui/utils/icons");

exports.build = function(building, onClose) {
    const block = building.block;
    const dialog = new BaseDialog(block.localizedName + " (" + building.tile.x + ", " + building.tile.y + ")");
    dialog.addCloseButton();

    dialog.buttons.button(Core.bundle.get("eui.storage.clear-all"), () => {
        Vars.ui.showConfirm(
            Core.bundle.get("eui.storage.clear-all"),
            Core.bundle.get("eui.storage.clear-confirm"),
            () => {
                Vars.content.items().each(item => {
                    storageConfig.setThreshold(building, item, 0);
                    storageConfig.setDrain(building, item, false);
                });
                rebuild();
            }
        );
    }).size(240, 60);

    let listTable = null;
    dialog.cont.add(Core.bundle.get("eui.storage.edit-hint")).width(580).wrap().pad(6).get().setAlignment(Align.center);
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

        parent.label(() => {
            const stock = building.items ? building.items.get(item) : 0;
            return stock + "";
        }).width(60).right().pad(4);

        const fieldCell = parent.field(storageConfig.getThreshold(building, item) + "", text => {
            const v = parseInt(text);
            if (!isNaN(v)) {
                const clamped = Math.max(0, Math.min(storageConfig.MAX_THRESHOLD, v));
                storageConfig.setThreshold(building, item, clamped);
            }
        });
        fieldCell.valid(text => /^\d+$/.test(text) && parseInt(text) <= storageConfig.MAX_THRESHOLD);
        fieldCell.width(110).pad(4);
        const fieldElement = fieldCell.get();

        parent.button(Icon.cancel, Styles.cleari, () => {
            storageConfig.setThreshold(building, item, 0);
            fieldElement.setText("0");
        }).size(36).pad(4);

        parent.check("", storageConfig.getDrain(building, item), v => {
            storageConfig.setDrain(building, item, v);
        }).pad(4).tooltip(Core.bundle.get("eui.storage.drain-tooltip"));

        parent.row();
    }

    dialog.shown(() => rebuild());
    if (onClose) dialog.hidden(() => onClose());
    return dialog;
}
