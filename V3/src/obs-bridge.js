/*
 * obs-bridge.js — "OBS Source" items (obs-websocket v5, built into OBS 28+)
 *
 * The camera / window / game capture stays in OBS (no double capture, no camera
 * conflicts). A Media List item of type "obs" names an OBS source; when that item
 * is the current slide and Media is shown, SlideMang turns the source on in OBS,
 * and turns it off again when the slide changes or Media is hidden.
 *
 * One connection, from the app (not from each page), so the OBS password never
 * reaches the browser pages.
 */
'use strict';
const crypto = require('crypto');

const RETRY_MS = 5000;
const REQ_TIMEOUT = 4000;

function sha256b64(s) { return crypto.createHash('sha256').update(s).digest('base64'); }
function authString(password, salt, challenge) { return sha256b64(sha256b64(password + salt) + challenge); }

/** key used by the Controller to remember a toggle item's on/off state */
function obsKey(it) { return (it.obsScene || '*') + '|' + it.obsSource; }

function createObsBridge(opts) {
    const getObsSettings = opts.getObsSettings;   // () => { enabled, host, port, password }
    const getConfig = opts.getConfig;
    const getSession = opts.getSession;
    const onStatus = opts.onStatus || (() => {});
    const onToggleStates = opts.onToggleStates || (() => {});
    let toggleStates = {};            // obsKey -> real on/off in OBS (toggle items only)
    const onScenes = opts.onScenes || (() => {});
    let scenes = { current: '', list: [] };   // OBS scene names + the one on air
    let restoreTimer = null, restoreTo = null;  // OBS's own transition, put back after a scene button used another one
    const log = opts.log || (() => {});
    const WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);

    let ws = null;
    let identified = false;
    let retryTimer = null;
    let syncTimer = null;
    let reqId = 0;
    const pending = new Map();
    let status = { enabled: false, connected: false, error: '', obsVersion: '' };
    let applied = new Map();          // "scene|source" -> enabled (what we last sent)
    const itemIds = new Map();        // "scene|source" -> sceneItemId
    let generation = 0;

    function setStatus(patch) {
        const before = JSON.stringify(status);
        status = Object.assign({}, status, patch);
        if (JSON.stringify(status) !== before) onStatus(Object.assign({}, status));
    }

    function cleanup() {
        identified = false;
        pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error('Disconnected from OBS')); });
        pending.clear();
        applied = new Map();
        itemIds.clear();
    }

    function stop() {
        generation++;
        clearTimeout(retryTimer); retryTimer = null;
        if (ws) { const w = ws; ws = null; try { w.close(); } catch (e) {} }
        cleanup();
    }

    function scheduleRetry() {
        clearTimeout(retryTimer);
        if (getObsSettings().enabled) retryTimer = setTimeout(connect, RETRY_MS);
    }

    function connect() {
        stop();
        const s = getObsSettings();
        setStatus({ enabled: !!s.enabled, connected: false });
        if (!s.enabled) { setStatus({ error: '' }); return; }
        if (!WS) { setStatus({ error: 'WebSocket is not available' }); return; }
        const gen = generation;
        let sock;
        try {
            sock = new WS('ws://' + (s.host || '127.0.0.1') + ':' + (Number(s.port) || 4455));
        } catch (e) { setStatus({ error: String(e.message || e) }); scheduleRetry(); return; }
        ws = sock;
        sock.onmessage = (ev) => { if (gen === generation) onFrame(sock, ev.data, s); };
        sock.onerror = () => { if (gen === generation && !status.error) setStatus({ error: 'Cannot reach OBS at ' + (s.host || '127.0.0.1') + ':' + (s.port || 4455) }); };
        sock.onclose = (ev) => {
            if (gen !== generation) return;
            ws = null;
            cleanup();
            let err = status.error;
            if (ev && ev.code === 4009) err = 'Wrong OBS WebSocket password';
            else if (ev && ev.code === 4008) err = 'OBS WebSocket needs a password';
            else if (!err) err = 'Disconnected from OBS';
            setStatus({ connected: false, error: err });
            scheduleRetry();
        };
    }

    function onFrame(sock, data, s) {
        let msg;
        try { msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); } catch (e) { return; }
        if (msg.op === 0) { // Hello
            const d = { rpcVersion: 1, eventSubscriptions: 4 };   // 4 = Scenes events (scene switched / added / renamed)
            const a = msg.d && msg.d.authentication;
            if (a) d.authentication = authString(String(s.password || ''), a.salt, a.challenge);
            sock.send(JSON.stringify({ op: 1, d: d }));
            setStatus({ obsVersion: (msg.d && msg.d.obsWebSocketVersion) || '' });
        } else if (msg.op === 2) { // Identified
            identified = true;
            setStatus({ connected: true, error: '' });
            refreshScenes();
            log('connected to OBS');
            sync(true);
        } else if (msg.op === 5) { // Event
            const t = msg.d && msg.d.eventType, ed = (msg.d && msg.d.eventData) || {};
            if (t === 'CurrentProgramSceneChanged') { scenes = { current: ed.sceneName || '', list: scenes.list }; onScenes(Object.assign({}, scenes)); }
            else if (t === 'SceneListChanged' || t === 'SceneNameChanged' || t === 'SceneCreated' || t === 'SceneRemoved') { itemIds.clear(); refreshScenes(); }
        } else if (msg.op === 7) { // RequestResponse
            const p = pending.get(msg.d.requestId);
            if (!p) return;
            pending.delete(msg.d.requestId);
            clearTimeout(p.timer);
            const st = msg.d.requestStatus || {};
            if (st.result) p.resolve(msg.d.responseData || {});
            else p.reject(new Error(st.comment || ('OBS error ' + st.code)));
        }
    }

    function request(type, data) {
        return new Promise((resolve, reject) => {
            if (!ws || !identified) return reject(new Error('Not connected to OBS'));
            const id = 'sm' + (++reqId);
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('OBS did not answer')); }, REQ_TIMEOUT);
            pending.set(id, { resolve, reject, timer });
            ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
        });
    }

    async function itemId(scene, source) {
        const key = scene + '|' + source;
        if (itemIds.has(key)) return itemIds.get(key);
        const r = await request('GetSceneItemId', { sceneName: scene, sourceName: source });
        itemIds.set(key, r.sceneItemId);
        return r.sceneItemId;
    }

    /** small JPEG previews of scenes for the Controller (cached a few seconds, shared by every Controller) */
    const shotCache = new Map();   // scene -> { t, data }
    async function screenshots(names, width) {
        const w = Math.max(80, Math.min(640, Number(width) || 320));
        const out = {};
        for (const n of names) {
            const c = shotCache.get(n + '@' + w);
            if (c && Date.now() - c.t < 4000) { out[n] = c.data; continue; }
            try {
                const r = await request('GetSourceScreenshot', { sourceName: n, imageFormat: 'jpg', imageWidth: w, imageCompressionQuality: 60 });
                shotCache.set(n + '@' + w, { t: Date.now(), data: r.imageData });
                out[n] = r.imageData;
            } catch (e) { out[n] = ''; }
        }
        return out;
    }

    /** Scenes and the sources inside each (for the Setup Media drop-downs). */
    async function listSources() {
        const r = await request('GetSceneList');
        const scenes = (r.scenes || []).slice().reverse(); // OBS returns them bottom-up
        const out = [];
        for (const sc of scenes) {
            let items = [];
            try { items = (await request('GetSceneItemList', { sceneName: sc.sceneName })).sceneItems || []; } catch (e) {}
            out.push({ name: sc.sceneName, sources: items.map((i) => i.sourceName) });
        }
        let transitions = [];
        try { transitions = ((await request('GetSceneTransitionList')).transitions || []).map((x) => ({ name: x.transitionName, fixed: !!x.transitionFixed })); } catch (e) {}
        return { current: r.currentProgramSceneName || '', scenes: out, transitions: transitions };
    }

    /** Make OBS match the current slide. Only sources used by "obs" items are touched. */
    function sync(force) {
        if (force) applied = new Map();
        clearTimeout(syncTimer);
        syncTimer = setTimeout(doSync, 40);
    }

    async function refreshScenes() {
        try {
            const r = await request('GetSceneList');
            scenes = { current: r.currentProgramSceneName || '', list: (r.scenes || []).slice().reverse().map((s) => s.sceneName) };
            onScenes(Object.assign({}, scenes));
        } catch (e) { /* not connected */ }
    }

    /**
     * Switch the program scene. An OBSSCENE_LIST button can bring its own transition and
     * duration: they are used for this switch only, then OBS's own settings are put back.
     */
    async function setScene(name, transition, duration) {
        if (!name) return;
        try {
            transition = String(transition || ''); duration = Number(duration) || 0;
            let wait = 0;
            if (transition || duration) {
                if (!restoreTo) {
                    const cur = await request('GetCurrentSceneTransition');
                    restoreTo = { name: cur.transitionName, duration: cur.transitionDuration };
                }
                clearTimeout(restoreTimer);
                if (transition) await request('SetCurrentSceneTransition', { transitionName: transition });
                if (duration) { try { await request('SetCurrentSceneTransitionDuration', { transitionDuration: duration }); } catch (e) { /* fixed-length transition */ } }
                wait = (duration || (restoreTo && restoreTo.duration) || 300) + 400;
            }
            await request('SetCurrentProgramScene', { sceneName: String(name) });
            if (wait) {
                restoreTimer = setTimeout(async () => {
                    const r = restoreTo; restoreTo = null;
                    if (!r || !identified) return;
                    try {
                        await request('SetCurrentSceneTransition', { transitionName: r.name });
                        if (r.duration) await request('SetCurrentSceneTransitionDuration', { transitionDuration: r.duration });
                    } catch (e) { /* ignore */ }
                }, wait);
            }
        } catch (e) { setStatus({ error: 'Scene "' + name + '": ' + e.message }); }
    }

    async function doSync() {
        if (!identified) return;
        const cfg = getConfig();
        const sess = getSession() || {};
        const ex = sess.extra || {};
        const visible = !sess.media || sess.media.show !== false;
        const active = Number(ex.index) || 0;
        const bgVisible = !sess.background || sess.background.show !== false;
        const bgActive = Number(ex.bg_index) || 0;
        const toggles = ex.obsToggles || {};
        // OBS Sources from both lists; each list has its own current item and show/hide
        const obsItems = cfg.list.map((it, i) => ({ it, i, live: visible && i === active }))
            .concat(cfg.bgList.map((it, i) => ({ it, i, live: bgVisible && i === bgActive })))
            .filter((x) => x.it.type === 'obs' && x.it.obsSource);
        if (!obsItems.length) return;
        let program = '';
        if (obsItems.some((x) => !x.it.obsScene)) {
            try { program = (await request('GetCurrentProgramScene')).currentProgramSceneName || ''; } catch (e) { return; }
        }
        const want = new Map(); // key -> {scene, source, on}
        obsItems.forEach((x) => {
            const scene = x.it.obsScene || program;
            if (!scene) return;
            const key = scene + '|' + x.it.obsSource;
            // slide mode: on only while it is the current slide (one thing at a time)
            // toggle mode: on/off by its own switch, whatever the slide is
            if (x.it.obsMode === 'toggle') {
                // never touched until clicked in SlideMang; then it follows that click
                if (!Object.prototype.hasOwnProperty.call(toggles, obsKey(x.it))) return;
                want.set(key + '#t', { scene: scene, source: x.it.obsSource, on: !!toggles[obsKey(x.it)], key: key });
                return;
            }
            const on = x.live;
            const prev = want.get(key);
            want.set(key, { scene: scene, source: x.it.obsSource, on: (prev && prev.on) || on });
        });
        // turn off first, then on, so a swap between two sources never shows both
        const list = Array.from(want.entries()).sort((a, b) => Number(a[1].on) - Number(b[1].on));
        let failed = false;
        for (const [k0, w] of list) {
            const key = w.key || k0;
            if (applied.get(key) === w.on) continue;
            try {
                const id = await itemId(w.scene, w.source);
                await request('SetSceneItemEnabled', { sceneName: w.scene, sceneItemId: id, sceneItemEnabled: w.on });
                applied.set(key, w.on);
            } catch (e) {
                failed = true;
                log('OBS: ' + w.source + ' in ' + w.scene + ': ' + e.message);
                setStatus({ error: 'Source "' + w.source + '" not found in scene "' + w.scene + '"' });
            }
        }
        if (!failed && identified) setStatus({ error: '' });
        // report the real state of toggle items so the Controller cards are right
        const states = {};
        for (const x of obsItems) {
            if (x.it.obsMode !== 'toggle') continue;
            const scene = x.it.obsScene || program;
            try {
                const id = await itemId(scene, x.it.obsSource);
                states[obsKey(x.it)] = !!(await request('GetSceneItemEnabled', { sceneName: scene, sceneItemId: id })).sceneItemEnabled;
            } catch (e) { /* missing source: already reported */ }
        }
        if (JSON.stringify(states) !== JSON.stringify(toggleStates)) { toggleStates = states; onToggleStates(Object.assign({}, states)); }
    }

    return {
        start: connect,
        reconfigure: connect,
        stop: stop,
        sync: sync,
        listSources: listSources,
        status: () => Object.assign({}, status),
        scenes: () => ({ current: scenes.current, list: scenes.list.slice() }),
        setScene: setScene,
        screenshots: screenshots,
        toggleStates: () => Object.assign({}, toggleStates)
    };
}

module.exports = { createObsBridge, authString, obsKey };
