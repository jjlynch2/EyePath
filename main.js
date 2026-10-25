// EyePath desktop app (Electron).
//
// Starts the server and opens the client screen full screen. Until the
// therapist's phone connects, that screen shows the QR code and typed code;
// then it becomes the light bar. Closing the window quits the app.
"use strict";

const path = require("path");
const { app, BrowserWindow, powerSaveBlocker, screen, shell } = require("electron");
const { createServer } = require("./server");

// Sound may start without a click on the screen.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// One copy at a time; opening the app again just brings the screen back.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let lightWindow = null;
  let server = null;

  // Installed: the user's app data folder. From source (npm start): the project's data/ folder.
  const dataDir = process.env.EYEPATH_DATA_DIR ||
    (app.isPackaged ? app.getPath("userData") : path.join(__dirname, "data"));

  // ---- screens: which display the light is on
  // Screens in the order they sit on the desk (left to right), numbered from 1.
  function orderedDisplays() {
    return screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  }

  function displayName(d, i) {
    const name = d.label || (d.internal ? "Built-in screen" : "Screen");
    return `${i + 1} · ${name} · ${d.size.width}×${d.size.height}`;
  }

  // The connected screens, for the remote's "Show on" choice. Worked out once and
  // refreshed when screens or the window change, not on every update.
  let displaysCache = null;
  function displaysInfo() {
    if (!displaysCache) {
      const current = lightWindow ? screen.getDisplayMatching(lightWindow.getBounds()).id : null;
      displaysCache = orderedDisplays().map((d, i) => ({ id: String(d.id), name: displayName(d, i), current: d.id === current }));
    }
    return displaysCache;
  }

  function refreshDisplays() {
    displaysCache = null;
    if (server) server.session.changed();   // the remote updates straight away
  }

  // The screen chosen last time if it's connected, otherwise the main one.
  function startingDisplay() {
    const saved = server.laptop.prefs.display;
    const all = screen.getAllDisplays();
    return (saved && (all.find((d) => String(d.id) === saved.id) || all.find((d) => saved.label && d.label === saved.label))) ||
      screen.getPrimaryDisplay();
  }

  // Move the light to another screen by opening a fresh full-screen window there,
  // showing it once it has loaded, then closing the old one. (Moving an open
  // full-screen window between screens isn't reliable everywhere; opening one on a
  // given screen is.) The set carries on: the motion comes from the shared clock.
  let moving = false;
  function moveToDisplay(d) {
    if (!lightWindow || moving) return;
    moving = true;
    server.laptop.prefs.display = { id: String(d.id), label: d.label || "" };
    server.laptop.savePrefs();
    const old = lightWindow;
    const fresh = createLightWindow(d, { show: false });
    fresh.webContents.setAudioMuted(true);      // silent until it takes over, so no sound plays twice
    lightWindow = fresh;
    let swapped = false;
    const swap = () => {
      if (swapped) return;
      swapped = true;
      moving = false;
      if (fresh.isDestroyed()) return;
      if (!old.isDestroyed()) old.webContents.setAudioMuted(true);
      fresh.webContents.setAudioMuted(false);
      fresh.show();
      fresh.focus();
      if (!old.isDestroyed()) old.destroy();   // its "closed" handler sees it was replaced and doesn't quit
      refreshDisplays();
    };
    fresh.once("ready-to-show", swap);
    setTimeout(swap, 3000);                     // in case "ready" never comes
  }

  function chooseDisplay(id) {
    const all = orderedDisplays();
    if (all.length < 2 || !lightWindow) return;
    const current = screen.getDisplayMatching(lightWindow.getBounds()).id;
    const d = id === "next"
      ? all[(all.findIndex((x) => x.id === current) + 1) % all.length]
      : all.find((x) => String(x.id) === id);
    if (d && d.id !== current) moveToDisplay(d);   // already on that screen: nothing to do
  }

  function createLightWindow(display, { show = true } = {}) {
    const { x, y, width, height } = display.bounds;
    const win = new BrowserWindow({
      x, y, width, height,
      show,
      fullscreen: true,
      backgroundColor: "#000000",
      autoHideMenuBar: true,
      title: "EyePath",
      icon: path.join(__dirname, "static", "icon-512.png"),   // window/taskbar icon on Windows and Linux
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.loadURL(`http://127.0.0.1:${server.port}/client`);

    // F switches full screen on and off (the page can't leave window full screen itself).
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key.toLowerCase() === "f" && !input.control && !input.meta && !input.alt) {
        event.preventDefault();
        win.setFullScreen(!win.isFullScreen());
      }
    });

    // "Control it from this computer instead" opens the remote in its own window;
    // anything outside the app opens in the normal browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(`http://127.0.0.1:${server.port}/`)) {
        return {
          action: "allow",
          // Keep the remote open when its opener closes: moving the light to another
          // screen replaces the light window, and the remote must survive that.
          outlivesOpener: true,
          overrideBrowserWindowOptions: {
            width: 480, height: 900, autoHideMenuBar: true, title: "EyePath remote",
            icon: path.join(__dirname, "static", "icon-512.png"),   // window and taskbar icon (Windows, Linux)
          },
        };
      }
      shell.openExternal(url);
      return { action: "deny" };
    });
    // Closing the light quits the app (unless it was just replaced by a window on another screen).
    win.on("closed", () => {
      if (win !== lightWindow) return;
      lightWindow = null;
      app.quit();
    });
    // Keep the remote's "Show on" in step with where the window is.
    for (const ev of ["enter-full-screen", "leave-full-screen"]) {
      win.on(ev, () => { if (win === lightWindow) refreshDisplays(); });
    }
    // Dragging the window (after F) sends many "move" events ("moved" doesn't exist
    // on Linux): only update the remote when it ends up on a different screen.
    let shownOn = display.id;
    win.on("move", () => {
      if (win !== lightWindow) return;
      const id = screen.getDisplayMatching(win.getBounds()).id;
      if (id !== shownOn) { shownOn = id; refreshDisplays(); }
    });
    return win;
  }

  function openLightWindow() {
    if (lightWindow) {
      if (lightWindow.isMinimized()) lightWindow.restore();
      lightWindow.show();
      lightWindow.focus();
      return;
    }
    lightWindow = createLightWindow(startingDisplay());
  }

  // Ctrl+Q (Cmd+Q on a Mac) quits from any of the app's windows.
  app.on("browser-window-created", (_e, win) => {
    win.webContents.on("before-input-event", (event, input) => {
      const mod = process.platform === "darwin" ? input.meta : input.control;
      if (input.type === "keyDown" && mod && input.key.toLowerCase() === "q") {
        event.preventDefault();
        app.quit();
      }
    });
  });

  app.on("second-instance", () => { if (server) openLightWindow(); });
  app.on("activate", () => { if (server) openLightWindow(); });   // Dock icon clicked (Mac)

  app.whenReady().then(async () => {
    try {
      server = await createServer({ dataDir, port: Number(process.env.EYEPATH_PORT) || 8765, portTries: 20 });
    } catch (err) {
      const { dialog } = require("electron");
      dialog.showErrorBox("EyePath", `Could not start: ${err.message}`);
      app.quit();
      return;
    }
    server.laptop.onQuit = () => app.quit();          // Quit button on the remote
    server.laptop.getDisplays = displaysInfo;
    server.laptop.onChooseDisplay = chooseDisplay;
    for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) {
      screen.on(ev, refreshDisplays);   // plugging in a screen updates the remote straight away
    }
    powerSaveBlocker.start("prevent-display-sleep");  // nobody touches the laptop during a session
    openLightWindow();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => { if (server) server.close(); });
}
