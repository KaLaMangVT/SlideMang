/*
 * config-store.js — Media/Background/Titlebar configuration (data/config.json)
 *  - Edited in Setup Media and saved here directly.
 *  - The pages read the same global variables (MEDIA_LIST…) from a generated /media-config.js.
 *  - Writes are atomic (tmp + rename) and keep one backup (config.json.bak).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_CHANNEL = 'obs_control';

function str(v, d) { return typeof v === 'string' ? v : (d == null ? '' : d); }
function num(v, d, min, max) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(max, Math.max(min, n));
}
function cleanRel(p) {
    // media paths are always relative to media/, forward slashes, no "..".
    let s = str(p).trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
    if (s.startsWith('media/')) s = s.slice(6);
    return s.split('/').filter((x) => x && x !== '.' && x !== '..').join('/');
}
function triple(a) {
    const arr = Array.isArray(a) ? a : [];
    return [0, 1, 2].map((i) => cleanRel(arr[i]));
}

const ITEM_TYPES = ['', 'image', 'video', 'obs', 'camera', 'capture', 'scene'];
const LIVE_RES = ['auto', '720p', '1080p', '1440p', '2160p'];   // 1440p = 2K, 2160p = 4K

/** "transparent background" for camera / capture: key out black (transparent window parts) or a color */
function keyOpts(it, o) {
    if (it.key !== 'black' && it.key !== 'color') return o;
    o.key = it.key;
    if (it.key === 'color') o.keyColor = /^#[0-9a-f]{6}$/i.test(str(it.keyColor)) ? str(it.keyColor).toLowerCase() : '#00ff00';
    o.keyLevel = num(it.keyLevel, it.key === 'color' ? 25 : 4, 0, 100);
    o.keySoft = num(it.keySoft, 10, 0, 100);
    return o;
}
function common(it, o) {
    const d = str(it.desc).trim();
    if (d) o.desc = d;
    const th = cleanRel(it.thumb);
    if (th) o.thumb = th;
    return o;
}
const FITS = ['', 'none', 'contain', 'cover'];

function normItem(it, allowObs) {
    if (!it || typeof it !== 'object') return null;
    if (it.type === 'obs') {
        // OBS Source: shown/hidden in OBS through obs-websocket, nothing to load from media/
        //   obsMode "slide"  (default) = one item at a time, like an image
        //   obsMode "toggle"           = its card switches the source on/off, the slide does not change
        if (!allowObs) return null;
        const source = str(it.obsSource).trim();
        if (!source) return null;
        const o = { type: 'obs', obsSource: source };
        const scene = str(it.obsScene).trim();
        if (scene) o.obsScene = scene;
        if (it.obsMode === 'toggle') o.obsMode = 'toggle';
        return common(it, o);
    }
    if (it.type === 'scene') return null;   // scenes live in OBSSCENE_LIST (see normScene)
    if (it.type === 'camera') {
        // Camera inside SlideMang: opened only while its slide is showing
        if (!allowObs) return null;
        const o = { type: 'camera', device: str(it.device).trim(),
            res: LIVE_RES.indexOf(it.res) >= 0 ? it.res : 'auto',
            fps: Number(it.fps) === 60 ? 60 : 30, mirror: !!it.mirror };
        o.fit = FITS.indexOf(it.fit) >= 0 ? it.fit : 'cover';
        return common(it, keyOpts(it, o));
    }
    if (it.type === 'capture') {
        // Window / screen capture inside SlideMang: captured only while its slide is showing
        if (!allowObs) return null;
        const o = { type: 'capture', source: it.source === 'screen' ? 'screen' : 'window', match: str(it.match).trim(),
            fps: [15, 30, 60].indexOf(Number(it.fps)) >= 0 ? Number(it.fps) : 30 };
        const c = Array.isArray(it.crop) ? it.crop : [];
        o.crop = [0, 1, 2, 3].map((i) => num(c[i], 0, 0, 45));
        o.fit = FITS.indexOf(it.fit) >= 0 ? it.fit : 'contain';
        return common(it, keyOpts(it, o));
    }
    const file = cleanRel(it.file);
    if (!file) return null;
    const out = { file: file };
    const desc = str(it.desc).trim();
    if (desc) out.desc = desc;
    if (it.type === 'image' || it.type === 'video') out.type = it.type;
    let fit = it.fit === 'actual' ? 'none' : it.fit;
    if (FITS.indexOf(fit) > 0) out.fit = fit;
    const thumb = cleanRel(it.thumb);
    if (thumb) out.thumb = thumb;
    if (it.loop === false) out.loop = false;
    return out;
}

/** OBSSCENE_LIST entry: a button that switches OBS to a scene, with its own transition */
function normScene(t) {
    if (!t || typeof t !== 'object') return null;
    const scene = str(t.scene || t.obsScene).trim();
    if (!scene) return null;
    const o = { name: str(t.name || t.desc).trim(), scene: scene, transition: str(t.transition).trim() };
    const th = cleanRel(t.thumb);
    if (th) o.thumb = th;   // own picture instead of the live preview from OBS
    const d = Number(t.duration);
    o.duration = Number.isFinite(d) && d > 0 ? Math.min(20000, Math.round(d)) : 0;   // 0 = keep OBS duration
    return o;
}

function normTitlebar(t) {
    if (!t || typeof t !== 'object') return null;
    const header = str(t.header), body = str(t.body);
    if (!header.trim() && !body.trim()) return null;
    const pos = ['left', 'center', 'right'];
    const out = {
        name: str(t.name).trim(),
        header: header,
        body: body,
        preset: /^p\d+$/.test(str(t.preset)) ? t.preset : 'p1',
        hAlign: pos.indexOf(t.hAlign) >= 0 ? t.hAlign : 'center',
        edgeDist: num(t.edgeDist, 5, 0, 80),
        bottomDist: num(t.bottomDist, 5, 0, 90),
        showHeader: t.showHeader !== false,
        align: pos.indexOf(t.align) >= 0 ? t.align : 'left',
        widthType: t.widthType === 'percent' ? 'percent' : 'auto',
        customWidth: num(t.customWidth, 80, 20, 100)
    };
    const bg = cleanRel(t.bgImage);
    if (bg) out.bgImage = bg;
    return out;
}

/** Always returns a complete, valid config object. */
function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        version: 3,
        channel: (str(r.channel).trim() || DEFAULT_CHANNEL).replace(/[^\w.-]/g, '_'),
        startVisible: r.startVisible !== false,
        liveRelay: r.liveRelay !== false,   // send camera/capture video to Browser Sources & network displays
        bgStartVisible: r.bgStartVisible !== false,
        bgs: triple(r.bgs),
        bbgs: triple(r.bbgs),
        list: (Array.isArray(r.list) ? r.list : []).map((x) => normItem(x, true)).filter(Boolean),
        // Background List: images, videos, OBS Sources, camera, capture (no scene switching)
        bgList: (Array.isArray(r.bgList) ? r.bgList : []).map((x) => normItem(x, true)).filter(Boolean),
        // scene buttons; "OBS Scene" items once kept in the Media List move here
        obsScenes: (Array.isArray(r.obsScenes) ? r.obsScenes : [])
            .concat((Array.isArray(r.list) ? r.list : []).filter((x) => x && x.type === 'scene'))
            .map(normScene).filter(Boolean),
        titlebars: (Array.isArray(r.titlebars) ? r.titlebars : []).map(normTitlebar).filter(Boolean)
    };
}

/** Script consumed by the controller/display pages. */
function toScript(cfg) {
    return '/* generated by SlideMang from data/config.json — edit in Setup Media */\n' +
        'var MEDIA_BASE = "./media/";\n' +
        'var MEDIA_CHANNEL = ' + JSON.stringify(cfg.channel) + ';\n' +
        'var MEDIA_START_VISIBLE = ' + !!cfg.startVisible + ';\n' +
        'var BG_START_VISIBLE = ' + !!cfg.bgStartVisible + ';\n' +
        'var LIVE_RELAY = ' + (cfg.liveRelay !== false) + ';\n' +
        'var MEDIA_BGS = ' + JSON.stringify(cfg.bgs) + ';\n' +
        'var BG_BGS = ' + JSON.stringify(cfg.bbgs) + ';\n' +
        'var MEDIA_LIST = ' + JSON.stringify(cfg.list, null, 1) + ';\n' +
        'var BACKGROUND_LIST = ' + JSON.stringify(cfg.bgList, null, 1) + ';\n' +
        'var MEDIA_TITLEBARS = ' + JSON.stringify(cfg.titlebars, null, 1) + ';\n' +
        'var OBSSCENE_LIST = ' + JSON.stringify(cfg.obsScenes, null, 1) + ';\n';
}

function writeAtomic(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
}

function createConfigStore(opts) {
    const file = path.join(opts.dataDir, 'config.json');
    const defaultsFile = path.join(opts.defaultsDir, 'config.json');
    let cfg = null;

    function readDefaults() {
        try { return normalize(JSON.parse(fs.readFileSync(defaultsFile, 'utf8'))); } catch (e) { return normalize({}); }
    }

    function load() {
        try {
            cfg = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
            return cfg;
        } catch (e) {
            if (e.code !== 'ENOENT') { try { fs.copyFileSync(file, file + '.broken'); } catch (e2) {} }
        }
        cfg = readDefaults();
        save(cfg, true);
        return cfg;
    }

    function save(next, noBackup) {
        const clean = normalize(next);
        if (!noBackup && fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bak'); } catch (e) {} }
        writeAtomic(file, JSON.stringify(clean, null, 2));
        cfg = clean;
        return clean;
    }

    return {
        load: load,
        get: () => cfg || load(),
        save: save,
        defaults: readDefaults,
        script: () => toScript(cfg || load()),
        file: file
    };
}

module.exports = { createConfigStore, normalize, toScript, cleanRel };
