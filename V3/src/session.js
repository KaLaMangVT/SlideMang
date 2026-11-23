/*
 * session.js — one shared "live state" for every Controller page
 *
 * The state lives here, in the app (not in each Controller page):
 *   - Controllers send SESSION_PUSH after every change; other Controllers apply it.
 *   - A Controller that opens later asks /api/session and starts from the same state.
 *   - Auto Slide (Media and Background) runs here, as one timer, even with no Controller open.
 *   - The state is written to data/session.json so it survives a restart.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;

function createSession(opts) {
    const file = path.join(opts.dataDir, 'session.json');
    const getConfig = opts.getConfig;          // () => normalized config
    const broadcast = opts.broadcast;          // (ch, obj) => void
    let session = null;
    let saveTimer = null;
    const timers = { media: null, bg: null };
    const timerKey = { media: '', bg: '' };

    try { session = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { session = null; }

    function channel() { return getConfig().channel; }
    function extra() { if (!session.extra) session.extra = {}; return session.extra; }

    function persistSoon() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persistNow, 800);
    }
    function persistNow() {
        clearTimeout(saveTimer);
        if (!session) return;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file + '.tmp', JSON.stringify(session, null, 1), 'utf8');
            fs.renameSync(file + '.tmp', file);
        } catch (e) { /* ignore */ }
    }

    function loopOf(list, override, i) {
        const it = list[i];
        if (!it) return true;
        if (override && Object.prototype.hasOwnProperty.call(override, it.file)) return !!override[it.file];
        return it.loop !== false;
    }

    function isToggle(it) { return !!it && it.type === 'obs' && it.obsMode === 'toggle'; }

    function autoCfg(which) {
        if (!session) return null;
        const part = which === 'media' ? (session.media || {}) : (session.background || {});
        const a = part.autoSlide || {};
        if (!a.enabled) return null;
        const sec = Math.max(0.1, Number(a.intervalSec) || 3);
        return { sec: sec };
    }

    function tick(which) {
        const cfg = getConfig();
        const ex = extra();
        if (which === 'media') {
            const n = cfg.list.length;
            if (!n) return;
            // OBS toggle items are switches, not slides: skip them
            let idx = Number(ex.index) || 0, guard = 0;
            do { idx = (idx + 1) % n; } while (isToggle(cfg.list[idx]) && ++guard < n);
            if (isToggle(cfg.list[idx])) return;
            ex.index = idx;
            broadcast(channel(), { type: 'MEDIA_CHANGE', index: idx, loop: loopOf(cfg.list, ex.override, idx), origin: 'auto' });
        } else {
            const list = cfg.bgList.length ? cfg.bgList : cfg.list;
            const visible = !session.background || session.background.show !== false;
            if (!visible || list.length < 2) return;
            let idx = Number(ex.bg_index) || 0, guard = 0;
            do { idx = (idx + 1) % list.length; } while (isToggle(list[idx]) && ++guard < list.length);
            if (isToggle(list[idx])) return;
            ex.bg_index = idx;
            if (session.background) session.background.index = idx;
            broadcast(channel(), { type: 'BG_CHANGE_INDEX', index: idx, loop: loopOf(list, ex.bg_override, idx), origin: 'auto' });
        }
        persistSoon();
    }

    /** (re)start a timer only when its settings changed, or when forced (manual change = restart countdown) */
    function syncTimer(which, force) {
        const a = autoCfg(which);
        const key = a ? String(a.sec) : '';
        if (!force && key === timerKey[which]) return;
        timerKey[which] = key;
        if (timers[which]) { clearInterval(timers[which]); timers[which] = null; }
        if (a) timers[which] = setInterval(() => tick(which), a.sec * 1000);
    }
    function syncTimers() { syncTimer('media', false); syncTimer('bg', false); }

    /** called by the server for every bus message */
    function onMessage(ch, msg) {
        if (!msg || typeof msg.type !== 'string' || ch !== channel()) return;
        switch (msg.type) {
            case 'SESSION_PUSH':
                if (msg.session && typeof msg.session === 'object') {
                    session = msg.session;
                    persistSoon();
                    syncTimers();
                }
                break;
            case 'MEDIA_CHANGE':
                if (msg.origin === 'auto' || !session) break;
                extra().index = msg.index;
                syncTimer('media', true);
                break;
            case 'MEDIA_VISIBLE':
                if (!session) break;
                if (!session.media) session.media = {};
                session.media.show = !!msg.visible;
                break;
            case 'BG_CHANGE_INDEX':
                if (msg.origin === 'auto' || !session) break;
                extra().bg_index = msg.index;
                syncTimer('bg', true);
                break;
        }
    }

    /** config changed in Setup: keep indexes inside the new lists */
    function onConfigChanged() {
        if (!session) return;
        const cfg = getConfig();
        const ex = extra();
        const bgList = cfg.bgList.length ? cfg.bgList : cfg.list;
        if (!(ex.index >= 0 && ex.index < cfg.list.length)) ex.index = 0;
        if (!(ex.bg_index >= 0 && ex.bg_index < bgList.length)) ex.bg_index = 0;
        if (session.background) session.background.index = ex.bg_index;
        persistSoon();
    }

    function stop() {
        Object.keys(timers).forEach((k) => { if (timers[k]) clearInterval(timers[k]); timers[k] = null; timerKey[k] = ''; });
        persistNow();
    }

    syncTimers();

    return {
        get: () => session,
        set: (s) => { session = s; persistSoon(); syncTimers(); },
        reset: () => { session = null; try { fs.unlinkSync(file); } catch (e) {} syncTimer('media', true); syncTimer('bg', true); },
        onMessage, onConfigChanged, stop,
        isVideo: (it) => !!it && (it.type ? it.type === 'video' : VIDEO_EXT.test(it.file))
    };
}

module.exports = { createSession };
