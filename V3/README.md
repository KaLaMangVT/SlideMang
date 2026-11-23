# SlideMang v3 (Portable)

One program, every language. Controller + Setup Media + OBS display windows with a built-in server.
v3 is the main version from now on and is independent of the old versions (`../APP`, `../WEB`), which are kept as they are.

## What is new in v3
- **One codebase, selectable language** (English default, ไทย included). Switch from the Launcher, Controller (menu bar) or Setup Media.
  Add a language: copy `locales/th.json` to `locales/<code>.json`, change `_meta.name`, translate the values (keys stay English).
  A `locales` folder placed next to `SlideMang.exe` is loaded too — no rebuild needed.
- **Portable folder**: `data/` and `media/` live next to `SlideMang.exe`. Copy the whole folder to another PC and everything comes with it.
- **Setup Media**
  - opens the current settings automatically; **💾 Save** (or Ctrl+S) writes `data/config.json` directly (a `.bak` copy is kept)
  - 📁 next to any file field copies the chosen file **into `media/`** (or a sub-folder chosen in the toolbar)
  - **drag & drop** files onto Media List / Background List → copied into `media/` and a row is created for each
  - **📥 Add files…** adds several files at once; **+ New folder** makes topic sub-folders
  - free disk space is checked before copying; if it is not enough nothing is copied and you get a message
  - identical files are not copied twice; a different file with the same name becomes `name (2).ext`
  - files missing from `media/` are marked ⚠
  - **↺ Reset to Default** loads an example with one item in every list (sample images included)
  - selecting/dragging text inside a field no longer moves the row (only the ⠿ handle drags)
- **Everything stays in sync**
  - saving Setup Media updates every Controller and OBS display immediately
  - **🔄 Refresh OBS** (Launcher and Controller) reloads OBS Titlebar / Slides / Background — app windows *and* OBS Browser Sources
  - all open Controllers (app, browser, phone) share one live state: current item, show/hide, titlebar, volume…
  - **Auto Slide runs once, inside the app** — two open Controllers no longer double-step, and it keeps running with no Controller open
  - the state is saved automatically to `data/session.json` (in the Controller, **💾 Save** writes `data/controller-save.json`, **📂 Load** reads it back, **↺ Reset Default** returns to the defaults)
  - which panel groups are shown is remembered per device
- **OBS Source slides** (camera / window / game capture): the capture stays in OBS; SlideMang turns the chosen OBS source on while its slide is showing and off when the slide changes or Media is hidden (obs-websocket, built into OBS 28+). Set it up in Setup Media → General → OBS connection, then **📡 Add OBS Source** in the Media List. Sources SlideMang does not use are never touched.
- **Camera and Window / Screen capture slides** inside SlideMang (📷 Add Camera / 🖥 Add Capture). The device is opened only while that slide is on air and Media is shown, and released right after, so image/video-only setups use no extra resources. Pick the camera by name, resolution, FPS, mirror; pick a window from thumbnails (match by title), or a screen; crop edges in %. While on air, the Controller shows a live panel to switch camera/window, mirror, fit and crop, with 💾 Save to Setup. These run in the SlideMang display window (capture it with OBS Window Capture); OBS Browser Sources can not open devices. If OBS uses the same camera, only one of the two programs can have it.
- **Live video relay (WebRTC)**: OBS Browser Sources and displays opened over the network can not open cameras or capture this PC's screen, so SlideMang sends them the video. A hidden worker window starts only when such a display is showing a camera/capture slide, opens the device, streams it over the local network (low delay, up to 8 Mbps), and closes 30 s after the last viewer leaves. The SlideMang display window still opens the device directly (cheapest for OBS Window Capture on the same PC). On/off: Setup Media → General. Use case: OBS on a second PC, or Browser Sources instead of Window Capture.
- **OBS Scenes**: a separate list, **OBSSCENE_LIST** (Setup Media → 🎬 OBS Scenes). Each entry is a button in the Controller's 🎬 OBS Scenes panel: button name, scene, and its own transition + duration (used for that switch only, then OBS's own transition is put back), so one scene can have several buttons. The scene on air is highlighted and follows changes made in OBS. With an empty list the panel shows every OBS scene. Scene switching lives only here (not in the Media or Background lists).
- **Background List** takes 📷 camera, 🖥 window/screen capture and 📡 OBS Source (Slide or Toggle) too, with the same on-demand behaviour and video relay as the Media List.
- **OBS Source behaviour**: *Slide* (default) — one thing at a time together with images/videos/cameras; *Toggle* — its card switches that OBS source on/off on its own, the slide does not change, and PREV/NEXT/Auto Slide skip it. A toggle source is never touched until you click it, and its card shows the real state in OBS.
- **Small windows**: layouts fixed for narrow widths, plus **🗜 Compact mode** in the Controller.
- **About**: GitHub, Donate and YouTube links (Launcher → About, Controller → ℹ️). Set them in `package.json` → `slidemang.links`.
- Electron 45, no runtime dependencies, no `eval` in the pages, write APIs protected against other websites.

## Run / build
1. Node.js 22 LTS or newer.
2. In this folder: `npm install`
3. Test: `npm start` · Unit tests: `npm test`
4. Build portable exe: `npm run dist` → `dist/SlideMang.exe` (or `npm run dist:zip`)

If `npm run dist` fails on a path with Thai characters, move the project to an English-only path.

## Folders (next to the exe, or this folder during `npm start`)
- `media/` your images/videos (sub-folders allowed)
- `data/config.json` lists and presets (Setup Media) · `data/session.json` live state · `data/controller-save.json` Controller 💾 Save / 📂 Load · `data/settings.json` Launcher and OBS-connection settings (the OBS password is stored here)
- `locales/` (optional) extra languages

## Network
Launcher → Server: allow other devices, set a password. From other devices, changing Setup Media / uploading files needs that password.
Files added from a phone/other PC are uploaded; inside the app they are copied directly.
