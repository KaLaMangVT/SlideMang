/*
 * i18n.js — language files
 *  English is the source language: the pages are written in English and every
 *  locales/<code>.json maps "English text" -> "translated text".
 *  To add a language: copy locales/th.json to locales/<code>.json, change "_meta"
 *  and translate the values (keep the keys). Files placed in a "locales" folder next
 *  to SlideMang.exe are loaded too, so a new language does not need a rebuild.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function createI18n(dirs) {
    let cache = null;

    function scan() {
        const map = { en: { code: 'en', name: 'English', dict: {} } };
        dirs.forEach((dir) => {
            let names = [];
            try { names = fs.readdirSync(dir); } catch (e) { return; }
            names.forEach((n) => {
                const m = /^([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.json$/.exec(n);
                if (!m) return;
                try {
                    const raw = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
                    const meta = raw._meta || {};
                    const dict = {};
                    Object.keys(raw).forEach((k) => { if (k !== '_meta' && typeof raw[k] === 'string' && raw[k]) dict[k] = raw[k]; });
                    const prev = map[m[1]];
                    map[m[1]] = { code: m[1], name: String(meta.name || (prev && prev.name) || m[1]), dict: Object.assign({}, prev ? prev.dict : {}, dict) };
                } catch (e) { console.error('locale ' + n + ' failed:', e.message); }
            });
        });
        return map;
    }

    function all() { if (!cache) cache = scan(); return cache; }

    return {
        reload: () => { cache = null; },
        list: () => Object.values(all()).map((l) => ({ code: l.code, name: l.name })),
        has: (code) => !!all()[code],
        payload: (code) => {
            const l = all()[code] || all().en;
            return { lang: l.code, dict: l.dict, locales: Object.values(all()).map((x) => ({ code: x.code, name: x.name })) };
        }
    };
}

module.exports = { createI18n };
