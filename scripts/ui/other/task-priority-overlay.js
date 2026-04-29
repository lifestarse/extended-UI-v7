const taskPriority = require("extended-ui/interact/task-priority");

const EXPANDED_KEY = "eui-task-overlay-expanded";

let panel = null;
let body = null;
let header = null;
let isBuilt = false;

Events.on(ClientLoadEvent, () => {
    Vars.ui.hudGroup.fill(null, t => {
        panel = t.table(Styles.black3).margin(6).get();
        panel.visibility = () => Core.settings.getBool("eui-task-overlay", false) && Vars.ui.hudfrag.shown;
        t.bottom().left();
        t.pack();
    });
});

Events.run(Trigger.update, () => {
    if (!Core.settings.getBool("eui-task-overlay", false)) {
        if (isBuilt) clearPanel();
        return;
    }
    if (!panel) return;
    if (!isBuilt) buildPanel();
});

function clearPanel() {
    if (!isBuilt) return;
    panel.clearChildren();
    body = null;
    header = null;
    isBuilt = false;
}

function buildPanel() {
    panel.clearChildren();

    header = panel.button(() => {
        const expanded = Core.settings.getBool(EXPANDED_KEY, false);
        return (expanded ? "[ - ] " : "[ + ] ") + Core.bundle.get("eui.task-priority.overlay-title");
    }, Styles.cleart, () => {
        const expanded = !Core.settings.getBool(EXPANDED_KEY, false);
        Core.settings.put(EXPANDED_KEY, expanded);
        rebuildBody();
    }).left().width(260).get();
    panel.row();

    panel.table(t => { body = t; }).left().growX();

    isBuilt = true;
    rebuildBody();
}

function rebuildBody() {
    if (!body) return;
    body.clearChildren();

    if (!Core.settings.getBool(EXPANDED_KEY, false)) {
        return;
    }

    const tasks = taskPriority.TASKS.slice();
    tasks.sort((a, b) => taskPriority.get(b.id) - taskPriority.get(a.id));

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        body.label(() => {
            const value = taskPriority.get(task.id);
            return value + "  " + Core.bundle.get(task.bundleKey);
        }).left().pad(2);
        body.row();
    }
}
