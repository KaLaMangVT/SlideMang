/*
 * settings.js — merge data/settings.json with the defaults safely
 * (separate file so it can be tested without Electron)
 * Wrong type / out of range / missing values fall back to the default instead of crashing.
 */
'use strict';

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function intIn(v, min, max, fallback) {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function mergeSettings(def, raw) {
    // ไม่แก้ def และ raw (สร้างวัตถุใหม่เสมอ)
    const out = {
        port: def.port, allowLan: def.allowLan, token: def.token, restoreOpen: def.restoreOpen,
        language: def.language, obs: Object.assign({}, def.obs), windows: {}
    };
    if (isObj(raw)) {
        out.port = intIn(raw.port, 1024, 65535, def.port);
        out.allowLan = typeof raw.allowLan === 'boolean' ? raw.allowLan : def.allowLan;
        out.token = typeof raw.token === 'string' ? raw.token : def.token;
        out.restoreOpen = typeof raw.restoreOpen === 'boolean' ? raw.restoreOpen : def.restoreOpen;
        if (isObj(raw.obs)) {
            const o = raw.obs;
            out.obs = {
                enabled: typeof o.enabled === 'boolean' ? o.enabled : def.obs.enabled,
                host: (typeof o.host === 'string' && o.host.trim()) ? o.host.trim() : def.obs.host,
                port: intIn(o.port, 1, 65535, def.obs.port),
                password: typeof o.password === 'string' ? o.password : def.obs.password
            };
        }
        out.language = (typeof raw.language === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(raw.language)) ? raw.language : def.language;
    }
    const rawWins = isObj(raw) && isObj(raw.windows) ? raw.windows : {};
    Object.keys(def.windows).forEach((k) => {
        const d = def.windows[k];
        const r = isObj(rawWins[k]) ? rawWins[k] : {};
        const w = Object.assign({}, d);
        if (typeof r.open === 'boolean') w.open = r.open;
        w.width = intIn(r.width, 100, 7680, d.width);
        w.height = intIn(r.height, 100, 4320, d.height);
        w.x = (r.x === null || r.x === undefined) ? d.x : intIn(r.x, -32000, 32000, d.x);
        w.y = (r.y === null || r.y === undefined) ? d.y : intIn(r.y, -32000, 32000, d.y);
        if ('transparent' in d) {
            w.transparent = typeof r.transparent === 'boolean' ? r.transparent : d.transparent;
            w.bgColor = (typeof r.bgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.bgColor)) ? r.bgColor : d.bgColor;
        }
        out.windows[k] = w;
    });
    return out;
}

module.exports = { mergeSettings };
