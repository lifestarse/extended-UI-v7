// Per-team snapshot of team.data().buildings, invalidated on
// build/destroy/world-load. Auto-pilot calls builds.each multiple times
// per scan; without this cache each scan walks the underlying Seq
// repeatedly and drives idle-tick CPU through the floor on big bases.
//
// API mirrors the Seq.each(callback) shape so call sites stay
// unchanged. Returns null when the team has no buildings yet.

const versions = {};
const cache = {};

function teamKey(team) {
    if (!team) return null;
    return team.id != null ? team.id : team.name;
}

function bumpForTeam(team) {
    const key = teamKey(team);
    if (key == null) return;
    versions[key] = (versions[key] || 0) + 1;
}

function bumpFromTile(tile) {
    if (!tile) return;
    try { bumpForTeam(tile.team()); } catch (e) {}
}

// EventType.* is the safe path here — bare BlockBuildEndEvent isn't
// exposed as a global in every Mindustry build. Each handler is also
// wrapped so a missing event class on an older version can't take the
// whole module down (and through the require cycle, drag auto-pilot
// down with it — that's how this file crashed storage-drain.js#65
// with "Cannot find function getTarget" on first load).
function safeOn(evt, fn) {
    try { if (evt) Events.on(evt, fn); } catch (e) { try { log("eui team-buildings-cache: " + e); } catch (ee) {} }
}
function clearObj(o) {
    // for (const k in o) is parse-error in this Mindustry's Rhino when
    // two such loops sit in the same scope ("redeclaration of const k").
    // Object.keys + forEach sidesteps that and stays ES5-friendly.
    Object.keys(o).forEach(k => delete o[k]);
}
safeOn(EventType.BlockBuildEndEvent, e => { if (e) bumpFromTile(e.tile); });
safeOn(EventType.BlockDestroyEvent, e => { if (e) bumpFromTile(e.tile); });
safeOn(EventType.WorldLoadEvent, () => {
    clearObj(versions);
    clearObj(cache);
});

function snapshot(team) {
    const key = teamKey(team);
    if (key == null) return null;
    const ver = versions[key] || 0;
    const entry = cache[key];
    if (entry && entry.version === ver) return entry;

    const data = team.data();
    if (!data || !data.buildings) return null;
    const arr = [];
    data.buildings.each(b => { if (b) arr.push(b); });
    const fresh = {
        version: ver,
        all: arr,
        each: function(fn) {
            const a = this.all;
            for (let i = 0; i < a.length; i++) fn(a[i]);
        }
    };
    cache[key] = fresh;
    return fresh;
}

exports.get = function(team) { return snapshot(team); };
exports.invalidate = function(team) { bumpForTeam(team); };
