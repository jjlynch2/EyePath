// Remakes the pictures and the demo animation for the README and the website
// (docs/media/) from the real app: the client's code screen, the remote mid-set in
// light and dark, the Light tab, the demo (client and phone side by side), its still
// for reduced motion, and the social preview card. Run it through Electron, which
// drives the app's own pages in hidden windows:
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron --no-sandbox tools/media.js
//
// (VS Code's terminal sets ELECTRON_RUN_AS_NODE, which makes Electron act as plain
// Node, hence the env -u. --no-sandbox is for a development checkout, where Electron's
// sandbox helper isn't set up; it has to be on the command line.) Needs ffmpeg on the
// PATH for the animation. Starts the app's server on port 8765 (or the next free one)
// with throwaway settings in a temp folder, so your own presets and settings are
// untouched. The QR code and pairing code are whatever that server makes up.
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { app, BrowserWindow, nativeTheme } = require("electron");

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

const ROOT = path.join(__dirname, "..");
const MEDIA = path.join(ROOT, "docs", "media");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "eyepath-media-"));
const FRAMES = path.join(WORK, "frames");
fs.mkdirSync(FRAMES);
const { createServer } = require(path.join(ROOT, "server.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (w, h, extra = {}) => new BrowserWindow({
  width: w, height: h, show: false, useContentSize: true,
  webPreferences: { offscreen: true, partition: `media-${Date.now()}-${Math.random()}`, ...extra },
});
const save = async (win, file) => {
  fs.writeFileSync(path.join(MEDIA, file), (await win.webContents.capturePage()).toPNG());
  console.log(`  ${file}`);
};
// Run a script inside the frame of a composed page whose URL contains `part`.
const inFrame = (win, part, js) => {
  const frame = win.webContents.mainFrame.frames.find((f) => f.url.includes(part));
  if (!frame) throw new Error(`no frame for ${part}`);
  return frame.executeJavaScript(js);
};
const local = (file) => `file://${path.join(__dirname, file)}`;

app.whenReady().then(async () => {
  let server;
  try {
    server = await createServer({ dataDir: path.join(WORK, "data"), port: 8765, portTries: 5 });
    const base = `http://127.0.0.1:${server.port}`;
    console.log(`app on ${base}; writing to ${MEDIA}`);
    nativeTheme.themeSource = "light";

    // The client's code screen, before any remote connects.
    const qr = page(1280, 720);
    await qr.loadURL(`${base}/client`);
    await sleep(1800);
    await save(qr, "qr-screen.png");
    qr.destroy();

    // The demo: the client screen and the phone side by side. The QR code shows, the
    // phone connects, a set starts, and the light sweeps while the phone counts.
    const demo = page(1240, 700, { webSecurity: false });   // the pages come from the app, the layout from a file
    await demo.loadURL(`${local("media-demo.html")}?base=${encodeURIComponent(base)}`);
    await sleep(2500);
    let n = 0;
    const started = Date.now();
    const grab = async () => {
      fs.writeFileSync(path.join(FRAMES, `f${String(n++).padStart(4, "0")}.png`), (await demo.webContents.capturePage()).toPNG());
    };
    const grabFor = async (ms) => { const until = Date.now() + ms; while (Date.now() < until) { await grab(); await sleep(60); } };
    await grabFor(1200);                                            // the QR screen
    await demo.webContents.executeJavaScript("connectPhone()");      // the phone opens the remote; the light appears
    await grabFor(2200);
    await inFrame(demo, "/therapist", 'sendCommand({ type: "start" })');
    await grabFor(6500);                                            // sweeps, with the count on the phone
    const fps = n / ((Date.now() - started) / 1000);
    await save(demo, "demo-still.png");
    await inFrame(demo, "/therapist", 'sendCommand({ type: "stopNow" })');
    await sleep(600);
    demo.destroy();
    const ffmpeg = spawnSync("ffmpeg", [
      "-y", "-loglevel", "error", "-framerate", fps.toFixed(2), "-i", path.join(FRAMES, "f%04d.png"),
      "-vf", "fps=10,scale=1240:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
      path.join(MEDIA, "demo.gif"),
    ], { stdio: "inherit" });
    if (ffmpeg.status === 0) console.log(`  demo.gif (${n} frames)`);
    else console.log(`  demo.gif NOT made (ffmpeg missing or failed); the frames are in ${FRAMES}`);

    // The remote during a set, light and dark, with a client screen open so it reads "Connected".
    const client = page(1440, 900);
    await client.loadURL(`${base}/client`);
    await sleep(1000);
    for (const theme of ["light", "dark"]) {
      nativeTheme.themeSource = theme;
      const phone = page(390, 844);
      await phone.loadURL(`${base}/therapist`);
      await sleep(1500);
      await phone.webContents.executeJavaScript('sendCommand({ type: "start" })');
      await sleep(2700);
      await save(phone, theme === "light" ? "remote.png" : "remote-dark.png");
      await phone.webContents.executeJavaScript('sendCommand({ type: "stopNow" })');
      await sleep(1500);
      if (theme === "light") {
        await phone.webContents.executeJavaScript('showTab("light")');
        await sleep(500);
        await save(phone, "remote-shapes.png");
      }
      phone.destroy();
    }

    // The social preview card (1280 x 640, for links to the site), with the remote mid-set.
    nativeTheme.themeSource = "light";
    const social = page(1280, 640, { webSecurity: false });
    await social.loadURL(`${local("media-social.html")}?base=${encodeURIComponent(base)}`);
    await sleep(2000);
    await inFrame(social, "/therapist", 'sendCommand({ type: "start" })');
    await sleep(2700);
    await save(social, "social-preview.png");
    await inFrame(social, "/therapist", 'sendCommand({ type: "stopNow" })');
    await sleep(300);
    social.destroy();
    client.destroy();
    console.log("done");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  // Closing the server waits for its connections to end; don't let that keep the tool alive.
  if (server) await Promise.race([server.close(), sleep(3000)]);
  if (!process.exitCode) fs.rmSync(WORK, { recursive: true, force: true });
  app.quit();
  setTimeout(() => app.exit(process.exitCode || 0), 2000);
});
