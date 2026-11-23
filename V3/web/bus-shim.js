/*
 * bus-shim.js
 * -----------------------------------------------------------------
 * Replaces BroadcastChannel with a WebSocket through the app's server, so the
 * windows, OBS Browser Sources, phones and other computers all talk to each other.
 * Pages keep calling  new BroadcastChannel(name)  as before.
 *
 * Same behaviour as BroadcastChannel: a message is not echoed back to its sender.
 *
 * v3: the app can ask pages to reload themselves with
 *     { type: 'SM_RELOAD', roles: ['display' | 'controller' | 'setup'] }
 *     (used by "Refresh OBS", saving Setup Media and changing the language).
 */
(function () {
    if (window.__busShimInstalled) return;
    window.__busShimInstalled = true;
    if (!/^https?:$/.test(location.protocol)) return; // file:// -> keep the browser's own

    var page = location.pathname.split('/').pop() || '';
    var ROLE = /^display-/.test(page) ? 'display' : (/^setup/.test(page) ? 'setup' : (/^live-worker/.test(page) ? 'worker' : 'controller'));
    window.SM_ROLE = ROLE;
    var reloadTimer = 0;
    function maybeReload(data) {
        if (!data || data.type !== 'SM_RELOAD') return false;
        var roles = Array.isArray(data.roles) ? data.roles : [];
        if (roles.indexOf(ROLE) < 0) return true;
        if (typeof window.SM_beforeReload === 'function') {
            try { if (window.SM_beforeReload(data) === false) return true; } catch (e) {}
        }
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(function () { location.reload(); }, 150);
        return true;
    }

    function Bus(name) {
        this.name = String(name);
        this.onmessage = null;
        this.onmessageerror = null;
        this._listeners = [];
        this._queue = [];
        this._closed = false;
        this._everOpened = false;
        this._ws = null;
        this._connect();
    }

    Bus.prototype._connect = function () {
        if (this._closed) return;
        var self = this;
        var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
        var ws;
        try {
            ws = new WebSocket(proto + location.host + '/bus?ch=' + encodeURIComponent(this.name));
        } catch (e) {
            setTimeout(function () { self._connect(); }, 1000);
            return;
        }
        this._ws = ws;

        ws.onopen = function () {
            var reconnect = self._everOpened;
            self._everOpened = true;
            // send what was queued while connecting
            var q = self._queue; self._queue = [];
            for (var i = 0; i < q.length; i++) ws.send(q[i]);
            // reconnected after a drop: ask for the state again (a Controller answers MEDIA_HELLO)
            if (reconnect) ws.send(JSON.stringify({ type: 'MEDIA_HELLO' }));
        };

        ws.onmessage = function (ev) {
            var data;
            try { data = JSON.parse(ev.data); } catch (e) { return; }
            if (maybeReload(data)) return;
            var evt = { data: data, target: self, type: 'message' };
            if (typeof self.onmessage === 'function') {
                try { self.onmessage(evt); } catch (err) { console.error(err); }
            }
            for (var i = 0; i < self._listeners.length; i++) {
                try { self._listeners[i](evt); } catch (err2) { console.error(err2); }
            }
        };

        ws.onclose = function () {
            if (self._ws === ws) self._ws = null;
            if (!self._closed) setTimeout(function () { self._connect(); }, 1000);
        };
        ws.onerror = function () { try { ws.close(); } catch (e) {} };
    };

    Bus.prototype.postMessage = function (msg) {
        var text;
        try { text = JSON.stringify(msg); } catch (e) { return; }
        if (this._ws && this._ws.readyState === 1) this._ws.send(text);
        else if (this._queue.length < 200) this._queue.push(text);
    };

    Bus.prototype.addEventListener = function (type, fn) {
        if (type === 'message' && typeof fn === 'function') this._listeners.push(fn);
    };
    Bus.prototype.removeEventListener = function (type, fn) {
        var i = this._listeners.indexOf(fn);
        if (type === 'message' && i >= 0) this._listeners.splice(i, 1);
    };

    Bus.prototype.close = function () {
        this._closed = true;
        if (this._ws) { try { this._ws.close(); } catch (e) {} }
    };

    window.BroadcastChannel = Bus;
})();
