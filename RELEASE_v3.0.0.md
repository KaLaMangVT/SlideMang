# SlideMang v3.0.0 🎉

> **Tag:** `v3.0.0` · **Release title:** `SlideMang v3.0.0 — One app, every language`

อัปเดตใหญ่ที่สุดตั้งแต่ทำมา! รวมทุกภาษาไว้ในโปรแกรมเดียว เป็น Portable เต็มตัว และเชื่อมกับ OBS ได้โดยตรง
The biggest update yet! Every language in one program, fully portable, and direct OBS integration.

📺 วิธีใช้ / Tutorial: https://youtube.com/live/rJrsDisMuC0
📖 คู่มือเต็ม / Full guide: [README (English)](https://github.com/KaLaMangVT/SlideMang/blob/HEAD/README.md) · [README (ไทย)](https://github.com/KaLaMangVT/SlideMang/blob/HEAD/README.th.md)

---

## 📥 ดาวน์โหลด / Download

| ไฟล์ / File | คำอธิบาย / Description |
|---|---|
| **`SlideMang.exe`** | Windows portable — โหลดไฟล์เดียว ใช้ได้ทุกภาษา / single file, every language |

1. วาง `SlideMang.exe` ในโฟลเดอร์ว่าง เช่น `D:\SlideMang\` / Put it in an empty folder, e.g. `D:\SlideMang\`
2. ดับเบิลคลิก โปรแกรมจะสร้าง `data/` และ `media/` ให้เอง / Double-click — `data/` and `media/` are created next to it
3. เลือกภาษาที่ Launcher / Pick your language in the Launcher

> Windows อาจขึ้น SmartScreen เพราะโปรแกรมไม่ได้ลงนามดิจิทัล กด **More info → Run anyway**
> Windows may show SmartScreen because the app is not signed. Click **More info → Run anyway**.

---

## 🇹🇭 มีอะไรใหม่

### 🌐 โปรแกรมเดียว เลือกภาษาได้
- English (ค่าเริ่มต้น) และไทยอยู่ใน `.exe` ตัวเดียว ไม่ต้องแยกโหลดตัว EN / TH อีกต่อไป
- เปลี่ยนภาษาได้จาก Launcher, แถบเมนู Controller หรือหน้า Setup Media
- เพิ่มภาษาเองได้: ก๊อป `locales/th.json` เป็น `locales/<รหัสภาษา>.json` แปลค่า แล้ววางโฟลเดอร์ `locales` ไว้ข้าง `SlideMang.exe` ไม่ต้อง build ใหม่

### 📦 Portable เต็มตัว
- `data/` และ `media/` อยู่ข้าง `SlideMang.exe` ก๊อปทั้งโฟลเดอร์ไปเครื่องอื่นได้ทันที พร้อมไฟล์และการตั้งค่า

### 🛠 Setup Media ใช้ง่ายขึ้นมาก
- เปิดแล้วโหลดค่าปัจจุบันเอง กด **💾 บันทึก** (หรือ `Ctrl+S`) เขียนทับ `data/config.json` ทันที (เก็บสำรอง `.bak` ไว้ 1 ชุด) — **ไม่ต้องเลือกไฟล์มาบันทึกทับอีกแล้ว**
- ปุ่ม 📁 ข้างช่องไฟล์ **ก๊อปไฟล์เข้า `media/` ให้เอง** (หรือโฟลเดอร์ย่อยที่เลือก)
- **ลากไฟล์มาวาง** ที่รายการ Media / Background → ก๊อปเข้า `media/` และสร้างรายการให้อัตโนมัติ
- **📥 เพิ่มไฟล์…** เพิ่มหลายไฟล์พร้อมกัน และ **+ สร้างโฟลเดอร์** สำหรับแยกหัวข้อ
- เช็คพื้นที่ดิสก์ก่อนก๊อป ไฟล์ซ้ำไม่ก๊อปซ้ำ ชื่อซ้ำแต่คนละไฟล์ตั้งเป็น `name (2).ext`
- ไฟล์ที่ไม่มีใน `media/` จะขึ้นเครื่องหมาย ⚠
- **↺ รีเซ็ตค่าเริ่มต้น** โหลดตัวอย่างหัวข้อละ 1 รายการ (มีรูปตัวอย่างให้)
- ลากเลือกข้อความในช่องพิมพ์จะไม่ไปย้ายลำดับรายการแล้ว (ย้ายได้เฉพาะจับที่ ⠿)
- เพิ่มหน้า **🎬 OBS Scenes** เป็นหน้าที่ 5

### 🔄 ทุกหน้าจอตรงกัน
- กดบันทึกใน Setup Media แล้ว Controller และจอ OBS **อัปเดตทันที** ไม่ต้องปิดเปิดหน้าต่างใหม่
- ปุ่ม **🔄 รีเฟรช OBS** (ใน Launcher และ Controller) รีโหลด OBS Titlebar / Slides / Background ทั้งหน้าต่างในแอปและ Browser Source ใน OBS
- Controller ทุกหน้าที่เปิด (แอป เบราว์เซอร์ มือถือ) ใช้สถานะเดียวกัน
- **Auto Slide นับเวลาที่ตัวโปรแกรมที่เดียว** เปิด Controller หลายหน้าก็ไม่เปลี่ยนเร็วขึ้น และยังทำงานแม้ปิด Controller
- สถานะบันทึกอัตโนมัติที่ `data/session.json` (ปุ่ม 📁/💾 ใน Controller กลายเป็นนำเข้า/ส่งออก)
- การเปิด/ปิดกลุ่ม panel จำแยกตามเครื่อง

### 📷 สไลด์กล้อง และ 🖥 จับภาพหน้าต่าง / หน้าจอ
- เพิ่มได้จาก **📷 เพิ่มกล้อง** / **🖥 เพิ่มจับภาพหน้าจอ** ในรายการ Media และ Background
- เปิดอุปกรณ์ **เฉพาะตอนที่สไลด์นั้นออนแอร์** แล้วปิดทันทีเมื่อเลิกใช้ คนที่ใช้แค่ภาพ/วิดีโอไม่เสียทรัพยากรเพิ่ม
- กล้อง: เลือกจากชื่อ ความละเอียด (สูงสุด 4K) FPS กลับด้าน
- จับภาพ: เลือกหน้าต่างจากภาพตัวอย่าง (จับคู่จากชื่อหน้าต่าง) หรือทั้งหน้าจอ
- ตัดขอบเป็น % และ **พื้นหลังโปร่งใส** (ส่วนสีดำ → โปร่งใส / คีย์สี เช่น กรีนสกรีน)
- ระหว่างออนแอร์ Controller มีแผงปรับสด เปลี่ยนกล้อง/หน้าต่าง กลับด้าน การขยาย ตัดขอบ และ **💾 บันทึกลง Setup**

### 📶 ส่งภาพสดต่อ (WebRTC)
- Browser Source ของ OBS และจอที่เปิดผ่านเครือข่ายใช้สไลด์กล้อง/จับภาพได้แล้ว SlideMang ส่งวิดีโอไปให้ผ่าน LAN (หน่วงต่ำ สูงสุด 8 Mbps)
- ทำงานเบื้องหลังเฉพาะตอนมีคนดู และปิดตัวเอง 30 วินาทีหลังไม่มีคนดู
- เหมาะกับ OBS อีกเครื่อง หรือคนที่ใช้ Browser Source แทน Window Capture · เปิด/ปิดได้ที่ Setup Media → ทั่วไป

### 📡 สไลด์แบบ OBS Source (ผ่าน obs-websocket)
- การจับภาพยังอยู่ใน OBS ตามเดิม SlideMang เปิด source ที่เลือกขณะที่สไลด์นั้นแสดง และปิดเมื่อเปลี่ยนสไลด์หรือซ่อน Media
- 2 แบบ: **สไลด์** (แสดงทีละอย่าง) และ **Toggle** (กดการ์ดเพื่อเปิด/ปิด source แยกอิสระ PREV/NEXT/Auto Slide จะข้ามไป)
- source ที่ SlideMang ไม่ได้ใช้จะไม่ถูกแตะ · ใช้ได้กับ OBS 28 ขึ้นไป

### 🎬 OBS Scenes
- รายการปุ่มเปลี่ยน Scene แยกของตัวเอง (Setup Media → 🎬 OBS Scenes)
- แต่ละปุ่มมี Transition + ระยะเวลาของตัวเอง (ใช้เฉพาะตอนกด แล้วคืนค่าเดิมของ OBS) Scene เดียวมีได้หลายปุ่ม
- ปุ่มที่ออนแอร์ไฮไลต์และตามการเปลี่ยนจากใน OBS พร้อมภาพตัวอย่างสดจาก OBS
- ถ้าไม่มีรายการ แผงจะแสดงทุก Scene ใน OBS

### 🗜 อื่นๆ
- แก้การแสดงผลตอนหน้าต่างเล็ก และเพิ่ม **🗜 โหมดกะทัดรัด** ใน Controller
- หน้า **เกี่ยวกับ** มีลิงก์ GitHub, Donate และ YouTube (Launcher → เกี่ยวกับ, Controller → ℹ️)
- Electron 45, ไม่มี dependency ตอนรัน, ไม่ใช้ `eval` ในหน้าเว็บ, API ที่แก้ไขข้อมูลกันเว็บอื่นเรียกใช้ และการแก้ Setup / อัปโหลดไฟล์จากเครื่องอื่นต้องใช้รหัส

---

## 🇬🇧 What's New

### 🌐 One program, every language
- English (default) and Thai in a single `.exe` — no more separate EN / TH builds.
- Switch from the Launcher, the Controller menu bar or Setup Media.
- Add a language: copy `locales/th.json` to `locales/<code>.json`, translate the values, and place the `locales` folder next to `SlideMang.exe`. No rebuild needed.

### 📦 Fully portable
- `data/` and `media/` live next to `SlideMang.exe`. Copy the whole folder to another PC and everything comes with it.

### 🛠 Much easier Setup Media
- Opens with the current settings; **💾 Save** (or `Ctrl+S`) writes `data/config.json` directly (a `.bak` copy is kept) — **no more picking a file to overwrite**.
- 📁 next to any file field **copies the chosen file into `media/`** (or a chosen sub-folder).
- **Drag & drop** files onto Media / Background List → copied into `media/` with a row for each.
- **📥 Add files…** for several files at once, **+ New folder** for topic sub-folders.
- Disk space checked before copying; identical files are not copied twice; same name, different file → `name (2).ext`.
- Files missing from `media/` are marked ⚠.
- **↺ Reset to Default** loads an example with one item in every list (sample images included).
- Selecting/dragging text inside a field no longer moves the row (only the ⠿ handle drags).
- New 5th page: **🎬 OBS Scenes**.

### 🔄 Everything stays in sync
- Saving Setup Media updates every Controller and OBS display **immediately** — no more reopening windows.
- **🔄 Refresh OBS** (Launcher and Controller) reloads OBS Titlebar / Slides / Background — app windows *and* OBS Browser Sources.
- All open Controllers (app, browser, phone) share one live state.
- **Auto Slide runs once, inside the app** — no double-stepping with two Controllers, and it keeps running with no Controller open.
- State is saved automatically to `data/session.json` (📁/💾 in the Controller are now import/export).
- Panel-group visibility is remembered per device.

### 📷 Camera and 🖥 window / screen capture slides
- Add them with **📷 Add Camera** / **🖥 Add Capture** in the Media and Background lists.
- The device is opened **only while that slide is on air** and released right after — image/video-only setups use no extra resources.
- Camera: pick by name, resolution (up to 4K), FPS, mirror.
- Capture: pick a window from thumbnails (matched by title) or a whole screen.
- Crop edges in %, plus **transparent background** (black parts → transparent / color key, e.g. green screen).
- While on air, the Controller shows a live panel to switch camera/window, mirror, fit and crop, with **💾 Save to Setup**.

### 📶 Live video relay (WebRTC)
- OBS Browser Sources and network displays can now show camera/capture slides — SlideMang streams the video over the LAN (low delay, up to 8 Mbps).
- Runs in the background only while someone is watching, and closes 30 s after the last viewer leaves.
- For OBS on a second PC, or Browser Sources instead of Window Capture. On/off: Setup Media → General.

### 📡 OBS Source slides (via obs-websocket)
- The capture stays in OBS; SlideMang turns the chosen source on while its slide shows and off when the slide changes or Media is hidden.
- Two behaviours: **Slide** (one thing at a time) and **Toggle** (its card switches the source on/off on its own; PREV/NEXT/Auto Slide skip it).
- Sources SlideMang does not use are never touched. Requires OBS 28+.

### 🎬 OBS Scenes
- A separate list of scene buttons (Setup Media → 🎬 OBS Scenes).
- Each button has its own transition + duration (used for that switch only, then OBS's own is put back); one scene can have several buttons.
- The scene on air is highlighted and follows changes made in OBS, with live previews from OBS.
- With an empty list the panel shows every OBS scene.

### 🗜 Other
- Layouts fixed for narrow windows, plus **🗜 Compact mode** in the Controller.
- **About** with GitHub, Donate and YouTube links (Launcher → About, Controller → ℹ️).
- Electron 45, no runtime dependencies, no `eval` in the pages, write APIs protected against other websites, and changing Setup / uploading files from other devices needs the password.

---

## ⚠️ อัปเกรดจาก v2 / Upgrading from v2

**ไทย**
- v3 ใช้ไฟล์ข้อมูลชุดใหม่ (`data/config.json`, `data/session.json`) แทน `media-config.js` และ `save.json` ของ v2
- แนะนำให้วาง v3 ใน **โฟลเดอร์ใหม่** ก๊อปโฟลเดอร์ `media` เดิมมาไว้ข้างกัน แล้วตั้งรายการใน Setup Media ใหม่ (ลากไฟล์มาวางได้เลย เร็วมาก)
- เวอร์ชันเก่า (v2) ยังอยู่ใน repo ที่โฟลเดอร์ `APP/` และ `WEB/` และในหน้า Releases ก่อนหน้า

**English**
- v3 uses new data files (`data/config.json`, `data/session.json`) instead of v2's `media-config.js` and `save.json`.
- Put v3 in a **new folder**, copy your old `media` folder next to it, and set up your lists again in Setup Media (drag & drop makes it quick).
- The old version (v2) stays in the repo under `APP/` and `WEB/`, and on the previous Releases.

---

## 🛠 Build from source

```bash
cd V3
npm install      # Node.js 22 LTS+
npm start        # run
npm test         # unit tests
npm run dist     # → dist/SlideMang.exe
```

---

## 💖 Support

ถ้าชอบ ฝากกดติดตามและสนับสนุนกันด้วยนะ / If you like it, consider supporting:
▶️ [YouTube](https://www.youtube.com/@KaLaMangVT) · ☕ [SocialBuzz](https://sociabuzz.com/kalamangvt/donate) · 💳 [Ko-fi](https://ko-fi.com/kalamangvt) · 🧧 [EasyDonate](https://ezdn.app/kalamangvt)

**Full Changelog:** https://github.com/KaLaMangVT/SlideMang/commits/v3.0.0
