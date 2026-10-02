const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Remove the default window menu bar completely
Menu.setApplicationMenu(null);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Alternatively, hide menu on this specific window:
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build/icon.png'),
  });
  // Load built dist folder in production, or localhost in dev
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  } else {
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools(); // dev only — not shipped to installed users
  }
}

app.whenReady().then(createWindow);