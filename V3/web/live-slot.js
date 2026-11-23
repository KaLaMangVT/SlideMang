/*
 * live-slot.js — camera / window / screen capture slots for the display pages
 * (display-slides: list "media", display-background: list "bg").
 *
 *  - The device is opened only while its item is the current one and its group is shown,
 *    and released shortly after it leaves; image/video items cost nothing extra.
 *  - In the SlideMang app window the device is opened here (live-capture.js).
 *  - Anywhere else (OBS Browser Source, network) the video comes from the app's
 *    live worker over WebRTC (web/live-worker.html).
 *  - Errors are reported to the Controller (LIVE_STATUS), never drawn on the stream
 *    unless the page URL has ?debug.
 */
(function () {
    var ERR_TEXT = {
        APP_ONLY: 'Camera/capture is shown in the SlideMang window only (video relay is off in Setup Media)',
        NO_MEDIA: 'Camera/capture works in the SlideMang window (use Window Capture in OBS)',
        NO_RTC: 'This browser can not receive the live video',
        NotReadableError: 'Camera is busy (used by another program, e.g. OBS?)',
        NotFoundError: 'No camera found',
        OverconstrainedError: 'Camera does not support this resolution / FPS',
        TIMEOUT: 'No answer from the camera / capture (timed out)'
    };

    /* ---------- transparent background (keyer) ----------
     * Window capture and WebRTC carry no alpha: the transparent parts of a window arrive black.
     * A small WebGL shader turns black (or a chosen color) back into transparency here, on the
     * display page, so it works the same in the app window, OBS Browser Sources and network displays.
     * Runs only while the slot is live and the option is on. */
    var VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
    var FS = 'precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform vec4 crop;uniform float mode,lo,hi;uniform vec3 key;' +
        'vec2 cc(vec3 c){return vec2(-.1687*c.r-.3313*c.g+.5*c.b,.5*c.r-.4187*c.g-.0813*c.b);}' +
        'void main(){vec3 c=texture2D(tex,crop.xy+uv*crop.zw).rgb;float a;' +
        'if(mode<1.5){a=smoothstep(lo,hi,max(c.r,max(c.g,c.b)));gl_FragColor=vec4(min(c,vec3(a)),a);}' +   // black: soft edges are un-multiplied
        'else{a=smoothstep(lo,hi,distance(cc(c),cc(key)));gl_FragColor=vec4(c*a,a);}}';
    function keyConf(it) {
        if (!it || (it.type !== 'camera' && it.type !== 'capture') || (it.key !== 'black' && it.key !== 'color')) return null;
        var black = it.key === 'black';
        var lvl = (it.keyLevel != null ? +it.keyLevel : (black ? 4 : 25)) / 100, soft = (it.keySoft != null ? +it.keySoft : 10) / 100;
        var scale = black ? 1 : 0.5;   // chroma distance is at most ~0.7
        var hex = /^#[0-9a-f]{6}$/i.test(it.keyColor || '') ? it.keyColor : '#00ff00';
        return { mode: black ? 1 : 2, lo: lvl * scale, hi: lvl * scale + Math.max(soft * scale, 0.002),
            key: [1, 3, 5].map(function (k) { return parseInt(hex.substr(k, 2), 16) / 255; }) };
    }
    function Keyer(video, canvas) {
        this.v = video; this.c = canvas; this.gl = null; this.raf = 0; this.conf = null; this.crop = [0, 0, 0, 0];
    }
    Keyer.prototype.init = function () {
        if (this.gl) return true;
        var gl = this.c.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
        if (!gl) return false;
        function sh(t, src) { var x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); return x; }
        var pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
        gl.useProgram(pr);
        var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        var tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
        [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (k) { gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE); });
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.u = {}; var self = this;
        ['crop', 'mode', 'lo', 'hi', 'key'].forEach(function (n) { self.u[n] = gl.getUniformLocation(pr, n); });
        this.gl = gl;
        return true;
    };
    Keyer.prototype.set = function (conf, crop) {
        this.conf = conf; this.crop = crop || [0, 0, 0, 0];
        if (!conf) { this.stop(); return true; }
        if (!this.init()) return false;
        if (!this.raf) this.loop();
        return true;
    };
    Keyer.prototype.loop = function () {
        var self = this;
        this.raf = requestAnimationFrame(function () { self.draw(); self.loop(); });
    };
    Keyer.prototype.draw = function () {
        var v = this.v, gl = this.gl, k = this.conf;
        if (!gl || !k || v.readyState < 2 || !v.videoWidth) return;
        if (v.requestVideoFrameCallback && this.lastT === v.currentTime && this.lastConf === k) return;   // nothing new
        this.lastT = v.currentTime; this.lastConf = k;
        var c = this.crop.map(function (x) { return (+x || 0) / 100; });   // top right bottom left
        var w = Math.max(1, Math.round(v.videoWidth * (1 - c[1] - c[3]))), h = Math.max(1, Math.round(v.videoHeight * (1 - c[0] - c[2])));
        if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
        gl.viewport(0, 0, w, h);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
        gl.uniform4f(this.u.crop, c[3], c[0], 1 - c[1] - c[3], 1 - c[0] - c[2]);
        gl.uniform1f(this.u.mode, k.mode); gl.uniform1f(this.u.lo, k.lo); gl.uniform1f(this.u.hi, k.hi);
        gl.uniform3f(this.u.key, k.key[0], k.key[1], k.key[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    Keyer.prototype.stop = function () {
        cancelAnimationFrame(this.raf); this.raf = 0; this.lastT = -1;
        if (this.gl) { this.gl.clearColor(0, 0, 0, 0); this.gl.clear(this.gl.COLOR_BUFFER_BIT); }
    };

    function create(o) {
        var bc = o.bc, listName = o.list || 'media';
        var run = {};          // index -> { stream, stopTimer, spec, viewer, pc, ... }
        var overrides = {};    // index -> settings changed in the Controller (media list only)
        var viewers = {};      // viewer id -> run entry
        var pinned = {};       // index -> true while it is being preloaded (kept open although not shown yet)

        function items() { return o.items() || []; }
        function isLive(it) { return SMLive.isLive(it); }
        function item(i) {
            var base = items()[i] || {}, ov = overrides[i] || {}, r = {};
            for (var k in base) r[k] = base[k];
            for (var k2 in ov) r[k2] = ov[k2];
            return r;
        }
        function el(i) { return o.elements[i]; }
        /** resolves once the video element has painted a real frame (not just got a stream) */
        function firstFrame(video) {
            return new Promise(function (res) {
                function done() { requestAnimationFrame(function () { requestAnimationFrame(res); }); }   // let the keyer draw too
                if (video.requestVideoFrameCallback) { video.requestVideoFrameCallback(function () { done(); }); return; }
                if (video.readyState >= 2 && video.videoWidth) { done(); return; }
                var on = function () { if (video.videoWidth) { video.removeEventListener('loadeddata', on); video.removeEventListener('playing', on); done(); } };
                video.addEventListener('loadeddata', on); video.addEventListener('playing', on);
            });
        }
        function settle(r, ok) { if (r && r.readyResolve) { var f = r.readyResolve; r.readyResolve = null; f(ok); } }
        function post(m) { m.list = listName; bc.postMessage(m); }

        function applyLook(e, it) {
            var v = e.querySelector('video');
            v.style.objectFit = it.fit === 'none' ? 'none' : (it.fit === 'contain' ? 'contain' : (it.fit === 'cover' ? 'cover' : 'fill'));
            // relayed video can arrive smaller than the source for a moment: lay it out at the source size
            var src = e._srcSize;
            if (it.fit === 'none' && src && src.w && src.h) {
                v.style.objectFit = 'fill';
                v.style.width = src.w + 'px'; v.style.height = src.h + 'px';
                v.style.left = 'calc(50% - ' + (src.w / 2) + 'px)'; v.style.top = 'calc(50% - ' + (src.h / 2) + 'px)';
                v.style.right = 'auto'; v.style.bottom = 'auto';
            } else {
                v.style.width = v.style.height = v.style.left = v.style.top = v.style.right = v.style.bottom = '';
            }
            v.style.transform = (it.type === 'camera' && it.mirror) ? 'scaleX(-1)' : '';
            var c = it.crop || [0, 0, 0, 0];
            v.style.objectViewBox = (it.type === 'capture' && (c[0] || c[1] || c[2] || c[3])) ? 'inset(' + c[0] + '% ' + c[1] + '% ' + c[2] + '% ' + c[3] + '%)' : '';
            keyLook(e, it);
        }
        /** transparent background: the canvas takes the video's place (same fit / size / mirror) */
        function keyLook(e, it) {
            var v = e.querySelector('video'), cv = e.querySelector('canvas.live-key');
            if (!cv) return;
            var conf = keyConf(it), crop = it.type === 'capture' ? (it.crop || [0, 0, 0, 0]) : [0, 0, 0, 0];
            var running = !!(e._keyOn && conf);
            var ok = running ? e._keyer.set(conf, crop) : (e._keyer.set(null), false);
            ['objectFit', 'width', 'height', 'left', 'top', 'right', 'bottom', 'transform'].forEach(function (k) { cv.style[k] = v.style[k]; });
            var src = e._srcSize;
            if (it.fit === 'none' && src && src.w && src.h) {   // actual size of the cropped part
                var w = Math.round(src.w * (100 - crop[1] - crop[3]) / 100), h = Math.round(src.h * (100 - crop[0] - crop[2]) / 100);
                cv.style.width = w + 'px'; cv.style.height = h + 'px';
                cv.style.left = 'calc(50% - ' + (w / 2) + 'px)'; cv.style.top = 'calc(50% - ' + (h / 2) + 'px)';
            }
            cv.style.display = ok ? '' : 'none';
            v.style.opacity = ok ? '0' : '';   // keep decoding: the canvas reads from it
        }
        function makeSlot(it) {
            var e = document.createElement('div');
            e.className = 'media-item live-slot';
            var v = document.createElement('video');
            v.muted = true; v.autoplay = true; v.playsInline = true;
            var cv = document.createElement('canvas'); cv.className = 'live-key'; cv.style.display = 'none';
            var m = document.createElement('div'); m.className = 'live-msg';
            e.appendChild(v); e.appendChild(cv); e.appendChild(m);
            e._keyer = new Keyer(v, cv);
            applyLook(e, it);
            return e;
        }
        function msg(i, text) {
            var e = el(i); if (!e) return;
            e.querySelector('.live-msg').textContent = text || '';
            e.classList.toggle('has-msg', !!text);
        }
        function status(i, state, message, label) {
            post({ type: 'LIVE_STATUS', index: i, state: state, message: message || '', label: label || '', app: !!window.SlideMangApp });
        }
        function stopNow(i) {
            var r = run[i]; if (!r) return;
            clearTimeout(r.stopTimer);
            if (r.pc || r.viewer) rtcClose(r); else SMLive.stop(r.stream);
            var e = el(i); if (e) { e._keyOn = false; keyLook(e, item(i)); e.querySelector('video').srcObject = null; }
            delete run[i];
            settle(r, false);
            status(i, 'stopped');
        }
        function stopSoon(i) {
            var r = run[i]; if (!r || r.stopTimer) return;
            r.stopTimer = setTimeout(function () { stopNow(i); }, 800); // after the exit animation
        }
        function open(i, r, it) {
            if (window.SlideMangApp) return SMLive.open(it);
            if (typeof LIVE_RELAY !== 'undefined' && !LIVE_RELAY) return Promise.reject(new Error('APP_ONLY'));
            if (!window.RTCPeerConnection) return Promise.reject(new Error('NO_RTC'));
            return SMLive.withTimeout(rtcReceive(i, r), 20000);
        }
        function start(i) {
            var r = run[i];
            if (r) { clearTimeout(r.stopTimer); r.stopTimer = 0; return; }
            var it = item(i), e = el(i), video = e.querySelector('video');
            r = run[i] = { stream: null, stopTimer: 0, spec: SMLive.spec(it), index: i };
            r.ready = new Promise(function (res) { r.readyResolve = res; });
            applyLook(e, it);
            msg(i, '');
            status(i, 'starting');
            open(i, r, it).then(function (res) {
                if (run[i] !== r) { if (!r.pc) SMLive.stop(res.stream); return; }   // stopped meanwhile
                r.stream = res.stream; r.label = res.label;
                e._srcSize = res.width && res.height ? { w: res.width, h: res.height } : null;
                applyLook(e, item(i));
                var tr = res.stream.getVideoTracks()[0];
                if (tr && !r.pc) tr.onended = function () {
                    if (run[i] === r) { delete run[i]; msg(i, it.type === 'capture' ? 'Capture ended (window closed?)' : 'Camera disconnected'); status(i, 'error', 'ENDED'); }
                };
                video.srcObject = res.stream;
                video.play().catch(function () {});
                e._keyOn = true; keyLook(e, item(i));
                status(i, 'live', '', res.label);
                firstFrame(video).then(function () { settle(r, true); });
            }).catch(function (err) {
                if (run[i] === r) { rtcClose(r); delete run[i]; }
                settle(r, false);
                var code = (err && err.message) || 'ERROR';
                var text = ERR_TEXT[code] ||
                    (code === 'NOT_FOUND' ? (it.source === 'screen' ? 'Screen' : 'Window') + ' not found: ' + (it.match || '—') : '') ||
                    (code === 'NotAllowedError' ? (it.type === 'capture' ? 'Capture failed (window/screen not available)' : 'Camera permission denied') : '') ||
                    ('Cannot start: ' + code);
                msg(i, text);
                status(i, 'error', code);
            });
        }

        /* ---- WebRTC viewer ---- */
        function want(r) { if (!r.answered && r.viewer) post({ type: 'RTC_WANT', viewer: r.viewer, index: r.index }); }
        function rtcReceive(i, r) {
            return new Promise(function (resolve, reject) {
                r.viewer = 'v' + Math.random().toString(36).slice(2, 10);
                r.rtcResolve = resolve; r.rtcReject = reject;
                viewers[r.viewer] = r;
                want(r);
                r.wantTimer = setInterval(function () { want(r); }, 3000);   // the worker may still be starting
            });
        }
        function rtcOffer(d) {
            var r = viewers[d.viewer]; if (!r || r.pc) return;
            var pc = r.pc = new RTCPeerConnection({ iceServers: [] });
            pc.ontrack = function (ev) {
                var st = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
                if (r.rtcResolve) { r.rtcResolve({ stream: st, label: d.label || '', width: d.width, height: d.height }); r.rtcResolve = null; }
            };
            pc.onconnectionstatechange = function () { if (pc.connectionState === 'failed') rtcFail(r, 'RTC_FAILED'); };
            pc.setRemoteDescription({ type: 'offer', sdp: d.sdp })
                .then(function () { return pc.createAnswer(); })
                .then(function (a) { return pc.setLocalDescription(a); })
                .then(function () {
                    return new Promise(function (res) {
                        if (pc.iceGatheringState === 'complete') return res();
                        var t = setTimeout(res, 2500);
                        pc.addEventListener('icegatheringstatechange', function () { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
                    });
                })
                .then(function () { r.answered = true; clearInterval(r.wantTimer); post({ type: 'RTC_ANSWER', viewer: d.viewer, sdp: pc.localDescription.sdp }); })
                .catch(function () { rtcFail(r, 'RTC_FAILED'); });
        }
        function rtcFail(r, code) {
            if (r.rtcReject) { r.rtcReject(new Error(code)); r.rtcReject = null; r.rtcResolve = null; return; }
            for (var k in run) if (run[k] === r) { rtcClose(r); delete run[k]; settle(r, false); status(+k, 'error', code); }
        }
        function rtcClose(r) {
            if (!r || !r.viewer) return;
            clearInterval(r.wantTimer);
            post({ type: 'RTC_BYE', viewer: r.viewer });
            if (r.pc) { try { r.pc.close(); } catch (e) {} }
            delete viewers[r.viewer];
            r.viewer = null;
        }

        function sync() {
            items().forEach(function (it, i) {
                if (!isLive(it)) return;
                if (o.active(i) || pinned[i]) start(i); else stopSoon(i);
            });
        }
        /**
         * Open item i before it is shown and resolve when its first frame is on screen
         * (true), or when it failed / took longer than maxMs (false). The caller switches
         * to it afterwards and then calls unpin(i).
         */
        function preload(i, maxMs) {
            if (!isLive(items()[i])) return Promise.resolve(true);
            pinned[i] = true;
            start(i);
            var r = run[i];
            if (!r || !r.ready) return Promise.resolve(false);
            return Promise.race([r.ready, new Promise(function (res) { setTimeout(function () { res(false); }, maxMs || 8000); })]);
        }
        function unpin(i) { if (pinned[i]) { delete pinned[i]; sync(); } }
        function restart(i) { stopNow(i); sync(); }
        function setOverride(i, patch) {
            if (!isLive(items()[i])) return;
            if (patch) overrides[i] = patch; else delete overrides[i];
            var e = el(i); if (e) applyLook(e, item(i));
            // look-only changes (mirror, fit, crop) do not reopen the device; relayed video is reopened by the worker
            var r = run[i];
            if (r && !r.viewer && r.spec !== SMLive.spec(item(i))) restart(i);
            else if (!r) sync();
        }
        function setOverrides(map) {
            overrides = map || {};
            items().forEach(function (it, i) {
                if (!isLive(it)) return;
                applyLook(el(i), item(i));
                if (run[i] && !run[i].viewer && run[i].spec !== SMLive.spec(item(i))) stopNow(i);
            });
        }
        /** bus messages; returns true when handled */
        function handle(d) {
            var mine = (d.list || 'media') === listName;
            switch (d.type) {
                case 'RTC_OFFER': rtcOffer(d); return true;
                case 'RTC_ERROR': if (viewers[d.viewer]) rtcFail(viewers[d.viewer], d.code); return true;
                case 'RTC_WORKER_READY': for (var v in viewers) want(viewers[v]); return true;
                case 'LIVE_STATUS': case 'RTC_WANT': case 'RTC_ANSWER': case 'RTC_BYE': return true;
                case 'LIVE_RESTART': if (mine) restart(d.index); return true;
                case 'LIVE_OVERRIDE': if (mine) setOverride(d.index, d.patch); return true;
            }
            return false;
        }
        function stopAll() { Object.keys(run).forEach(function (k) { stopNow(+k); }); }
        window.addEventListener('beforeunload', stopAll);

        return { makeSlot: makeSlot, sync: sync, preload: preload, unpin: unpin, restart: restart, setOverride: setOverride, setOverrides: setOverrides, handle: handle, stopAll: stopAll, running: function () { return run; } };
    }

    window.SMLiveSlots = { create: create };
})();
