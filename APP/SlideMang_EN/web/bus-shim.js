/*
 * bus-shim.js
 * -----------------------------------------------------------------
 * แทนที่ BroadcastChannel ด้วย WebSocket ที่คุยผ่านเซิร์ฟเวอร์ในโปรแกรม
 * ทำให้หน้าต่างต่างๆ (และ OBS Browser Source / มือถือ / เครื่องอื่น) คุยกันได้
 * โค้ดเดิมที่เรียก  new BroadcastChannel(name)  ไม่ต้องแก้เลย
 *
 * พฤติกรรมเหมือน BroadcastChannel เดิม: ข้อความที่ส่งจะไม่ย้อนกลับมาหาผู้ส่งเอง
 * ถ้าเปิดไฟล์ด้วย file:// จะใช้ BroadcastChannel ของเบราว์เซอร์ตามเดิม
 */
(function () {
    if (window.__busShimInstalled) return;
    window.__busShimInstalled = true;
    if (!/^https?:$/.test(location.protocol)) return; // file:// -> ใช้ของเดิม

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
            // ส่งข้อความที่ค้างไว้ระหว่างรอเชื่อมต่อ
            var q = self._queue; self._queue = [];
            for (var i = 0; i < q.length; i++) ws.send(q[i]);
            // ถ้าเพิ่งต่อใหม่หลังหลุด ให้ขอ state ซ้ำ (controller จะตอบ MEDIA_HELLO ด้วย sync)
            if (reconnect) ws.send(JSON.stringify({ type: 'MEDIA_HELLO' }));
        };

        ws.onmessage = function (ev) {
            var data;
            try { data = JSON.parse(ev.data); } catch (e) { return; }
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
