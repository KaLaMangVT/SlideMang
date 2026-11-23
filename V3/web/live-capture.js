/*
 * live-capture.js — opens a camera or a window/screen capture for a Media List item.
 * Used by the SlideMang display window (shows it directly) and by the live worker
 * (sends it to OBS Browser Sources / network displays over WebRTC).
 * Both run inside the SlideMang app, where window.SlideMangApp exists.
 */
(function () {
    function isLive(item) { return !!item && (item.type === 'camera' || item.type === 'capture'); }

    /** what has to change for the device to be reopened (look-only changes do not count) */
    function spec(it) { return [it.type, it.device, it.res, it.fps, it.source, it.match].join('|'); }

    function cameraConstraints(item, devices) {
        var v = { frameRate: { ideal: item.fps || 30 } };
        var RES = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160] };
        if (RES[item.res]) { v.width = { ideal: RES[item.res][0] }; v.height = { ideal: RES[item.res][1] }; }
        var cams = devices.filter(function (d) { return d.kind === 'videoinput'; });
        var want = String(item.device || '').toLowerCase(), hit = null;
        if (want) hit = cams.filter(function (d) { return d.label.toLowerCase() === want; })[0] || cams.filter(function (d) { return d.label.toLowerCase().indexOf(want) >= 0; })[0];
        if (hit) v.deviceId = { exact: hit.deviceId };
        return { c: { video: v, audio: false }, label: hit ? hit.label : '' };
    }

    function withTimeout(p, ms) {
        return Promise.race([p, new Promise(function (res, rej) { setTimeout(function () { rej(new Error('TIMEOUT')); }, ms); })]);
    }

    /** -> Promise<{ stream, label }>; rejects with Error(code) */
    function open(item) {
        if (!window.SlideMangApp) return Promise.reject(new Error('APP_ONLY'));
        if (!navigator.mediaDevices) return Promise.reject(new Error('NO_MEDIA'));
        var p;
        if (item.type === 'camera') {
            var label = '';
            p = navigator.mediaDevices.enumerateDevices().then(function (devs) {
                var c = cameraConstraints(item, devs);
                label = c.label;
                return navigator.mediaDevices.getUserMedia(c.c);
            }).then(function (stream) {
                var tr = stream.getVideoTracks()[0];
                return { stream: stream, label: label || (tr && tr.label) || '' };
            });
        } else {
            p = window.SlideMangApp.prepareCapture({ source: item.source, match: item.match }).then(function (res) {
                if (!res || !res.ok) throw new Error('NOT_FOUND');
                var fps = item.fps || 30;
                return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: fps, max: fps } }, audio: false })
                    .catch(function (e1) {
                        // fallback: the older desktop-capture path, straight from the source id
                        if (!res.id) throw e1;
                        return navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
                            chromeMediaSource: 'desktop', chromeMediaSourceId: res.id, maxFrameRate: fps, maxWidth: 3840, maxHeight: 2160 } } })
                            .catch(function () { throw e1; });
                    })
                    .then(function (stream) { return { stream: stream, label: res.name }; });
            });
        }
        return withTimeout(p, 12000).catch(function (e) {
            var known = ['APP_ONLY', 'NOT_FOUND', 'NO_MEDIA', 'TIMEOUT'];
            throw new Error(e && known.indexOf(e.message) >= 0 ? e.message : ((e && e.name) || 'ERROR'));
        });
    }

    function stop(stream) { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); }

    window.SMLive = { isLive: isLive, spec: spec, open: open, stop: stop, withTimeout: withTimeout };
})();
