# SlideMang (ขั้นที่ 1: โครงโปรแกรม)

## ติดตั้งครั้งแรก
1. ติดตั้ง Node.js เวอร์ชัน 22 LTS ขึ้นไป จาก https://nodejs.org (Node เก่ากว่า 22.12 จะติดตั้ง Electron ไม่ผ่าน)
2. เปิด Command Prompt ในโฟลเดอร์นี้ (พิมพ์ `cmd` ที่ช่อง address ของ File Explorer แล้วกด Enter)
3. พิมพ์  `npm install`  (รอดาวน์โหลด Electron ครั้งแรกประมาณ 1-3 นาที)

## รันเพื่อทดสอบ
    npm start

จะเห็นหน้าต่าง Launcher กดปุ่ม "เปิด" เพื่อเรียกหน้าต่างต่างๆ

## สร้างไฟล์ .exe
    npm run dist

ได้ไฟล์ในโฟลเดอร์ `dist/` (แบบ portable ไม่ต้องติดตั้ง)
ให้วางโฟลเดอร์ `media/` ไว้ข้างไฟล์ .exe โปรแกรมจะสร้างโฟลเดอร์ `data/` ให้เอง

## โฟลเดอร์สำคัญ
- `media/`  วางรูป/วิดีโอที่ใช้ (ตามชื่อไฟล์ใน media-config.js)
- `data/`   ไฟล์ตั้งค่า (media-config.js, settings.json)
- `web/`    หน้าเว็บทั้งหมด (controller, setup-media, display-*)
- `src/server.js`  เซิร์ฟเวอร์ในตัว

## ใช้กับ OBS
- Window Capture: เลือกหน้าต่างชื่อ "OBS Titlebar", "OBS Slides", "OBS Background"
- หรือ Browser Source: ใส่ URL จากหน้า Launcher (ส่วนเซิร์ฟเวอร์)

## สั่งผ่านเครือข่าย
ติ๊ก "อนุญาตเครื่องอื่นในเครือข่าย" ใน Launcher แล้วเปิด URL ของ Controller จากมือถือ/เครื่องอื่น
ควรตั้งรหัส (ครั้งแรกเปิดด้วย `?token=รหัส` ซึ่ง Launcher สร้างลิงก์ให้แล้ว)

## ปัญหาที่พบบ่อย
- Windows ถามเรื่อง Firewall: กดอนุญาตถ้าต้องการให้เครื่องอื่นเข้าถึง
- พอร์ตถูกใช้อยู่: โปรแกรมจะลองพอร์ตถัดไปให้เอง หรือเปลี่ยนพอร์ตใน Launcher
- กด F12 ในหน้าต่างใดๆ เพื่อดู error (ส่งข้อความมาถามได้)

- ติดตั้ง Electron ไม่ผ่าน (ERR_REQUIRE_ESM): อัปเดต Node เป็น 22 LTS แล้วลบ node_modules กับ package-lock.json แล้ว npm install ใหม่
- ถ้า path โฟลเดอร์มีภาษาไทยแล้ว npm run dist มีปัญหา ให้ย้ายไปไว้ path ภาษาอังกฤษ
