# SlideMang (Step 1: Program Framework)

## Initial Installation
1. Install Node.js version 22 LTS or higher from https://nodejs.org (Node versions older than 22.12 will fail to install Electron).
2. Open Command Prompt in this folder (type `cmd` in the File Explorer address bar and press Enter).
3. Type `npm install` (wait about 1-3 minutes for the initial Electron download).

## Run for Testing
    npm start

You will see the Launcher window. Click the "Open" button to open the various windows.

## Build .exe File
    npm run dist

The output file will be in the `dist/` folder (portable version, no installation required).
Place the `media/` folder next to the .exe file, and the program will automatically create the `data/` folder.

## Important Folders
- `media/`  Place your images/videos here (matching the filenames in media-config.js).
- `data/`   Configuration files (media-config.js, settings.json).
- `web/`    All web pages (controller, setup-media, display-*).
- `src/server.js`  Built-in server.

## Usage with OBS
- Window Capture: Select windows named "OBS Titlebar", "OBS Slides", "OBS Background".
- Or Browser Source: Use the URL from the Launcher (Server section).

## Network Control
Check "Allow other devices on network" in the Launcher and open the Controller URL from a mobile phone or another device.
It is recommended to set a password (the first time, open with `?token=password`, which the Launcher provides a link for).

## Troubleshooting
- Windows Firewall prompt: Click allow if you want other devices to access it.
- Port in use: The program will automatically try the next available port, or you can change the port in the Launcher.
- Press F12 in any window to view errors (you can send a message to ask for help).
- Electron installation failure (ERR_REQUIRE_ESM): Update Node to 22 LTS, delete `node_modules` and `package-lock.json`, then run `npm install` again.
- If the folder path contains Thai characters and causes issues with `npm run dist`, please move it to an English character path.