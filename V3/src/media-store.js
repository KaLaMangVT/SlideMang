/*
 * media-store.js — everything that touches the media/ folder
 *  - list files and sub-folders
 *  - import (copy) files picked in Explorer / dropped on the page into media/
 *  - receive uploads from browsers on other devices
 *  - check free disk space before copying (fs.statfs, no extra permission needed)
 */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const SPACE_MARGIN = 64 * 1024 * 1024; // keep 64 MB free after copying
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif|mp4|webm|mov|m4v|ogv|mp3|wav|ogg|m4a)$/i;

class MediaError extends Error {
    constructor(code, message, extra) { super(message); this.code = code; Object.assign(this, extra || {}); }
}

function toRel(p) { return p.split(path.sep).join('/'); }

function cleanSubdir(sub) {
    return String(sub || '').replace(/\\/g, '/').split('/')
        .map((s) => s.trim().replace(/[<>:"|?*\x00-\x1f]/g, '_'))
        .filter((s) => s && s !== '.' && s !== '..').join('/');
}

function cleanName(name) {
    let n = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    n = n.replace(/^\.+/, '');
    if (!n) n = 'file';
    if (n.length > 180) { const ext = path.extname(n); n = n.slice(0, 180 - ext.length) + ext; }
    return n;
}

async function freeBytes(dir) {
    try {
        const st = await fsp.statfs(dir);
        return Number(st.bavail) * Number(st.bsize);
    } catch (e) {
        return Infinity; // statfs not available: let the OS report problems
    }
}

/** fast "same file" check: size + hash of the first and last 1 MB */
async function quickHash(file, size) {
    const h = crypto.createHash('sha1');
    const fd = await fsp.open(file, 'r');
    try {
        const chunk = Math.min(size, 1024 * 1024);
        const buf = Buffer.alloc(chunk);
        await fd.read(buf, 0, chunk, 0); h.update(buf);
        if (size > chunk) { await fd.read(buf, 0, chunk, size - chunk); h.update(buf); }
    } finally { await fd.close(); }
    return h.digest('hex');
}

function createMediaStore(opts) {
    const root = opts.mediaDir;

    function inside(full) {
        const r = path.resolve(root) + path.sep;
        return path.resolve(full).startsWith(r);
    }

    function resolveSub(sub) {
        const s = cleanSubdir(sub);
        const dir = path.join(root, ...s.split('/').filter(Boolean));
        if (dir !== path.resolve(root) && !inside(dir)) throw new MediaError('BAD_PATH', 'Invalid folder');
        return { rel: s, dir: dir };
    }

    async function list() {
        const files = [], dirs = [];
        async function walk(dir, depth) {
            let ents;
            try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
            for (const e of ents) {
                if (e.name.startsWith('.')) continue;
                const full = path.join(dir, e.name);
                const rel = toRel(path.relative(root, full));
                if (e.isDirectory()) { dirs.push(rel); if (depth < 6) await walk(full, depth + 1); }
                else if (e.isFile() && MEDIA_EXT.test(e.name)) {
                    let st = null; try { st = await fsp.stat(full); } catch (er) {}
                    files.push({ path: rel, size: st ? st.size : 0 });
                }
            }
        }
        await walk(root, 0);
        files.sort((a, b) => a.path.localeCompare(b.path));
        dirs.sort();
        return { files: files, dirs: dirs };
    }

    async function mkdir(sub) {
        const r = resolveSub(sub);
        if (!r.rel) throw new MediaError('BAD_PATH', 'Folder name is empty');
        await fsp.mkdir(r.dir, { recursive: true });
        return r.rel;
    }

    /** pick a destination name; reuse an identical existing file instead of copying twice */
    async function destFor(dir, name, srcSize, srcHashFn) {
        const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
        for (let i = 1; i < 1000; i++) {
            const candidate = i === 1 ? name : stem + ' (' + i + ')' + ext;
            const full = path.join(dir, candidate);
            let st;
            try { st = await fsp.stat(full); } catch (e) { return { full: full, exists: false }; }
            if (st.isFile() && st.size === srcSize && srcHashFn && (await quickHash(full, st.size)) === (await srcHashFn())) {
                return { full: full, exists: true };
            }
        }
        throw new MediaError('NAME', 'Too many files with the same name');
    }

    /**
     * Copy local files (absolute paths from Explorer / drag-drop) into media/<sub>.
     * Only reachable through Electron IPC — never from the HTTP server — so a device on
     * the network can not make the app copy arbitrary files from this computer.
     */
    async function importPaths(paths, sub) {
        const target = resolveSub(sub);
        await fsp.mkdir(target.dir, { recursive: true });
        const srcs = [];
        let total = 0;
        for (const p of (Array.isArray(paths) ? paths : [])) {
            if (typeof p !== 'string' || !p) continue;
            const st = await fsp.stat(p).catch(() => null);
            if (!st || !st.isFile()) { srcs.push({ src: p, error: 'NOT_FOUND' }); continue; }
            const already = inside(p);
            srcs.push({ src: p, size: st.size, mtime: st.mtime, already: already });
            if (!already) total += st.size;
        }
        const free = await freeBytes(target.dir);
        if (total + SPACE_MARGIN > free) {
            throw new MediaError('NO_SPACE', 'Not enough disk space', { need: total, free: free });
        }
        const out = [];
        for (const s of srcs) {
            if (s.error) { out.push({ src: s.src, error: s.error }); continue; }
            if (s.already) { out.push({ src: s.src, path: toRel(path.relative(root, s.src)), copied: false }); continue; }
            const name = cleanName(path.basename(s.src));
            let hash = null;
            const d = await destFor(target.dir, name, s.size, async () => hash || (hash = await quickHash(s.src, s.size)));
            if (!d.exists) {
                await fsp.copyFile(s.src, d.full);
                try { await fsp.utimes(d.full, new Date(), s.mtime); } catch (e) {}
            }
            out.push({ src: s.src, path: toRel(path.relative(root, d.full)), copied: !d.exists });
        }
        return out;
    }

    /** Stream an HTTP upload (browser on another device) into media/<sub>/<name>. */
    async function upload(req, sub, name, size) {
        const target = resolveSub(sub);
        await fsp.mkdir(target.dir, { recursive: true });
        const free = await freeBytes(target.dir);
        if (size + SPACE_MARGIN > free) throw new MediaError('NO_SPACE', 'Not enough disk space', { need: size, free: free });
        const clean = cleanName(name);
        const tmp = path.join(target.dir, '.upload-' + crypto.randomBytes(6).toString('hex'));
        await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(tmp);
            let got = 0;
            req.on('data', (c) => { got += c.length; if (got > size + 1024) { req.destroy(); reject(new MediaError('SIZE', 'Upload larger than declared')); } });
            req.pipe(ws);
            ws.on('finish', resolve);
            ws.on('error', reject);
            req.on('error', reject);
            req.on('aborted', () => reject(new MediaError('ABORTED', 'Upload aborted')));
        }).catch(async (e) => { await fsp.rm(tmp, { force: true }); throw e; });
        const st = await fsp.stat(tmp);
        let hash = null;
        const d = await destFor(target.dir, clean, st.size, async () => hash || (hash = await quickHash(tmp, st.size)));
        if (d.exists) await fsp.rm(tmp, { force: true });
        else await fsp.rename(tmp, d.full);
        return { path: toRel(path.relative(root, d.full)), copied: !d.exists };
    }

    /** copy bundled sample files (defaults/media) into media/ when they are missing */
    function ensureSamples(samplesDir) {
        let names = [];
        try { names = fs.readdirSync(samplesDir); } catch (e) { return; }
        fs.mkdirSync(root, { recursive: true });
        names.forEach((n) => {
            const dst = path.join(root, n);
            if (!fs.existsSync(dst)) { try { fs.copyFileSync(path.join(samplesDir, n), dst); } catch (e) {} }
        });
    }

    return { list, mkdir, importPaths, upload, ensureSamples, freeBytes: () => freeBytes(root) };
}

module.exports = { createMediaStore, MediaError, cleanSubdir, cleanName };
