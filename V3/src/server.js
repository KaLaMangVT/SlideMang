/*
 * server.js — built-in server (no extra packages)
 *   - serves web/ pages, media/ files, /media-config.js (generated from data/config.json)
 *     and /i18n.js (current language)
 *   - /bus  : WebSocket hub that replaces BroadcastChannel between pages
 *   - /api/* : info, send, config, media, session, language, reload-displays
 *
 *   Write APIs need the header "X-SlideMang: 1" (blocks other websites in the
 *   browser from changing anything) and are allowed from this computer, or from
 *   other devices only when a password (token) is set.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_WS_MESSAGE = 8 * 1024 * 1024;

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.txt': 'text/plain; charset=utf-8'
};

function isLoopback(addr) {
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function getLanAddresses() {
    const out = [];
    const ifs = os.networkInterfaces();
    Object.keys(ifs).forEach((name) => {
        (ifs[name] || []).forEach((i) => {
            if (i.family === 'IPv4' && !i.internal) out.push(i.address);
        });
    });
    return out;
}

function parseCookies(header) {
    const out = {};
    String(header || '').split(';').forEach((p) => {
        const i = p.indexOf('=');
        if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out;
}

/* ---------- WebSocket frame helpers ---------- */
function encodeFrame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode; header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

function createAppServer(opts) {
    const webDir = opts.webDir;
    const dataDir = opts.dataDir;
    const mediaDir = opts.mediaDir;
    const getSettings = opts.getSettings || (() => ({}));
    const log = opts.log || (() => {});
    const version = opts.version || '0.0.0';
    const configStore = opts.configStore;
    const mediaStore = opts.mediaStore;
    const i18n = opts.i18n;
    const getSession = opts.getSession || (() => null);
    const onBusMessage = opts.onBusMessage || (() => {});
    const hooks = opts.hooks || {};
    const runtimeFile = path.join(webDir, 'i18n-runtime.js');

    let server = null;
    let currentPort = 0;
    const clients = new Set(); // { socket, ch, buf, frag, fragOp }
    let pingTimer = null;

    /* ----- auth: ถ้าตั้ง token ไว้ เครื่องอื่น (ไม่ใช่ localhost) ต้องใส่ ?token=xxx ครั้งแรก แล้วจะจำด้วย cookie ----- */
    function checkAuth(req, url) {
        const token = String(getSettings().token || '');
        if (!token) return { ok: true };
        if (isLoopback(req.socket.remoteAddress)) return { ok: true };
        const q = url.searchParams.get('token');
        if (q && q === token) return { ok: true, setCookie: true };
        const c = parseCookies(req.headers.cookie);
        if (c.obs_tk === token) return { ok: true };
        const h = req.headers['x-token'];
        if (h && h === token) return { ok: true };
        return { ok: false };
    }

    function sendText(res, code, text, extraHeaders) {
        res.writeHead(code, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, extraHeaders || {}));
        res.end(text);
    }

    function sendJson(res, code, obj) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
    }

    function canWrite(req) {
        if (req.headers['x-slidemang'] !== '1') return false;
        if (isLoopback(req.socket.remoteAddress)) return true;
        return !!String(getSettings().token || ''); // other devices: only with a password set
    }

    function sameOrigin(req) {
        const origin = req.headers.origin;
        if (!origin || origin === 'null' || origin.startsWith('file://')) return true;
        try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
    }

    function readJson(req, limit) {
        return readBody(req, limit).then((t) => JSON.parse(t || 'null'));
    }

    function apiError(res, e) {
        const code = e && e.code === 'NO_SPACE' ? 507 : (e && (e.code === 'BAD_PATH' || e instanceof SyntaxError) ? 400 : 500);
        sendJson(res, code, { ok: false, code: (e && e.code) || 'ERROR', message: String(e && e.message || e), need: e && e.need, free: e && e.free });
    }

    function handleApi(req, res, url, p) {
        const m = req.method;
        const write = m !== 'GET' && m !== 'HEAD';
        if (write && !canWrite(req)) {
            const msg = req.headers['x-slidemang'] !== '1' ? 'Missing X-SlideMang header.' : 'Set a password in the Launcher to allow changes from other devices.';
            return sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: msg });
        }

        if (p === '/api/config' && m === 'GET') return sendJson(res, 200, configStore.get());
        if (p === '/api/config/defaults' && m === 'GET') {
            if (hooks.onDefaultsRequested) hooks.onDefaultsRequested();
            return sendJson(res, 200, configStore.defaults());
        }
        if (p === '/api/config' && m === 'PUT') {
            return readJson(req, 8 * 1024 * 1024).then((body) => {
                const before = configStore.get().channel;
                const saved = configStore.save(body);
                if (hooks.onConfigSaved) hooks.onConfigSaved(saved, before);
                sendJson(res, 200, { ok: true, config: saved });
            }).catch((e) => apiError(res, e));
        }
        if (p === '/api/media' && m === 'GET') {
            return mediaStore.list().then((r) => sendJson(res, 200, r)).catch((e) => apiError(res, e));
        }
        if (p === '/api/media/mkdir' && m === 'POST') {
            return readJson(req, 4096).then((b) => mediaStore.mkdir(b && b.dir))
                .then((rel) => sendJson(res, 200, { ok: true, dir: rel })).catch((e) => apiError(res, e));
        }
        if (p === '/api/media/upload' && m === 'PUT') {
            const size = parseInt(req.headers['content-length'], 10);
            if (!(size >= 0)) return sendJson(res, 411, { ok: false, code: 'LENGTH', message: 'Content-Length required' });
            return mediaStore.upload(req, url.searchParams.get('dir') || '', url.searchParams.get('name') || 'file', size)
                .then((r) => sendJson(res, 200, Object.assign({ ok: true }, r))).catch((e) => apiError(res, e));
        }
        if (p === '/api/session' && m === 'GET') return sendJson(res, 200, { session: getSession() });
        if (p === '/api/obs' && m === 'GET') return sendJson(res, 200, hooks.obsInfo ? hooks.obsInfo() : {});
        if (p === '/api/obs' && m === 'PUT') {
            return readJson(req, 8192).then((b) => {
                if (hooks.obsUpdate) hooks.obsUpdate(b || {});
                sendJson(res, 200, Object.assign({ ok: true }, hooks.obsInfo ? hooks.obsInfo() : {}));
            }).catch((e) => apiError(res, e));
        }
        if (p === '/api/obs/thumbs' && m === 'GET') {
            const names = String(url.searchParams.get('scenes') || '').split('\n').filter(Boolean).slice(0, 60);
            if (!hooks.obsThumbs) return sendJson(res, 503, { ok: false });
            return hooks.obsThumbs(names, url.searchParams.get('w')).then((r) => sendJson(res, 200, r))
                .catch((e) => sendJson(res, 503, { ok: false, message: String(e.message || e) }));
        }
        if (p === '/api/obs/sources' && m === 'GET') {
            if (!hooks.obsSources) return sendJson(res, 503, { ok: false, message: 'OBS not available' });
            return hooks.obsSources().then((r) => sendJson(res, 200, r))
                .catch((e) => sendJson(res, 503, { ok: false, code: 'OBS', message: String(e.message || e) }));
        }
        if (p === '/api/reload-displays' && m === 'POST') {
            if (hooks.onReloadDisplays) hooks.onReloadDisplays();
            return sendJson(res, 200, { ok: true });
        }
        if (p === '/api/lang' && m === 'GET') return sendJson(res, 200, i18n.payload(getSettings().language || 'en'));
        if (p === '/api/lang' && m === 'POST') {
            return readJson(req, 4096).then((b) => {
                const code = b && b.lang;
                if (!i18n.has(code)) return sendJson(res, 400, { ok: false, message: 'Unknown language' });
                if (hooks.onLanguage) hooks.onLanguage(code);
                sendJson(res, 200, { ok: true, lang: code });
            }).catch((e) => apiError(res, e));
        }
        return sendJson(res, 404, { ok: false, message: 'Unknown API' });
    }

    function safeJoin(root, urlPath) {
        let rel;
        try { rel = decodeURIComponent(urlPath); } catch (e) { return null; }
        rel = rel.replace(/\0/g, '');
        const full = path.normalize(path.join(root, rel));
        const rootNorm = path.normalize(root + path.sep);
        if (full !== path.normalize(root) && !full.startsWith(rootNorm)) return null;
        return full;
    }

    function serveFile(req, res, filePath, noCache) {
        fs.stat(filePath, (err, st) => {
            if (err || !st.isFile()) return sendText(res, 404, 'Not found');
            const ext = path.extname(filePath).toLowerCase();
            const headers = {
                'Content-Type': MIME[ext] || 'application/octet-stream',
                'Accept-Ranges': 'bytes'
            };
            if (noCache || ext === '.html' || ext === '.js' || ext === '.json') headers['Cache-Control'] = 'no-cache';

            const range = req.headers.range;
            if (range) {
                const m = /^bytes=(\d*)-(\d*)$/.exec(range);
                if (m) {
                    let start, end;
                    if (m[1] === '' && m[2] !== '') { // suffix: bytes=-N
                        const n = parseInt(m[2], 10);
                        start = Math.max(0, st.size - n); end = st.size - 1;
                    } else {
                        start = parseInt(m[1], 10);
                        end = m[2] === '' ? st.size - 1 : Math.min(parseInt(m[2], 10), st.size - 1);
                    }
                    if (isNaN(start) || start > end || start >= st.size) {
                        res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
                        return res.end();
                    }
                    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
                    headers['Content-Length'] = end - start + 1;
                    res.writeHead(206, headers);
                    if (req.method === 'HEAD') return res.end();
                    const rs = fs.createReadStream(filePath, { start: start, end: end });
                    rs.on('error', () => res.destroy());
                    res.on('close', () => rs.destroy());
                    return rs.pipe(res);
                }
            }
            headers['Content-Length'] = st.size;
            res.writeHead(200, headers);
            if (req.method === 'HEAD') return res.end();
            const rs = fs.createReadStream(filePath);
            rs.on('error', () => res.destroy());
            res.on('close', () => rs.destroy());
            rs.pipe(res);
        });
    }

    function readBody(req, limit) {
        return new Promise((resolve, reject) => {
            const chunks = []; let size = 0;
            req.on('data', (c) => {
                size += c.length;
                if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
                chunks.push(c);
            });
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            req.on('error', reject);
        });
    }

    /* ----- broadcast ----- */
    function broadcast(ch, text, exceptClient) {
        const frame = encodeFrame(0x1, Buffer.from(text, 'utf8'));
        let n = 0;
        clients.forEach((c) => {
            if (c !== exceptClient && c.ch === ch && !c.socket.destroyed) {
                try { c.socket.write(frame); n++; } catch (e) { /* ignore */ }
            }
        });
        return n;
    }

    /* ----- HTTP ----- */
    function onRequest(req, res) {
        let url;
        try { url = new URL(req.url, 'http://localhost'); } catch (e) { return sendText(res, 400, 'Bad request'); }

        const auth = checkAuth(req, url);
        if (!auth.ok) {
            return sendText(res, 401, 'Unauthorized: add ?token=YOUR_TOKEN to the URL once.');
        }
        if (auth.setCookie) {
            // ตั้ง cookie จำ token (ใช้กับทุก request ถัดไป รวมถึง WebSocket)
            res.setHeader('Set-Cookie', 'obs_tk=' + encodeURIComponent(String(getSettings().token)) + '; Path=/; SameSite=Lax; HttpOnly');
        }

        const p = url.pathname;

        if (p === '/api/info') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({
                app: 'SlideMang', version: version, port: currentPort,
                addresses: getLanAddresses(), clients: clients.size,
                lang: getSettings().language || 'en'
            }));
        }

        if (p === '/api/send' && req.method === 'POST') {
            const ch = url.searchParams.get('ch') || 'obs_control';
            return readBody(req, 1024 * 1024).then((body) => {
                let msg;
                try { msg = JSON.parse(body); } catch (e) { return sendText(res, 400, 'Invalid JSON'); }
                const n = broadcast(ch, JSON.stringify(msg), null);
                try { onBusMessage(ch, msg); } catch (e) {}
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: true, delivered: n }));
            }).catch(() => sendText(res, 413, 'Body too large'));
        }

        if (p.startsWith('/api/')) return handleApi(req, res, url, p);

        if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');

        if (p === '/') {
            res.writeHead(302, { Location: '/controller.html' });
            return res.end();
        }
        if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
        if (p === '/app-info.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
            return res.end('window.SLIDEMANG_INFO = ' + JSON.stringify(opts.appInfo || {}).replace(/</g, '\\u003c') + ';\n');
        }
        if (p === '/media-config.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
            return res.end(configStore.script());
        }
        if (p === '/i18n.js') {
            let runtime = '';
            try { runtime = fs.readFileSync(runtimeFile, 'utf8'); } catch (e) {}
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
            return res.end('window.__I18N = ' + JSON.stringify(i18n.payload(getSettings().language || 'en')).replace(/</g, '\\u003c') + ';\n' + runtime);
        }
        if (p.startsWith('/media/')) {
            const f = safeJoin(mediaDir, p.slice('/media/'.length));
            if (!f) return sendText(res, 403, 'Forbidden');
            return serveFile(req, res, f, false);
        }
        const f = safeJoin(webDir, p.replace(/^\/+/, ''));
        if (!f) return sendText(res, 403, 'Forbidden');
        return serveFile(req, res, f, false);
    }

    /* ----- WebSocket ----- */
    function onUpgrade(req, socket) {
        let url;
        try { url = new URL(req.url, 'http://localhost'); } catch (e) { return socket.destroy(); }
        const key = req.headers['sec-websocket-key'];
        if (url.pathname !== '/bus' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); return socket.destroy();
        }
        if (!checkAuth(req, url).ok) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy();
        }
        if (!sameOrigin(req)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy();
        }
        const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
            'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
        );
        socket.setNoDelay(true);

        const client = { socket: socket, ch: url.searchParams.get('ch') || 'obs_control', buf: Buffer.alloc(0), frag: [], fragOp: 0, fragSize: 0 };
        clients.add(client);

        const cleanup = () => { clients.delete(client); };
        socket.on('close', cleanup);
        socket.on('error', () => { cleanup(); socket.destroy(); });
        socket.on('data', (chunk) => {
            client.buf = client.buf.length ? Buffer.concat([client.buf, chunk]) : chunk;
            try { parseFrames(client); } catch (e) { log('ws parse error: ' + e.message); socket.destroy(); }
        });
    }

    function parseFrames(client) {
        for (;;) {
            const b = client.buf;
            if (b.length < 2) return;
            const fin = (b[0] & 0x80) !== 0;
            const op = b[0] & 0x0f;
            const masked = (b[1] & 0x80) !== 0;
            let len = b[1] & 0x7f;
            let off = 2;
            if (len === 126) {
                if (b.length < 4) return;
                len = b.readUInt16BE(2); off = 4;
            } else if (len === 127) {
                if (b.length < 10) return;
                const big = b.readBigUInt64BE(2);
                if (big > BigInt(MAX_WS_MESSAGE)) throw new Error('frame too large');
                len = Number(big); off = 10;
            }
            if (len > MAX_WS_MESSAGE) throw new Error('frame too large');
            const need = off + (masked ? 4 : 0) + len;
            if (b.length < need) return;

            let payload;
            if (masked) {
                const mask = b.slice(off, off + 4);
                payload = Buffer.alloc(len);
                const src = b.slice(off + 4, off + 4 + len);
                for (let i = 0; i < len; i++) payload[i] = src[i] ^ mask[i & 3];
            } else {
                payload = Buffer.from(b.slice(off, off + len));
            }
            client.buf = b.slice(need);

            if (op === 0x8) { // close
                try { client.socket.write(encodeFrame(0x8, payload.slice(0, 2))); } catch (e) {}
                client.socket.end();
                return;
            }
            if (op === 0x9) { // ping -> pong
                try { client.socket.write(encodeFrame(0xA, payload)); } catch (e) {}
                continue;
            }
            if (op === 0xA) continue; // pong

            if (op === 0x1 || op === 0x2) {
                client.fragOp = op; client.frag = [payload]; client.fragSize = payload.length;
            } else if (op === 0x0) {
                client.frag.push(payload); client.fragSize += payload.length;
                if (client.fragSize > MAX_WS_MESSAGE) throw new Error('message too large');
            } else {
                continue;
            }
            if (fin) {
                const full = Buffer.concat(client.frag);
                const op2 = client.fragOp;
                client.frag = []; client.fragOp = 0; client.fragSize = 0;
                if (op2 === 0x1) {
                    const text = full.toString('utf8');
                    broadcast(client.ch, text, client);
                    let msg = null;
                    try { msg = JSON.parse(text); } catch (e) {}
                    if (msg) { try { onBusMessage(client.ch, msg); } catch (e) { log('bus hook: ' + e.message); } }
                }
            }
        }
    }

    /* ----- start / stop ----- */
    function listenOnce(port, host) {
        return new Promise((resolve, reject) => {
            const s = http.createServer(onRequest);
            s.on('upgrade', onUpgrade);
            s.once('error', reject);
            s.listen(port, host, () => { s.removeListener('error', reject); resolve(s); });
        });
    }

    async function start(port, host) {
        await stop();
        let lastErr = null;
        for (let i = 0; i < 10; i++) {
            try {
                server = await listenOnce(port + i, host);
                currentPort = port + i;
                server.on('error', (e) => log('server error: ' + e.message));
                pingTimer = setInterval(() => {
                    const ping = encodeFrame(0x9, Buffer.alloc(0));
                    clients.forEach((c) => { try { c.socket.write(ping); } catch (e) {} });
                }, 30000);
                return currentPort;
            } catch (e) {
                lastErr = e;
                if (e.code !== 'EADDRINUSE') break;
            }
        }
        throw lastErr || new Error('cannot start server');
    }

    function stop() {
        return new Promise((resolve) => {
            if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
            clients.forEach((c) => { try { c.socket.destroy(); } catch (e) {} });
            clients.clear();
            if (!server) return resolve();
            const s = server; server = null; currentPort = 0;
            s.close(() => resolve());
            if (s.closeAllConnections) s.closeAllConnections();
        });
    }

    return {
        start: start, stop: stop,
        getPort: () => currentPort,
        clientCount: () => clients.size,
        broadcast: (ch, obj) => broadcast(ch, JSON.stringify(obj), null)
    };
}

module.exports = { createAppServer, getLanAddresses };
