/*
 * server.js — เซิร์ฟเวอร์ในตัวโปรแกรม (ไม่ต้องใช้แพ็กเกจเสริม)
 *   - เสิร์ฟหน้าเว็บ (web/), ไฟล์สื่อ (media/), และ media-config.js (data/)
 *   - /bus  : WebSocket "ท่อกลาง" แทน BroadcastChannel (ส่งต่อข้อความให้ทุกคนในช่องเดียวกัน)
 *   - /api/info , /api/send : ข้อมูลเซิร์ฟเวอร์ / ส่งคำสั่งจากภายนอก
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
                addresses: getLanAddresses(), clients: clients.size
            }));
        }

        if (p === '/api/send' && req.method === 'POST') {
            const ch = url.searchParams.get('ch') || 'obs_control';
            return readBody(req, 1024 * 1024).then((body) => {
                let msg;
                try { msg = JSON.parse(body); } catch (e) { return sendText(res, 400, 'Invalid JSON'); }
                const n = broadcast(ch, JSON.stringify(msg), null);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: true, delivered: n }));
            }).catch(() => sendText(res, 413, 'Body too large'));
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');

        if (p === '/') {
            res.writeHead(302, { Location: '/controller.html' });
            return res.end();
        }
        if (p === '/media-config.js') return serveFile(req, res, path.join(dataDir, 'media-config.js'), true);
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
                if (op2 === 0x1) broadcast(client.ch, full.toString('utf8'), client);
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
