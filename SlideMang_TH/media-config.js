var MEDIA_BASE = "./media/";
var MEDIA_CHANNEL = "obs_control";
var MEDIA_START_VISIBLE = true;
var BG_START_VISIBLE = true;

var MEDIA_BGS = ["media_bg1.jpg","media_bg2.jpg","media_bg3.jpg"];
var BG_BGS = ["bg_bg1.png","bg_bg2.png","bg_bg3.png"];

var MEDIA_LIST = [
    {
        "file": "01.jpg",
        "desc": "คำถามที่ 1"
    },
    {
        "file": "02.jpg",
        "desc": "คำถามที่ 2",
        "type": "image",
        "fit": "contain"
    },
    {
        "file": "03.mp4",
        "desc": "Intro",
        "thumb": "03.mp4_snapshot_00.01.344.jpg"
    },
    {
        "file": "04.mp4",
        "desc": "Show Promote",
        "thumb": "04.mp4_snapshot_00.14.721.jpg"
    },
    {
        "file": "05.gif",
        "desc": "Cute gif animation",
        "thumb": "05.png"
    }
];

var BACKGROUND_LIST = [
    {
        "file": "RoomEmptyRain.mp4_snapshot_00.00.980.jpg",
        "desc": "Raining Room",
        "thumb": "RoomEmptyRain.mp4_snapshot_00.00.980.jpg"
    },
    {
        "file": "RoomNeonPurple.mp4_snapshot_00.00.490.jpg",
        "desc": "Neon Room"
    },
    {
        "file": "RoomWindowStarlight.mp4_snapshot_00.00.300.jpg",
        "desc": "Starlight Room"
    },
    {
        "file": "03.mp4",
        "desc": "05",
        "thumb": "04.mp4_snapshot_00.14.721.jpg"
    }
];

var MEDIA_TITLEBARS = [
    {
        "name": "แนะนำรายการ",
        "header": "",
        "body": "ยินดีต้อนเข้าสู่ไลฟ์สตีมกะละมังดิจิตอลบาร์",
        "preset": "p2",
        "hAlign": "center",
        "edgeDist": 5,
        "bottomDist": 10,
        "showHeader": true,
        "align": "center",
        "widthType": "auto",
        "customWidth": 80
    },
    {
        "name": "แนะนำตัว",
        "header": "",
        "body": "<div><b>ผู้ดำเนินรายการ</b>\nกะละมัง วีทูปเบอร์</div>",
        "preset": "p2",
        "hAlign": "center",
        "edgeDist": 5,
        "bottomDist": 5,
        "showHeader": true,
        "align": "center",
        "widthType": "percent",
        "customWidth": 50
    },
    {
        "name": "พูดคุยเรื่องที่ 1",
        "header": "หัวข้อ",
        "body": "ป้องกันตัวจากอันตรายในสังคม",
        "preset": "p3",
        "hAlign": "right",
        "edgeDist": 5,
        "bottomDist": 5,
        "showHeader": true,
        "align": "left",
        "widthType": "percent",
        "customWidth": 80
    },
    {
        "name": "พูดคุยเรื่องที่ 2",
        "header": "<div style=\"font-size: 70px;\">หัวข้อ</div>",
        "body": "<div style=\"font-size: 70px;\">รู้เท่าทันการไถเงินของวีทูป</div>",
        "preset": "p1",
        "hAlign": "left",
        "edgeDist": 5,
        "bottomDist": 5,
        "showHeader": true,
        "align": "left",
        "widthType": "percent",
        "customWidth": 80
    }
];
