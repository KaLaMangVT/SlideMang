/*
 * preload-window.js — runs in every app window (controller, setup, displays)
 *  1) "Layout mode" (toggled from the Launcher): dashed frame, drag bar and a resize grip
 *     for transparent windows that have no border.
 *  2) window.SlideMangApp — small bridge used by Setup Media inside the app:
 *     real file paths for picked/dropped files and copying them into media/.
 *     Pages opened in a normal browser do not have it and upload files instead.
 */
'use strict';
const { ipcRenderer, contextBridge, webUtils } = require('electron');

contextBridge.exposeInMainWorld('SlideMangApp', {
    isApp: true,
    pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
    pickFiles: (opt) => ipcRenderer.invoke('sm:pick-files', opt || {}),
    importFiles: (paths, sub) => ipcRenderer.invoke('sm:import', paths, sub || ''),
    openMediaFolder: () => ipcRenderer.invoke('sm:open-media-folder'),
    reloadDisplays: () => ipcRenderer.invoke('sm:reload-displays'),
    // windows / screens that can be captured ({ source: 'window'|'screen'|'', thumbs: bool })
    captureSources: (opt) => ipcRenderer.invoke('sm:capture-sources', opt || {}),
    // tell the app which window/screen the next getDisplayMedia() should return
    prepareCapture: (spec) => ipcRenderer.invoke('sm:prepare-capture', spec || {})
});

const ID = '__layout_overlay__';
let titleText = '';

function removeOverlay() {
    const el = document.getElementById(ID);
    if (el) el.remove();
    window.removeEventListener('resize', updateLabel);
}

function updateLabel() {
    const l = document.getElementById(ID + 'label');
    if (l) l.textContent = titleText + '  ' + window.innerWidth + ' x ' + window.innerHeight;
}

function addOverlay() {
    if (document.getElementById(ID) || !document.body) return;
    const root = document.createElement('div');
    root.id = ID;
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;box-sizing:border-box;' +
        'border:3px dashed #ff3b9a;font-family:Segoe UI,Arial,sans-serif;';

    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;top:0;left:0;right:0;height:34px;background:rgba(255,59,154,.88);' +
        'color:#fff;font-size:14px;line-height:34px;padding:0 12px;pointer-events:auto;cursor:move;' +
        '-webkit-app-region:drag;user-select:none;';
    const label = document.createElement('span');
    label.id = ID + 'label';
    bar.appendChild(label);

    const grip = document.createElement('div');
    grip.style.cssText = 'position:absolute;right:0;bottom:0;width:30px;height:30px;background:rgba(255,59,154,.88);' +
        'pointer-events:auto;cursor:nwse-resize;-webkit-app-region:no-drag;' +
        'clip-path:polygon(100% 0,100% 100%,0 100%);';

    let start = null;
    grip.addEventListener('pointerdown', (e) => {
        grip.setPointerCapture(e.pointerId);
        start = { sx: e.screenX, sy: e.screenY, w: window.outerWidth, h: window.outerHeight };
        e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
        if (!start) return;
        ipcRenderer.send('win-resize', {
            w: Math.round(start.w + (e.screenX - start.sx)),
            h: Math.round(start.h + (e.screenY - start.sy))
        });
    });
    const end = (e) => { start = null; try { grip.releasePointerCapture(e.pointerId); } catch (err) {} };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);

    root.appendChild(bar);
    root.appendChild(grip);
    document.body.appendChild(root);
    window.addEventListener('resize', updateLabel);
    updateLabel();
}

ipcRenderer.on('layout-mode', (e, info) => {
    titleText = (info && info.title) || '';
    const apply = () => { if (info && info.on) addOverlay(); else removeOverlay(); };
    if (document.body) apply(); else window.addEventListener('DOMContentLoaded', apply, { once: true });
});
// a reload (port change, Refresh OBS) clears layout mode; main re-sends it when needed
