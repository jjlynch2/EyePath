// Remakes the pictures and the demo animation for the README and the website
// (docs/media/) from the real app: the demo (client and phone side by side), the remote
// mid-set in light and dark for the README, the social preview card, and the website's
// product images (web-*.png). Run it through Electron, which
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
const page = (w, h, extra = {}, winOpts = {}) => {
  const win = new BrowserWindow({
    width: w, height: h, show: false, useContentSize: true, ...winOpts,
    webPreferences: { offscreen: true, partition: `media-${Date.now()}-${Math.random()}`, ...extra },
  });
  // Phones overlay their scrollbars; a desktop-style one here would steal width and wrap rows.
  win.webContents.on("dom-ready", () => {
    win.webContents.insertCSS("html, body, * { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }");
    for (const f of win.webContents.mainFrame.framesInSubtree) {
      f.executeJavaScript(`(() => { const s = document.createElement("style"); s.textContent = "html, body, * { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }"; document.head.append(s); })()`).catch(() => {});
    }
  });
  win.webContents.on("did-frame-finish-load", () => {
    for (const f of win.webContents.mainFrame.framesInSubtree) {
      f.executeJavaScript(`(() => { if (document.getElementById("no-scrollbars")) return; const s = document.createElement("style"); s.id = "no-scrollbars"; s.textContent = "html, body, * { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }"; document.head.append(s); })()`).catch(() => {});
    }
  });
  return win;
};
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

    // ---- Product images for the website (docs/media/web-*.png). Each one reproduces the
    // framing, size and app state of the matching export in the design hand-off
    // (design/website/assets/images/*@2x.png), captured from the real app at 2x. A fresh copy
    // of the app, so the set numbers and counts come out the same every run.
    const app2 = await createServer({ dataDir: path.join(WORK, "data2"), port: 8765, portTries: 5 });
    const base2 = `http://127.0.0.1:${app2.port}`;
    const until = async (check, ms = 40000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await check()) return; await sleep(40); }
      throw new Error("timed out waiting for the app");
    };
    const frameShot = async (file, spec, { theme = "light", setup, settle = 300 } = {}) => {
      nativeTheme.themeSource = theme;
      const shot = page(spec.w * 2, spec.h * 2, { zoomFactor: 2, webSecurity: false }, { transparent: true, backgroundColor: "#00000000" });
      await shot.loadURL(`${local("media-frame.html")}?spec=${encodeURIComponent(JSON.stringify(spec))}`);
      shot.setContentSize(spec.w * 2, spec.h * 2);   // a window made taller than the screen is clamped; resizing it afterwards isn't
      await sleep(2200);
      if (setup) await setup(shot);
      await sleep(settle);
      await save(shot, file);
      shot.destroy();
    };
    const phone = (src, x, y, scale, extra = {}) => ({ src: base2 + src, vw: 390, vh: 844, scale, x, y, ...extra });

    // Step 1: the left of the pairing screen at half size, before any phone connects.
    await frameShot("web-step-1.png", {
      w: 379, h: 264, radius: 16, bg: "#0c1315",
      layers: [{ src: `${base2}/client#step1`, vw: 1440, vh: 900, scale: 0.5, x: 0, y: 0 }],
    }, { theme: "dark", setup: async (shot) => {
      const r = await inFrame(shot, "#step1", 'JSON.parse(JSON.stringify(document.querySelector(".client-hero").getBoundingClientRect()))');
      await shot.webContents.executeJavaScript(`place(0, ${20 - r.left * 0.5}, ${35 - r.top * 0.5})`);
    } });
    // Step 2: the connect page with the same code typed in, on a grey card.
    await frameShot("web-step-2.png", {
      w: 379, h: 264, radius: 16, bg: "#edf1f2",
      layers: [phone("/login#step2", 67.5, 33, 0.596, { corners: "24px 24px 0 0", border: "#e2e7e9", shadow: "0 2px 6px #0f1b1d0f, 0 12px 32px #0f1b1d1f" })],
    }, { setup: (shot) => inFrame(shot, "#step2", `const i = document.getElementById("codeInput"); i.value = ${JSON.stringify(app2.auth.pairCode)}; i.dispatchEvent(new Event("input")); i.blur()`) });

    // A client screen, so the remote reads "Connected", and a remote to run the sets from.
    const client2 = page(1440, 900);
    await client2.loadURL(`${base2}/client`);
    const ctrl = page(390, 844);
    await ctrl.loadURL(`${base2}/therapist`);
    await sleep(1500);
    const status = () => ctrl.webContents.executeJavaScript("state ? state.run.status : ''");
    // Set 1, stopped early; set 2, run to the end (24 of 24, "Set complete", "Set 2 done").
    await ctrl.webContents.executeJavaScript('sendCommand({ type: "start" })');
    await until(async () => (await status()) === "running");
    await sleep(1000);
    await ctrl.webContents.executeJavaScript('sendCommand({ type: "stopNow" })');
    await until(async () => (await status()) === "idle");
    await sleep(800);
    await ctrl.webContents.executeJavaScript('sendCommand({ type: "start" })');
    await until(async () => (await status()) === "running");
    await until(async () => (await status()) === "idle");
    await sleep(1500);

    // "Your phone is the remote": the Presets sheet behind, the Session tab in front.
    const openSheet = (shot) => inFrame(shot, "#back", 'document.querySelector("#presetBar").click()');
    const shadow = "0 2px 6px #0f1b1d0f, 0 12px 32px #0f1b1d1f";
    await frameShot("web-remote-panel.png", {
      w: 580, h: 680, radius: 20, bg: "#e3f1ef",
      layers: [phone("/therapist#back", 65, 93, 0.6575, { radius: 26, border: "#e2e7e9", shadow }),
               phone("/therapist#front", 302, 48.5, 0.7345, { radius: 30, border: "#e2e7e9", shadow })],
    }, { setup: openSheet });
    await frameShot("web-remote-panel-mobile.png", {
      w: 350, h: 536, radius: 20, bg: "#e3f1ef",
      layers: [phone("/therapist#back", 25, 65, 0.485, { radius: 20, border: "#e2e7e9", shadow }),
               phone("/therapist#front", 130, 33, 0.556, { radius: 24, border: "#e2e7e9", shadow })],
    }, { setup: openSheet });

    // The three setup tabs: 304.5 x 620, the phone 390 x 794 inside.
    for (const tab of ["light", "motion", "sound"]) {
      await frameShot(`web-tab-${tab}.png`, {
        w: 305, h: 620, layers: [{ src: `${base2}/therapist#tab`, vw: 390, vh: 793, scale: 0.782, x: 0, y: 0, radius: 36, border: "#e2e7e9" }],
      }, { setup: (shot) => inFrame(shot, "#tab", `showTab("${tab}");
        // As in the design, the page stops at the floating tab bar: a band of the page colour
        // behind the bar (below it in the stacking order, so its rounded corners and shadow stay),
        // instead of the next settings scrolling past underneath.
        const band = document.createElement("style");
        band.textContent = "body::after { content: ''; position: fixed; left: 0; right: 0; bottom: 0; height: 52px; background: var(--bg); z-index: 5; pointer-events: none; }";
        document.head.append(band);`) });
    }

    // The hero: the dark remote during set 3, at pass 11 of 24.
    await frameShot("web-hero-remote.png", {
      w: 336, h: 727, layers: [{ src: `${base2}/therapist#hero`, vw: 390, vh: 844, scale: 0.8615, x: 0, y: 0, radius: 34, border: "#253338" }],
    }, { theme: "dark", setup: async (shot) => {
      await ctrl.webContents.executeJavaScript('sendCommand({ type: "start" })');
      await until(() => inFrame(shot, "#hero", 'document.getElementById("count").textContent === "11"'));
    }, settle: 0 });   // pass 11 lasts half a second at 1 Hz
    await ctrl.webContents.executeJavaScript('sendCommand({ type: "stopNow" })');
    await sleep(800);
    ctrl.destroy();
    client2.destroy();
    await Promise.race([app2.close(), sleep(3000)]);
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
