// Tracks turrets/consumers that auto-fill has just queued a
// Call.requestItem for. While a turret is "pending", eachBlock skips
// it for fresh fetches unless the drone is already carrying its item.
//
// Why: with eui-action-delay=0 ms, auto-fill's main loop runs every
// render tick. Call.requestItem is asynchronous — the 30 surge-alloy
// don't appear in the drone's stack on the very next tick. Without
// this cache, the drone re-issues the same request frame after frame,
// the turret meanwhile fires and acceptStack drops to 0, by the time
// the 30 do arrive the drone can't deliver, dumps back to core, and
// fetches again — the shuttle loop visible in last_log.txt as endless
// "FETCH surge-alloy x30 from core" with no "transfer" between them.
//
// Cleared on:
//   - successful Call.transferInventory  (auto-fill clears explicitly)
//   - BlockDestroyEvent                   (tile gone)
//   - WorldLoadEvent                      (new save / map)
//   - TTL expiry                          (fallback retry)

const pending = new ObjectMap();

function markRequested(building, item, ttlSeconds) {
    if (!building || !item) return;
    pending.put(building, { item: item, expireAt: Time.time + Time.toSeconds * ttlSeconds });
}

function get(building) {
    if (!building) return null;
    const entry = pending.get(building);
    if (!entry) return null;
    if (Time.time >= entry.expireAt) {
        pending.remove(building);
        return null;
    }
    return entry;
}

function clear(building) {
    if (!building) return;
    pending.remove(building);
}

function safeOn(evt, fn) {
    try { if (evt) Events.on(evt, fn); } catch (e) { try { log("eui turret-fetch-pending: " + e); } catch (ee) {} }
}
safeOn(EventType.BlockDestroyEvent, e => {
    try { if (e && e.tile && e.tile.build) clear(e.tile.build); } catch (err) {}
});
safeOn(EventType.WorldLoadEvent, () => {
    try { pending.clear(); } catch (e) {}
});

exports.markRequested = markRequested;
exports.get = get;
exports.clear = clear;
