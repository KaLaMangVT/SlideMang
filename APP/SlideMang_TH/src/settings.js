/*
 * settings.js — รวมค่าจาก settings.json เข้ากับค่าเริ่มต้นอย่างปลอดภัย
 * (แยกไฟล์เพื่อให้ทดสอบได้โดยไม่ต้องเปิด Electron)
 * ค่าที่ผิดชนิด/ผิดช่วง/ขาดหายไป จะถูกแทนด้วยค่าเริ่มต้นแทนที่จะทำให้โปรแกรมพัง
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
        windows: {}
    };
    if (isObj(raw)) {
        out.port = intIn(raw.port, 1024, 65535, def.port);
        out.allowLan = typeof raw.allowLan === 'boolean' ? raw.allowLan : def.allowLan;
        out.token = typeof raw.token === 'string' ? raw.token : def.token;
        out.restoreOpen = typeof raw.restoreOpen === 'boolean' ? raw.restoreOpen : def.restoreOpen;
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
