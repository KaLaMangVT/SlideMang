/* Run with: npm test   (plain Node, no Electron needed) */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalize, toScript } = require('../src/config-store');
const { createConfigStore } = require('../src/config-store');
const { createMediaStore } = require('../src/media-store');
const { createSession } = require('../src/session');
const { createI18n } = require('../src/i18n');
const { mergeSettings } = require('../src/settings');

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ok  ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sm-test-')); }

(async () => {
    console.log('config-store');
    await test('normalize fills defaults and cleans paths', () => {
        const c = normalize({ list: [{ file: '.\\media\\a b.jpg' }, { file: '' }, { file: '../x.png', fit: 'actual' }], bgs: ['x.png'] });
        assert.deepStrictEqual(c.list.map((i) => i.file), ['a b.jpg', 'x.png']);
        assert.strictEqual(c.list[1].fit, 'none');
        assert.deepStrictEqual(c.bgs, ['x.png', '', '']);
        assert.strictEqual(c.channel, 'obs_control');
    });
    await test('OBS Source items need a source', () => {
        const c = normalize({ list: [{ type: 'obs', obsSource: ' Webcam ', obsScene: 'Live', desc: 'Cam', file: 'x.jpg' }, { type: 'obs' }] });
        assert.deepStrictEqual(c.list, [{ type: 'obs', obsSource: 'Webcam', obsScene: 'Live', desc: 'Cam' }]);
    });
    await test('camera / capture items are validated', () => {
        const c = normalize({ list: [
            { type: 'camera', device: 'Cam X', res: '4k', fps: 120, mirror: 1 },
            { type: 'capture', source: 'screen', match: ' Chrome ', fps: 60, crop: [5, 80, 'x'], fit: '' },
            { type: 'obs', obsSource: 'A', obsMode: 'toggle' }] });
        assert.deepStrictEqual(c.list[0], { type: 'camera', device: 'Cam X', res: 'auto', fps: 30, mirror: true, fit: 'cover' });
        assert.strictEqual(normalize({ list: [{ type: 'camera', res: '2160p' }] }).list[0].res, '2160p');
        assert.strictEqual(normalize({ list: [{ type: 'camera', res: '1440p' }] }).list[0].res, '1440p');
        assert.deepStrictEqual(c.list[1], { type: 'capture', source: 'screen', match: 'Chrome', fps: 60, crop: [5, 45, 0, 0], fit: '' });
        assert.strictEqual(c.list[2].obsMode, 'toggle');
    });
    await test('OBSSCENE_LIST: own list, old Media List scene items move there', () => {
        const c = normalize({ list: [{ file: 'a.jpg' }, { type: 'scene', obsScene: ' BRB ', desc: 'Back soon' }],
            obsScenes: [{ name: 'Game', scene: 'Gameplay', transition: 'Fade', duration: 300 }, { scene: '' }] });
        assert.deepStrictEqual(c.list, [{ file: 'a.jpg' }]);
        assert.deepStrictEqual(c.obsScenes, [{ name: 'Game', scene: 'Gameplay', transition: 'Fade', duration: 300 },
            { name: 'Back soon', scene: 'BRB', transition: '', duration: 0 }]);
    });
    await test('transparent background (key) options are validated', () => {
        const c = normalize({ list: [
            { type: 'capture', key: 'black' },
            { type: 'camera', key: 'color', keyColor: 'red', keyLevel: 300, keySoft: -5 },
            { type: 'capture', key: 'nope', keyLevel: 50 }] });
        assert.strictEqual(c.list[0].key, 'black'); assert.strictEqual(c.list[0].keyLevel, 4); assert.strictEqual(c.list[0].keySoft, 10);
        assert.strictEqual(c.list[0].keyColor, undefined);
        assert.deepStrictEqual([c.list[1].keyColor, c.list[1].keyLevel, c.list[1].keySoft], ['#00ff00', 100, 0]);
        assert.strictEqual(c.list[2].key, undefined); assert.strictEqual(c.list[2].keyLevel, undefined);
    });
    await test('Background List accepts camera / capture / OBS Source but not scenes', () => {
        const c = normalize({ bgList: [{ type: 'camera' }, { type: 'capture', source: 'screen' }, { type: 'obs', obsSource: 'V' }, { type: 'scene', obsScene: 'X' }] });
        assert.deepStrictEqual(c.bgList.map((x) => x.type), ['camera', 'capture', 'obs']);
    });
    await test('auto slide skips OBS toggle items', async () => {
        const d = tmp(), sent = [];
        const cfg = normalize({ list: [{ file: 'a.jpg' }, { type: 'obs', obsSource: 'T', obsMode: 'toggle' }, { file: 'b.jpg' }] });
        const s = createSession({ dataDir: d, getConfig: () => cfg, broadcast: (ch, m) => sent.push(m) });
        s.onMessage('obs_control', { type: 'SESSION_PUSH', session: { media: { autoSlide: { enabled: true, intervalSec: 0.1 } }, extra: { index: 0 } } });
        await new Promise((r) => setTimeout(r, 250));
        s.stop();
        assert.deepStrictEqual(sent.slice(0, 2).map((m) => m.index), [2, 0]);
    });
    await test('OBS WebSocket auth string (obs-websocket v5 algorithm)', () => {
        const { authString } = require('../src/obs-bridge');
        const crypto = require('crypto');
        const h = (x) => crypto.createHash('sha256').update(x).digest('base64');
        assert.strictEqual(authString('pw', 'salt', 'chal'), h(h('pwsalt') + 'chal'));
    });
    await test('generated script defines the globals the pages use', () => {
        const s = toScript(normalize({ list: [{ file: 'a.jpg' }] }));
        const ctx = {}; require('vm').runInNewContext(s, ctx);
        assert.strictEqual(ctx.MEDIA_BASE, './media/');
        assert.strictEqual(ctx.MEDIA_LIST[0].file, 'a.jpg');
        assert.ok(Array.isArray(ctx.MEDIA_TITLEBARS));
    });
    await test('store: first run copies defaults, save keeps a backup', () => {
        const d = tmp(), defs = path.join(__dirname, '..', 'defaults');
        const st = createConfigStore({ dataDir: d, defaultsDir: defs });
        const c = st.load();
        assert.strictEqual(c.list.length, 1);
        st.save(Object.assign({}, c, { list: [{ file: 'z.jpg' }] }));
        assert.ok(fs.existsSync(path.join(d, 'config.json.bak')));
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'config.json'))).list[0].file, 'z.jpg');
    });

    console.log('media-store');
    await test('import copies, reuses identical files and renames different ones', async () => {
        const media = tmp(), src = tmp();
        const ms = createMediaStore({ mediaDir: media });
        fs.writeFileSync(path.join(src, 'a.jpg'), 'AAAA');
        let r = await ms.importPaths([path.join(src, 'a.jpg')], '');
        assert.deepStrictEqual([r[0].path, r[0].copied], ['a.jpg', true]);
        r = await ms.importPaths([path.join(src, 'a.jpg')], '');
        assert.deepStrictEqual([r[0].path, r[0].copied], ['a.jpg', false]);
        fs.writeFileSync(path.join(src, 'a.jpg'), 'BBBBBB');
        r = await ms.importPaths([path.join(src, 'a.jpg')], '');
        assert.strictEqual(r[0].path, 'a (2).jpg');
    });
    await test('import into sub-folders, and a file already in media/ is not copied', async () => {
        const media = tmp(), src = tmp();
        const ms = createMediaStore({ mediaDir: media });
        fs.writeFileSync(path.join(src, 'v.mp4'), 'video');
        let r = await ms.importPaths([path.join(src, 'v.mp4')], 'Topic 1/sub');
        assert.strictEqual(r[0].path, 'Topic 1/sub/v.mp4');
        r = await ms.importPaths([path.join(media, 'Topic 1', 'sub', 'v.mp4')], '');
        assert.deepStrictEqual([r[0].path, r[0].copied], ['Topic 1/sub/v.mp4', false]);
        const l = await ms.list();
        assert.deepStrictEqual(l.dirs, ['Topic 1', 'Topic 1/sub']);
    });
    await test('sub-folder names cannot escape media/', async () => {
        const media = tmp(), src = tmp();
        const ms = createMediaStore({ mediaDir: media });
        fs.writeFileSync(path.join(src, 'x.png'), 'x');
        const r = await ms.importPaths([path.join(src, 'x.png')], '../../evil');
        assert.strictEqual(r[0].path, 'evil/x.png');
    });
    await test('not enough space -> NO_SPACE and nothing copied', async () => {
        const media = tmp(), src = tmp();
        const ms = createMediaStore({ mediaDir: media });
        fs.writeFileSync(path.join(src, 'big.mp4'), 'x');
        const orig = fs.promises.statfs;
        fs.promises.statfs = async () => ({ bavail: 1, bsize: 1024 });
        try {
            await assert.rejects(ms.importPaths([path.join(src, 'big.mp4')], ''), (e) => e.code === 'NO_SPACE');
            assert.strictEqual(fs.readdirSync(media).length, 0);
        } finally { fs.promises.statfs = orig; }
    });

    console.log('session');
    await test('auto slide runs once in the app and wraps around', async () => {
        const d = tmp(), sent = [];
        const cfg = normalize({ list: [{ file: 'a.jpg' }, { file: 'b.mp4', loop: false }, { file: 'c.jpg' }] });
        const s = createSession({ dataDir: d, getConfig: () => cfg, broadcast: (ch, m) => sent.push(m) });
        s.onMessage('obs_control', { type: 'SESSION_PUSH', session: { media: { autoSlide: { enabled: true, intervalSec: 0.1 } }, extra: { index: 1 } } });
        await new Promise((r) => setTimeout(r, 350));
        s.stop();
        const idx = sent.filter((m) => m.type === 'MEDIA_CHANGE').map((m) => m.index);
        assert.ok(idx.length >= 2, 'ticks: ' + idx.length);
        assert.deepStrictEqual(idx.slice(0, 2), [2, 0]);
        assert.ok(fs.existsSync(path.join(d, 'session.json')));
    });
    await test('manual change restarts the countdown; other channels are ignored', async () => {
        const d = tmp(), sent = [];
        const cfg = normalize({ list: [{ file: 'a.jpg' }, { file: 'b.jpg' }] });
        const s = createSession({ dataDir: d, getConfig: () => cfg, broadcast: (ch, m) => sent.push(m) });
        s.onMessage('other', { type: 'SESSION_PUSH', session: { media: { autoSlide: { enabled: true, intervalSec: 0.1 } } } });
        await new Promise((r) => setTimeout(r, 150));
        assert.strictEqual(sent.length, 0);
        s.onMessage('obs_control', { type: 'SESSION_PUSH', session: { media: { autoSlide: { enabled: true, intervalSec: 0.2 } }, extra: { index: 0 } } });
        await new Promise((r) => setTimeout(r, 120));
        s.onMessage('obs_control', { type: 'MEDIA_CHANGE', index: 1 });
        await new Promise((r) => setTimeout(r, 120));
        assert.strictEqual(sent.length, 0, 'countdown restarted');
        await new Promise((r) => setTimeout(r, 150));
        s.stop();
        assert.strictEqual(sent[0].index, 0);
    });
    await test('background auto slide only while visible', async () => {
        const d = tmp(), sent = [];
        const cfg = normalize({ list: [{ file: 'a.jpg' }], bgList: [{ file: 'x.jpg' }, { file: 'y.jpg' }] });
        const s = createSession({ dataDir: d, getConfig: () => cfg, broadcast: (ch, m) => sent.push(m) });
        s.onMessage('obs_control', { type: 'SESSION_PUSH', session: { background: { show: false, autoSlide: { enabled: true, intervalSec: 0.1 } } } });
        await new Promise((r) => setTimeout(r, 250));
        assert.strictEqual(sent.length, 0);
        s.onMessage('obs_control', { type: 'SESSION_PUSH', session: { background: { show: true, autoSlide: { enabled: true, intervalSec: 0.1 } } } });
        await new Promise((r) => setTimeout(r, 250));
        s.stop();
        assert.ok(sent.length >= 1 && sent[0].type === 'BG_CHANGE_INDEX');
    });

    console.log('i18n / settings');
    await test('locales load, English always present', () => {
        const i = createI18n([path.join(__dirname, '..', 'locales')]);
        const codes = i.list().map((l) => l.code);
        assert.ok(codes.indexOf('en') >= 0 && codes.indexOf('th') >= 0);
        assert.strictEqual(i.payload('th').dict['Delete'], 'ลบ');
        assert.strictEqual(i.payload('xx').lang, 'en');
    });
    await test('settings keep a valid language', () => {
        const def = { port: 1, allowLan: false, token: '', restoreOpen: false, language: 'en', windows: {} };
        assert.strictEqual(mergeSettings(def, { language: 'th' }).language, 'th');
        assert.strictEqual(mergeSettings(def, { language: '../x' }).language, 'en');
    });

    console.log(failed ? '\n' + failed + ' test(s) FAILED' : '\nall tests passed');
    process.exit(failed ? 1 : 0);
})();
