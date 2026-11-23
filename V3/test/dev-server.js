/*
 * dev-server.js — the app's server without Electron, for testing pages in a normal browser.
 *   node test/dev-server.js [port] [rootDir]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { createAppServer } = require('../src/server');
const { createConfigStore } = require('../src/config-store');
const { createMediaStore } = require('../src/media-store');
const { createSession } = require('../src/session');
const { createI18n } = require('../src/i18n');
const { createObsBridge } = require('../src/obs-bridge');

const APP = path.join(__dirname, '..');
const port = parseInt(process.argv[2] || '8799', 10);
const ROOT = process.argv[3] || path.join(APP, '.devdata');
const DATA = path.join(ROOT, 'data'), MEDIA = path.join(ROOT, 'media');
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(MEDIA, { recursive: true });

const settings = { language: process.env.SM_LANG || 'en', token: '', obs: { enabled: !!process.env.SM_OBS_PORT, host: '127.0.0.1', port: parseInt(process.env.SM_OBS_PORT || '4455', 10), password: process.env.SM_OBS_PASS || '' } };
let obs;
const configStore = createConfigStore({ dataDir: DATA, defaultsDir: path.join(APP, 'defaults') });
const firstRun = !fs.existsSync(configStore.file);
configStore.load();
const mediaStore = createMediaStore({ mediaDir: MEDIA });
if (firstRun) mediaStore.ensureSamples(path.join(APP, 'defaults', 'media'));
const i18n = createI18n([path.join(APP, 'locales')]);
let session;
const server = createAppServer({
    webDir: path.join(APP, 'web'), dataDir: DATA, mediaDir: MEDIA,
    getSettings: () => settings, version: require('../package.json').version,
    appInfo: { version: require('../package.json').version, links: require('../package.json').slidemang.links },
    configStore, mediaStore, i18n,
    getSession: () => session.get(),
    onBusMessage: (ch, m) => { if (m.type === 'OBS_SET_SCENE') obs.setScene(m.scene, m.transition, m.duration); session.onMessage(ch, m); obs.sync(); },
    hooks: {
        obsInfo: () => ({ enabled: settings.obs.enabled, host: settings.obs.host, port: settings.obs.port, hasPassword: !!settings.obs.password, status: obs.status(), toggleStates: obs.toggleStates(), scenes: obs.scenes() }),
        obsUpdate: (b) => { Object.keys(b).forEach((k) => { if (b[k] !== undefined) settings.obs[k] = b[k]; }); obs.reconfigure(); },
        obsSources: () => obs.listSources(),
        obsThumbs: (n, w) => obs.screenshots(n, w),
        onConfigSaved: () => { session.onConfigChanged(); obs.sync(true); server.broadcast(configStore.get().channel, { type: 'SM_RELOAD', roles: ['display', 'controller'] }); },
        onReloadDisplays: () => server.broadcast(configStore.get().channel, { type: 'SM_RELOAD', roles: ['display'] }),
        onDefaultsRequested: () => mediaStore.ensureSamples(path.join(APP, 'defaults', 'media')),
        onLanguage: (c) => { settings.language = c; server.broadcast(configStore.get().channel, { type: 'SM_RELOAD', roles: ['controller', 'setup'] }); }
    }
});
session = createSession({ dataDir: DATA, getConfig: () => configStore.get(), broadcast: (ch, o) => { server.broadcast(ch, o); obs.sync(); } });
obs = createObsBridge({ getObsSettings: () => settings.obs, getConfig: () => configStore.get(), getSession: () => session.get(),
    onStatus: (st) => server.broadcast(configStore.get().channel, Object.assign({ type: 'OBS_STATUS' }, st)),
    onToggleStates: (states) => server.broadcast(configStore.get().channel, { type: 'OBS_TOGGLE_STATE', states: states }),
    onScenes: (sc) => server.broadcast(configStore.get().channel, { type: 'OBS_SCENES', current: sc.current, list: sc.list }), log: (m) => console.log('[obs]', m) });
obs.start();
server.start(port, '127.0.0.1').then((p) => console.log('dev server on http://127.0.0.1:' + p));
