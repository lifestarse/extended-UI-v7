// Shared dialog helpers: row backgrounds, separators, and the standard
// reset button used by every sub-dialog of the EUI settings menu.
// Extracted from ui/other/settings-ui.js so each sub-dialog can be
// edited without touching the others.

// Background drawable used to frame each list row in the sub-dialogs.
// Styles.black3 is a black panel with raised edges — same drawable that gives
// block-info-ui its visible bordered look. Tex.pane / Tex.buttonEdge4 were too
// faint to see across the very wide rows in the priority dialog.
const ROW_BG = (function() {
    try { if (Styles.black3 != null) return Styles.black3; } catch (e) {}
    try { if (Tex.buttonEdge4 != null) return Tex.buttonEdge4; } catch (e) {}
    try { if (Tex.button != null) return Tex.button; } catch (e) {}
    try { if (Tex.pane != null) return Tex.pane; } catch (e) {}
    return null;
})();

// Drop a thin colored horizontal line under a row so the eye can trace from
// the left-side icon/checkbox to the right-side priority field even when the
// row background drawable is too subtle on the current Mindustry theme.
function addRowSeparator(parent) {
    try {
        parent.image(Tex.whiteui).color(Pal.gray).height(2).growX().padTop(0).padBottom(0);
        parent.row();
    } catch (e) {}
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

exports.ROW_BG = ROW_BG;
exports.addRowSeparator = addRowSeparator;
exports.addStandardReset = addStandardReset;
