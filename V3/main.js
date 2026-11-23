/*
 * main.js — SlideMang v3 (Electron main process)
 *  - Launcher window (main window) opens/closes the other windows
 *  - 5 windows: controller, setup-media, display-titlebar, display-slides, display-background
 *  - Built-in server (src/server.js) connects all windows, OBS Browser Sources and other devices
 *
 *  Portable: data/, media/ (and an optional locales/) live next to SlideMang.exe,
 *  so copying that folder copies everything — program, settings and media files.
 */
'use strict';
const { app, BrowserWindow, ipcMain, screen, shell, Menu, clipboard, dialog, session: eSession, desktopCapturer, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { createAppServer, getLanAddresses } = require('./src/server');
const { mergeSettings } = require('./src/settings');
const { createConfigStore } = require('./src/config-store');
const { createMediaStore } = require('./src/media-store');
const { createSession } = require('./src/session');
const { createI18n } = require('./src/i18n');
const { createObsBridge } = require('./src/obs-bridge');
const pkg = require('./package.json');

/* ---------- folders ---------- */
// npm start: the project folder. Packaged .exe: the folder that holds the .exe (portable).
const ROOT = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(ROOT, 'media');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const WEB_DIR = path.join(__dirname, 'web');
const DEFAULTS_DIR = path.join(__dirname, 'defaults');
const SAMPLES_DIR = path.join(DEFAULTS_DIR, 'media');
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const LINKS = (pkg.slidemang && pkg.slidemang.links) || {};

/* ---------- keep audio/video playing when windows are hidden or not focused ---------- */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// WebRTC live relay on the local network: offer real LAN addresses instead of hidden ".local" names
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

/* ---------- windows (titles stay in English so OBS Window Capture keeps finding them) ---------- */
const WINDOW_DEFS = {
    controller: { file: 'controller.html',         title: 'Controller',     kind: 'tool',    w: 1100, h: 820 },
    setup:      { file: 'setup-media.html',        title: 'Setup Media',    kind: 'tool',    w: 1100, h: 820 },
    titlebar:   { file: 'display-titlebar.html',   title: 'OBS Titlebar',   kind: 'display', w: 1280, h: 720 },
    slides:     { file: 'display-slides.html',     title: 'OBS Slides',     kind: 'display', w: 1280, h: 720 },
    background: { file: 'display-background.html', title: 'OBS Background', kind: 'display', w: 1280, h: 720 }
};

function defaultSettings() {
    const s = {
        port: 8765, allowLan: false, token: '', restoreOpen: false, language: 'en',
        obs: { enabled: false, host: '127.0.0.1', port: 4455, password: '' },
        windows: {}
    };
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
        if (e.code !== 'ENOENT') { try { fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.broken'); } catch (e2) {} }
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

/* ---------- stores ---------- */
const configStore = createConfigStore({ dataDir: DATA_DIR, defaultsDir: DEFAULTS_DIR });
const mediaStore = createMediaStore({ mediaDir: MEDIA_DIR });
const i18n = createI18n([path.join(__dirname, 'locales'), path.join(ROOT, 'locales')]);
let session = null;
let obs = null;

function obsInfo() {
    const o = settings.obs;
    return { enabled: !!o.enabled, host: o.host, port: o.port, hasPassword: !!o.password, status: obs ? obs.status() : {}, toggleStates: obs ? obs.toggleStates() : {}, scenes: obs ? obs.scenes() : null };
}
function obsUpdate(b) {
    const o = settings.obs;
    if (typeof b.enabled === 'boolean') o.enabled = b.enabled;
    if (typeof b.host === 'string' && b.host.trim()) o.host = b.host.trim();
    if (b.port != null) o.port = toInt(b.port, 1, 65535, o.port);
    if (typeof b.password === 'string') o.password = b.password;   // omitted = keep the saved one
    saveSettingsSoon();
    if (obs) obs.reconfigure();
}

function ensureDirs() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const firstRun = !fs.existsSync(configStore.file);
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    configStore.load();
    if (firstRun) mediaStore.ensureSamples(SAMPLES_DIR); // sample files used by the default config
}

/* ---------- server ---------- */
let appServer = null;
let serverState = { running: false, port: 0, error: '' };

function busSend(obj) { if (appServer) appServer.broadcast(configStore.get().channel, obj); }

async function startServer() {
    if (!appServer) {
        appServer = createAppServer({
            webDir: WEB_DIR, dataDir: DATA_DIR, mediaDir: MEDIA_DIR,
            getSettings: () => settings,
            version: app.getVersion(),
            appInfo: { version: app.getVersion(), links: LINKS },
            configStore: configStore, mediaStore: mediaStore, i18n: i18n,
            getSession: () => session && session.get(),
            onBusMessage: (ch, msg) => {
                if (msg.type === 'OBS_SET_SCENE' && obs) obs.setScene(msg.scene, msg.transition, msg.duration);
                if (msg.type === 'RTC_WANT') ensureLiveWorker();
                else if (msg.type === 'RTC_WORKER_IDLE') closeLiveWorker();
                if (session) session.onMessage(ch, msg);
                if (obs) obs.sync();
            },
            hooks: {
                onConfigSaved: (cfg, oldChannel) => {
                    if (session) session.onConfigChanged();
                    if (obs) obs.sync(true);
                    // displays and controllers pick up the new lists right away
                    const msg = { type: 'SM_RELOAD', roles: ['display', 'controller', 'worker'], reason: 'config' };
                    busSend(msg);
                    if (oldChannel && oldChannel !== cfg.channel) appServer.broadcast(oldChannel, msg);
                },
                onReloadDisplays: () => reloadDisplays(),
                onDefaultsRequested: () => mediaStore.ensureSamples(SAMPLES_DIR),
                onLanguage: (code) => setLanguage(code),
                obsInfo: obsInfo,
                obsUpdate: obsUpdate,
                obsSources: () => obs.listSources(),
                obsThumbs: (names, w) => obs.screenshots(names, w)
            },
            log: (m) => console.log('[server]', m)
        });
        session = createSession({
            dataDir: DATA_DIR,
            getConfig: () => configStore.get(),
            broadcast: (ch, obj) => { appServer.broadcast(ch, obj); if (obs) obs.sync(); }
        });
        obs = createObsBridge({
            getObsSettings: () => settings.obs,
            getConfig: () => configStore.get(),
            getSession: () => session.get(),
            onStatus: (st) => busSend(Object.assign({ type: 'OBS_STATUS' }, st)),
            onToggleStates: (states) => busSend({ type: 'OBS_TOGGLE_STATE', states: states }),
            onScenes: (sc) => busSend({ type: 'OBS_SCENES', current: sc.current, list: sc.list }),
            log: (m) => console.log('[obs]', m)
        });
        obs.start();
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

/* ---------- live worker: sends camera / capture video to Browser Sources and network displays ----------
 * Hidden window, created only when such a display asks for a live slide, closed when nobody watches. */
let liveWorker = null;
function ensureLiveWorker() {
    if (liveWorker && !liveWorker.isDestroyed()) return;
    if (!serverState.running || !configStore.get().liveRelay) return;
    liveWorker = new BrowserWindow({
        show: false, width: 320, height: 180, title: 'SlideMang Live Worker', skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload-window.js'),
            contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false
        }
    });
    liveWorker.on('closed', () => { liveWorker = null; });
    liveWorker.loadURL(baseUrl() + '/live-worker.html');
}
function closeLiveWorker() {
    if (liveWorker && !liveWorker.isDestroyed()) liveWorker.destroy();
    liveWorker = null;
}

/* ---------- windows ---------- */
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
        icon: ICON_PATH,
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
    else { opt.minWidth = 340; opt.minHeight = 300; }
    const probe = { x: st.x, y: st.y, width: opt.width, height: opt.height };
    if (boundsVisible(probe)) { opt.x = st.x; opt.y = st.y; }

    const win = new BrowserWindow(opt);
    wins[key] = win;
    layoutOn[key] = false;

    win.setMenuBarVisibility(false);
    win.on('page-title-updated', (e) => e.preventDefault()); // fixed title for OBS Window Capture
    win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(baseUrl() + '/')) { e.preventDefault(); openExternalSafe(url); } });
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

/** "Refresh OBS": app display windows + OBS Browser Sources (through the bus) */
function reloadDisplays() {
    busSend({ type: 'SM_RELOAD', roles: ['display'], reason: 'manual' });
    Object.keys(wins).forEach((k) => {
        const w = wins[k];
        if (WINDOW_DEFS[k].kind === 'display' && w && !w.isDestroyed()) {
            w.webContents.reloadIgnoringCache();
            if (layoutOn[k]) setTimeout(() => setLayout(k, true), 800);
        }
    });
}

function setLanguage(code) {
    if (!i18n.has(code)) return;
    settings.language = code;
    saveSettingsSoon();
    busSend({ type: 'SM_RELOAD', roles: ['controller', 'setup'], reason: 'language' });
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.reload();
}

/* links: only http(s) and only to the addresses we know about */
function openExternalSafe(url) {
    const u = String(url || '');
    const known = Object.values(LINKS).filter(Boolean);
    const local = /^https?:\/\/(127\.0\.0\.1|localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?\//.test(u);
    if (local || known.indexOf(u) >= 0 || /^https:\/\/(www\.)?(github\.com|youtube\.com|youtu\.be)\//.test(u)) shell.openExternal(u);
}

/* ---------- Launcher ---------- */
function createLauncher() {
    launcherWin = new BrowserWindow({
        width: 580, height: 800, minWidth: 380, minHeight: 480, x: 30, y: 30,
        title: 'SlideMang',
        icon: ICON_PATH,
        backgroundColor: '#17181c',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload-launcher.js'),
            contextIsolation: true, nodeIntegration: false, sandbox: true
        }
    });
    launcherWin.setMenuBarVisibility(false);
    launcherWin.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
    launcherWin.webContents.on('will-navigate', (e, url) => { e.preventDefault(); openExternalSafe(url); });
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
        version: app.getVersion(),
        language: settings.language,
        locales: i18n.list(),
        links: LINKS
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
ipcMain.on('launcher:i18n', (e) => { e.returnValue = i18n.payload(settings.language || 'en'); });

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
            recreate = !!w; // transparency can not change on an open window: recreate it
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
ipcMain.handle('launcher:reload-displays', () => { reloadDisplays(); });
ipcMain.handle('launcher:language', (e, code) => { setLanguage(String(code || '')); });

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
        await startServer();
        if (serverState.running) reloadAllWindows();
        closeLiveWorker();   // it will be recreated on the new port when needed
    }
    pushState();
});

ipcMain.handle('launcher:open-folder', (e, which) => {
    const dir = which === 'media' ? MEDIA_DIR : DATA_DIR;
    return shell.openPath(dir);
});

ipcMain.handle('launcher:copy', (e, text) => { clipboard.writeText(String(text || '')); });
ipcMain.handle('launcher:open-url', (e, url) => { openExternalSafe(url); });

/* ---------- media import for the app windows (Setup page) ---------- */
function fromAppWindow(e) {
    // only our own windows, loaded from our own server
    const url = e.senderFrame && e.senderFrame.url || '';
    return serverState.running && url.startsWith(baseUrl() + '/');
}

ipcMain.handle('sm:pick-files', async (e, opt) => {
    if (!fromAppWindow(e)) return [];
    const o = opt || {};
    const filters = o.kind === 'image'
        ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'] }]
        : [{ name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'mp4', 'webm', 'mov', 'm4v', 'ogv'] }];
    filters.push({ name: 'All files', extensions: ['*'] });
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
        properties: o.multi ? ['openFile', 'multiSelections'] : ['openFile'],
        defaultPath: MEDIA_DIR,
        filters: filters
    });
    return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('sm:import', async (e, paths, sub) => {
    if (!fromAppWindow(e)) return { ok: false, code: 'FORBIDDEN' };
    try {
        return { ok: true, files: await mediaStore.importPaths(paths, sub) };
    } catch (err) {
        return { ok: false, code: err.code || 'ERROR', message: String(err.message || err), need: err.need, free: err.free };
    }
});

/* ---------- Camera / Window / Screen capture (only for our own pages) ---------- */
function ourUrl(u) { return serverState.running && String(u || '').startsWith(baseUrl() + '/'); }

function setupMediaPermissions() {
    const ses = eSession.defaultSession;
    // Electron asks separately for the camera ("media") and for screen/window capture
    // ("display-capture"); both are allowed for our own pages only, and never the microphone.
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
        const url = (details && details.requestingUrl) || (wc && wc.getURL());
        if ((permission === 'media' || permission === 'display-capture') && ourUrl(url)) {
            const types = (details && details.mediaTypes) || [];
            return cb(types.indexOf('audio') < 0);
        }
        cb(false);
    });
    ses.setPermissionCheckHandler((wc, permission, origin) =>
        (permission === 'media' || permission === 'display-capture') && ourUrl(origin + '/'));
    // getDisplayMedia(): no picker; the page said beforehand which window/screen it wants
    ses.setDisplayMediaRequestHandler((request, callback) => {
        let wc = null;
        try { wc = request.frame ? webContents.fromFrame(request.frame) : null; } catch (e) {}
        const spec = (wc && captureWanted.get(wc.id)) || captureWanted.get('last');
        findCaptureSource(spec).then((src) => {
            if (src) callback({ video: src }); else callback(null);
        }).catch(() => { try { callback(null); } catch (e) {} });
    });
}

const captureWanted = new Map();   // webContents id -> { source: 'window'|'screen', match }

async function findCaptureSource(spec) {
    if (!spec) return null;
    const types = spec.source === 'screen' ? ['screen'] : ['window'];
    const list = await desktopCapturer.getSources({ types: types, thumbnailSize: { width: 0, height: 0 } });
    const m = String(spec.match || '').toLowerCase();
    if (!m) return spec.source === 'screen' ? list[0] || null : null;
    return list.find((s) => s.name.toLowerCase() === m) || list.find((s) => s.name.toLowerCase().indexOf(m) >= 0) || null;
}

ipcMain.handle('sm:capture-sources', async (e, opt) => {
    if (!fromAppWindow(e)) return [];
    const o = opt || {};
    const list = await desktopCapturer.getSources({
        types: o.source === 'screen' ? ['screen'] : (o.source === 'window' ? ['window'] : ['window', 'screen']),
        thumbnailSize: o.thumbs ? { width: 240, height: 135 } : { width: 0, height: 0 }
    });
    const own = new Set(Object.values(WINDOW_DEFS).map((d) => d.title).concat(['SlideMang']));
    return list.filter((s) => !own.has(s.name)).map((s) => ({
        name: s.name, kind: s.id.startsWith('screen') ? 'screen' : 'window',
        thumb: o.thumbs && s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : ''
    }));
});

ipcMain.handle('sm:prepare-capture', async (e, spec) => {
    if (!fromAppWindow(e)) return { ok: false };
    const clean = { source: spec && spec.source === 'screen' ? 'screen' : 'window', match: String(spec && spec.match || '') };
    captureWanted.set(e.sender.id, clean);
    captureWanted.set('last', clean);
    const src = await findCaptureSource(clean);
    // id is used by the fallback path (getUserMedia with chromeMediaSource: 'desktop')
    return { ok: !!src, name: src ? src.name : '', id: src ? src.id : '' };
});

ipcMain.handle('sm:open-media-folder', (e) => { if (fromAppWindow(e)) shell.openPath(MEDIA_DIR); });
ipcMain.handle('sm:reload-displays', (e) => { if (fromAppWindow(e)) reloadDisplays(); });

// grip in layout mode (transparent windows have no border to drag) sends the new size here
ipcMain.on('win-resize', (e, size) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w.isDestroyed() || !size) return;
    const width = toInt(size.w, 100, 7680, 100), height = toInt(size.h, 100, 4320, 100);
    w.setSize(width, height);
});

/* ---------- start ---------- */
app.on('second-instance', () => {
    if (launcherWin) { if (launcherWin.isMinimized()) launcherWin.restore(); launcherWin.focus(); }
});

app.whenReady().then(async () => {
    if (!gotLock) return;
    Menu.setApplicationMenu(null);
    loadSettings();
    ensureDirs();
    setupMediaPermissions();
    await startServer();
    createLauncher();
    if (serverState.running && settings.restoreOpen) {
        restoring = true;
        Object.keys(WINDOW_DEFS).forEach((k) => { if (settings.windows[k].open) openWindow(k); });
        setTimeout(() => { restoring = false; }, 3000);
    }
});

app.on('before-quit', () => { quitting = true; saveSettingsNow(); if (session) session.stop(); if (obs) obs.stop(); closeLiveWorker(); });
app.on('window-all-closed', () => { app.quit(); });
app.on('will-quit', () => { if (appServer) appServer.stop(); });
