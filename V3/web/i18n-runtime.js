/*
 * i18n-runtime.js — translates the page from English into the selected language.
 *  - window.__I18N = { lang, dict, locales } is set before this file runs
 *    (served together as /i18n.js, or by the launcher preload).
 *  - Static text, data-tip, placeholder and title are translated when the page loads,
 *    and again whenever the page changes them (MutationObserver).
 *  - Code uses t('English text', { name: value }) for text built from pieces.
 *  - Anything inside [data-no-i18n] (user content: file names, titlebar text…) is left alone.
 */
(function () {
    var I = window.__I18N || { lang: 'en', dict: {}, locales: [] };
    var dict = I.dict || {};
    var active = I.lang !== 'en' && Object.keys(dict).length > 0;
    var ATTRS = ['data-tip', 'placeholder', 'title'];

    function fill(s, vars) {
        if (!vars) return s;
        return String(s).replace(/\{(\w+)\}/g, function (m, n) { return vars[n] != null ? vars[n] : m; });
    }
    window.t = function (key, vars) {
        var s = (active && dict[key]) ? dict[key] : key;
        return fill(s, vars);
    };
    window.I18N = { lang: I.lang || 'en', locales: I.locales || [], t: window.t };
    document.documentElement.lang = I.lang || 'en';
    if (!active) return;

    function tr(s) {
        if (!s) return s;
        var k = s.trim();
        if (!k) return s;
        var v = dict[k];
        if (!v) return s;
        return s.replace(k, v);
    }
    function skip(el) {
        for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
            if (n.hasAttribute('data-no-i18n')) return true;
            var tag = n.nodeName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return true;
        }
        return false;
    }
    function trEl(el) {
        for (var i = 0; i < ATTRS.length; i++) {
            var a = ATTRS[i];
            if (el.hasAttribute(a)) {
                var o = el.getAttribute(a), v = tr(o);
                if (v !== o) el.setAttribute(a, v);
            }
        }
    }
    function walk(root) {
        if (root.nodeType === 3) {
            if (root.parentNode && !skip(root.parentNode)) { var v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; }
            return;
        }
        if (root.nodeType !== 1 || skip(root)) return;
        trEl(root);
        var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                if (n.nodeType === 1) return (n.hasAttribute('data-no-i18n') || n.nodeName === 'SCRIPT' || n.nodeName === 'STYLE' || n.nodeName === 'TEXTAREA') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) { var t2 = tr(n.nodeValue); if (t2 !== n.nodeValue) n.nodeValue = t2; }
            else trEl(n);
        }
    }
    function start() {
        document.title = tr(document.title);
        walk(document.body);
        new MutationObserver(function (list) {
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
                else if (m.type === 'characterData') walk(m.target);
                else if (m.type === 'attributes' && !skip(m.target)) trEl(m.target);
            }
        }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
