/*
 * main.js — โปรแกรมหลัก (Electron)
 *  - หน้าต่าง Launcher (หน้าต่างหลัก) สำหรับเปิด/ปิดหน้าต่างย่อย
 *  - หน้าต่างย่อย 5 ตัว: controller, setup-media, display-titlebar, display-slides, display-background
 *  - เซิร์ฟเวอร์ในตัว (src/server.js) สำหรับสื่อสารระหว่างหน้าต่างและสั่งการผ่านเครือข่าย
 */
'use strict';
const { app, BrowserWindow, ipcMain, screen, shell, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { createAppServer, getLanAddresses } = require('./src/server');
const { mergeSettings } = require('./src/settings');

/* ---------- ตำแหน่งโฟลเดอร์ข้อมูล ---------- */
// ตอนพัฒนา (npm start): ใช้โฟลเดอร์โปรเจกต์
// ตอนเป็น .exe: ใช้โฟลเดอร์ที่ไฟล์ .exe วางอยู่ (portable) เพื่อให้ data/ และ media/ อยู่ข้างโปรแกรม
const ROOT = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(ROOT, 'media');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const WEB_DIR = path.join(__dirname, 'web');
const DEFAULTS_DIR = path.join(__dirname, 'defaults');

/* ---------- ให้เสียง/วิดีโอเล่นได้แม้หน้าต่างถูกบัง หรือไม่ได้คลิก ---------- */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

/* ---------- นิยามหน้าต่าง ---------- */
const WINDOW_DEFS = {
    controller: { file: 'controller.html',         title: 'Controller',     kind: 'tool',    w: 1100, h: 820 },
    setup:      { file: 'setup-media.html',        title: 'Setup Media',    kind: 'tool',    w: 1000, h: 820 },
    titlebar:   { file: 'display-titlebar.html',   title: 'OBS Titlebar',   kind: 'display', w: 1280, h: 720 },
    slides:     { file: 'display-slides.html',     title: 'OBS Slides',     kind: 'display', w: 1280, h: 720 },
    background: { file: 'display-background.html', title: 'OBS Background', kind: 'display', w: 1280, h: 720 }
};

function defaultSettings() {
    const s = { port: 8765, allowLan: false, token: '', restoreOpen: false, windows: {} };
    Object.keys(WINDOW_DEFS).forEach((k) => {
        const d = WINDOW_DEFS[k];
        s.windows[k] = { open: false, width: d.w, height: d.h, x: null, y: null };
        if (d.kind === 'display') { s.windows[k].transparent = true; s.windows[k].bgColor = '#00ff00'; }
    });
    return s;
}

let settings = defaultSettings();
let saveTimer = null;

function loadSettings() {
    const def = defaultSettings();
    let raw = null;
    try {
        raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (e) {
        if (e.code !== 'ENOENT') {
            // ไฟล์เสีย: สำรองไว้ แล้วเริ่มด้วยค่าเริ่มต้น
            try { fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.broken'); } catch (e2) {}
        }
    }
    settings = mergeSettings(def, raw);
}
function saveSettingsSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettingsNow, 400);
}
function saveSettingsNow() {
    clearTimeout(saveTimer);
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) { console.error('save settings failed', e); }
}

function ensureDirs() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const cfg = path.join(DATA_DIR, 'media-config.js');
    if (!fs.existsSync(cfg)) {
        try { fs.copyFileSync(path.join(DEFAULTS_DIR, 'media-config.js'), cfg); } catch (e) { console.error(e); }
    }
}

/* ---------- เซิร์ฟเวอร์ ---------- */
let appServer = null;
let serverState = { running: false, port: 0, error: '' };

async function startServer() {
    if (!appServer) {
        appServer = createAppServer({
            webDir: WEB_DIR, dataDir: DATA_DIR, mediaDir: MEDIA_DIR,
            getSettings: () => settings,
            version: app.getVersion(),
            log: (m) => console.log('[server]', m)
        });
    }
    try {
        const host = settings.allowLan ? '0.0.0.0' : '127.0.0.1';
        const port = await appServer.start(Number(settings.port) || 8765, host);
        serverState = { running: true, port: port, error: '' };
    } catch (e) {
        serverState = { running: false, port: 0, error: String(e && e.message || e) };
    }
}

function baseUrl() { return 'http://127.0.0.1:' + serverState.port; }

/* ---------- หน้าต่าง ---------- */
const wins = {};          // key -> BrowserWindow
const layoutOn = {};      // key -> bool
let launcherWin = null;
let quitting = false;
let restoring = false;

function boundsVisible(b) {
    if (b.x == null || b.y == null) return false;
    return screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return b.x + 50 < a.x + a.width && b.x + b.width - 50 > a.x && b.y + 20 < a.y + a.height && b.y + 50 > a.y;
    });
}

function openWindow(key) {
    const def = WINDOW_DEFS[key];
    if (!def) return;
    if (wins[key] && !wins[key].isDestroyed()) { wins[key].show(); wins[key].focus(); return; }
    if (!serverState.running) return;

    const st = settings.windows[key];
    const isDisplay = def.kind === 'display';
    const transparent = isDisplay && !!st.transparent;
    const opt = {
        width: Math.max(100, st.width || def.w),
        height: Math.max(100, st.height || def.h),
        title: def.title,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: transparent ? '#00000000' : (isDisplay ? (st.bgColor || '#00ff00') : '#1e1e1e'),
        webPreferences: {
            preload: path.join(__dirname, 'preload-window.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
            autoplayPolicy: 'no-user-gesture-required'
        }
    };
    if (transparent) { opt.transparent = true; opt.frame = false; opt.hasShadow = false; }
    if (isDisplay) { opt.minWidth = 100; opt.minHeight = 100; }
    const probe = { x: st.x, y: st.y, width: opt.width, height: opt.height };
    if (boundsVisible(probe)) { opt.x = st.x; opt.y = st.y; }

    const win = new BrowserWindow(opt);
    wins[key] = win;
    layoutOn[key] = false;

    win.setMenuBarVisibility(false);
    // คงชื่อหน้าต่างให้คงที่ เพื่อให้ OBS Window Capture เลือกง่าย
    win.on('page-title-updated', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });

    let boundsTimer = null;
    const saveBounds = () => {
        clearTimeout(boundsTimer);
        boundsTimer = setTimeout(() => {
            if (win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
            const b = win.getBounds();
            Object.assign(settings.windows[key], { x: b.x, y: b.y, width: b.width, height: b.height });
            saveSettingsSoon();
            pushState();
        }, 300);
    };
    win.on('resize', saveBounds);
    win.on('move', saveBounds);

    win.on('closed', () => {
        delete wins[key];
        layoutOn[key] = false;
        if (!quitting) { settings.windows[key].open = false; saveSettingsSoon(); }
        pushState();
    });

    win.loadURL(baseUrl() + '/' + def.file);
    win.once('ready-to-show', () => { if (restoring) win.showInactive(); else win.show(); });
    win.setTitle(def.title);

    settings.windows[key].open = true;
    saveSettingsSoon();
    pushState();
}

function closeWindow(key) {
    const w = wins[key];
    if (w && !w.isDestroyed()) w.close();
}

function setLayout(key, on) {
    const w = wins[key];
    if (!w || w.isDestroyed()) return;
    layoutOn[key] = !!on;
    w.webContents.send('layout-mode', { on: !!on, title: WINDOW_DEFS[key].title });
    pushState();
}

function reloadAllWindows() {
    Object.keys(wins).forEach((k) => {
        const w = wins[k];
        if (w && !w.isDestroyed()) w.loadURL(baseUrl() + '/' + WINDOW_DEFS[k].file);
    });
}

/* ---------- Launcher ---------- */
function createLauncher() {
    launcherWin = new BrowserWindow({
        width: 560, height: 780, minWidth: 480, minHeight: 520, x: 30, y: 30,
        title: 'SlideMang',
        backgroundColor: '#17181c',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload-launcher.js'),
            contextIsolation: true, nodeIntegration: false, sandbox: true
        }
    });
    launcherWin.setMenuBarVisibility(false);
    launcherWin.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') launcherWin.webContents.toggleDevTools();
    });
    launcherWin.loadFile(path.join(__dirname, 'launcher', 'launcher.html'));
    launcherWin.on('closed', () => { launcherWin = null; app.quit(); });
}

function buildState() {
    const w = {};
    Object.keys(WINDOW_DEFS).forEach((k) => {
        const d = WINDOW_DEFS[k], s = settings.windows[k];
        const open = !!(wins[k] && !wins[k].isDestroyed());
        let cw = s.width, ch = s.height;
        if (open) { const b = wins[k].getBounds(); cw = b.width; ch = b.height; }
        w[k] = {
            title: d.title, kind: d.kind, open: open, layout: !!layoutOn[k],
            transparent: !!s.transparent, bgColor: s.bgColor || '#00ff00',
            width: cw, height: ch
        };
    });
    const addrs = getLanAddresses();
    return {
        windows: w,
        server: {
            running: serverState.running, port: serverState.port, error: serverState.error,
            allowLan: !!settings.allowLan, token: settings.token || '', restoreOpen: !!settings.restoreOpen,
            configuredPort: settings.port, addresses: addrs,
            clients: appServer ? appServer.clientCount() : 0
        },
        paths: { data: DATA_DIR, media: MEDIA_DIR },
        version: app.getVersion()
    };
}

function pushState() {
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('state', buildState());
}

function toInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

ipcMain.handle('launcher:get-state', () => buildState());

ipcMain.handle('launcher:toggle', (e, key) => {
    if (!WINDOW_DEFS[key]) return;
    if (wins[key] && !wins[key].isDestroyed()) closeWindow(key); else openWindow(key);
});

ipcMain.handle('launcher:update', (e, key, patch) => {
    const def = WINDOW_DEFS[key];
    if (!def || !patch) return;
    const s = settings.windows[key];
    const w = wins[key] && !wins[key].isDestroyed() ? wins[key] : null;
    let recreate = false;

    if (patch.width != null || patch.height != null) {
        s.width = toInt(patch.width != null ? patch.width : s.width, 100, 7680, s.width);
        s.height = toInt(patch.height != null ? patch.height : s.height, 100, 4320, s.height);
        if (w) { w.setMinimumSize(100, 100); w.setSize(s.width, s.height); }
    }
    if (def.kind === 'display') {
        if (typeof patch.bgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.bgColor)) {
            s.bgColor = patch.bgColor;
            if (w && !s.transparent) w.setBackgroundColor(s.bgColor);
        }
        if (typeof patch.transparent === 'boolean' && patch.transparent !== !!s.transparent) {
            s.transparent = patch.transparent;
            recreate = !!w; // ต้องสร้างหน้าต่างใหม่ เพราะเปลี่ยนโหมดโปร่งใสขณะเปิดอยู่ไม่ได้
        }
    }
    saveSettingsSoon();
    if (recreate) {
        const ww = w;
        ww.once('closed', () => setTimeout(() => openWindow(key), 100));
        ww.close();
    }
    pushState();
});

ipcMain.handle('launcher:layout', (e, key, on) => { setLayout(key, on); });

ipcMain.handle('launcher:server', async (e, patch) => {
    if (!patch) return;
    let restart = false;
    if (typeof patch.token === 'string') settings.token = patch.token.trim();
    if (typeof patch.restoreOpen === 'boolean') settings.restoreOpen = patch.restoreOpen;
    if (typeof patch.allowLan === 'boolean' && patch.allowLan !== settings.allowLan) { settings.allowLan = patch.allowLan; restart = true; }
    if (patch.port != null) {
        const p = toInt(patch.port, 1024, 65535, settings.port);
        if (p !== settings.port) { settings.port = p; restart = true; }
    }
    saveSettingsSoon();
    if (restart) {
        const oldPort = serverState.port;
        await startServer();
        if (serverState.running && serverState.port !== oldPort) reloadAllWindows();
        else if (serverState.running) reloadAllWindows();
    }
    pushState();
});

ipcMain.handle('launcher:open-folder', (e, which) => {
    const dir = which === 'media' ? MEDIA_DIR : DATA_DIR;
    return shell.openPath(dir);
});

ipcMain.handle('launcher:copy', (e, text) => { clipboard.writeText(String(text || '')); });

ipcMain.handle('launcher:open-url', (e, url) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?\//.test(String(url))) shell.openExternal(url);
});

// ปุ่มลากมุมขวาล่างในโหมดจัดวาง (หน้าต่างโปร่งใสลากขอบไม่ได้) ส่งขนาดใหม่มาที่นี่
ipcMain.on('win-resize', (e, size) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w.isDestroyed() || !size) return;
    const width = toInt(size.w, 100, 7680, 100), height = toInt(size.h, 100, 4320, 100);
    w.setSize(width, height);
});

/* ---------- เริ่มโปรแกรม ---------- */
app.on('second-instance', () => {
    if (launcherWin) { if (launcherWin.isMinimized()) launcherWin.restore(); launcherWin.focus(); }
});

app.whenReady().then(async () => {
    if (!gotLock) return;
    Menu.setApplicationMenu(null);
    ensureDirs();
    loadSettings();
    await startServer();
    createLauncher();
    if (serverState.running && settings.restoreOpen) {
        // เปิดหน้าต่างที่เคยเปิดค้างไว้ครั้งก่อน (ต้องติ๊กตัวเลือกใน Launcher)
        restoring = true;
        Object.keys(WINDOW_DEFS).forEach((k) => { if (settings.windows[k].open) openWindow(k); });
        setTimeout(() => { restoring = false; }, 3000);
    }
});

app.on('before-quit', () => { quitting = true; saveSettingsNow(); });
app.on('window-all-closed', () => { app.quit(); });
app.on('will-quit', () => { if (appServer) appServer.stop(); });
