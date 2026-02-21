const { app, BrowserWindow } = require('electron');
app.setName('Djvu Reader');

const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { getConfig } = require('./config');

let backendProc = null;
let mainWindow = null;
let quitting = false;

const cfg = getConfig();
const DEV_URL = cfg.devUrl;
const API_HEALTH_URL = cfg.backend.healthUrl;
const PROD_START_URL = cfg.backend.startUrl;
const START_BACKEND_IN_DEV = process.env.START_BACKEND_IN_DEV === '1';
const OPEN_DEVTOOLS = DEV_URL || process.env.OPEN_DEVTOOLS === '1';

// --- single instance ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    console.log('[MAIN] Another instance already running, quit');
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

function getBackendEntry() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'node', 'src', 'app.js');
    }

    return path.join(__dirname, '..', 'node', 'src', 'app.js');
}

function startBackend() {
    if (backendProc || DEV_URL) return;

    const backendEntry = getBackendEntry();
    console.log('[backend] entry:', backendEntry);

    backendProc = spawn(process.execPath, [backendEntry], {
        env: {
            ...process.env,
            NODE_ENV: 'production',
            ELECTRON_RUN_AS_NODE: '1',
            UI_DIR: app.isPackaged ? path.join(process.resourcesPath, 'ui') : '',
        },
        stdio: 'pipe',
    });

    backendProc.on('error', (e) => console.error('[backend] spawn error:', e));
    backendProc.on('exit', (code, signal) => console.log('[backend] exited', { code, signal }));

    backendProc.stdout.on('data', (d) => console.log('[backend][out]', String(d)));
    backendProc.stderr.on('data', (d) => console.error('[backend][err]', String(d)));
}

function stopBackend({ forceAfterMs = 2000 } = {}) {
    if (!backendProc || backendProc.killed) return Promise.resolve();

    return new Promise((resolve) => {
        const proc = backendProc;

        const done = () => resolve();
        proc.once('exit', done);

        try {
            proc.kill('SIGTERM');
        } catch (e) {
            proc.removeListener('exit', done);
            return resolve();
        }

        setTimeout(() => {
            if (!proc.killed) {
                try { proc.kill('SIGKILL'); } catch {}
            }
        }, forceAfterMs);
    });
}

function waitForServer(url, timeoutMs = 15000) {
    const start = Date.now();

    return new Promise((resolve, reject) => {
        const tick = () => {
            const req = http.get(url, (res) => {
                res.resume?.();
                if (res.statusCode >= 200 && res.statusCode < 300) resolve();
                else {
                    if (Date.now() - start > timeoutMs) {
                        reject(new Error(`Server not ready: ${url} (${res.statusCode})`));
                    } else {
                        setTimeout(tick, 200);
                    }
                }
            });

            req.on('error', () => {
                if (Date.now() - start > timeoutMs) reject(new Error('Server not ready: ' + url));
                else setTimeout(tick, 200);
            });

            req.end();
        };

        tick();
    });
}

async function createWindow() {
    mainWindow = new BrowserWindow({ show: false });

    await mainWindow.loadURL(
        'data:text/html,' +
        encodeURIComponent('<h3 style="font-family:sans-serif">Starting...</h3>')
    );

    mainWindow.maximize();
    mainWindow.show();

    const urlToLoad = DEV_URL || PROD_START_URL;
    console.log('[MAIN] createWindow()', new Date().toISOString(), 'url:', urlToLoad);

    try {
        if (!DEV_URL) {
            await waitForServer(API_HEALTH_URL);
        }

        await mainWindow.loadURL(urlToLoad);
    } catch (e) {
        const msg = (e && e.stack) ? e.stack : String(e);
        console.error('[MAIN] startup failed:', msg);

        await mainWindow.loadURL(
            'data:text/html,' +
            encodeURIComponent(
                `<h3 style="font-family:sans-serif;color:#b00">Startup failed</h3><pre>${msg}</pre>`
            )
        );

        // на время диагностики — открываем DevTools всегда
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    if (OPEN_DEVTOOLS) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}


app.whenReady().then(async () => {
    if (!DEV_URL || START_BACKEND_IN_DEV) startBackend();

    await createWindow();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await createWindow();
        } else if (mainWindow) {
            mainWindow.focus();
        }
    });
});

app.on('window-all-closed', () => {
    console.log('[MAIN] window-all-closed');
});

app.on('before-quit', async (e) => {
    console.log('[MAIN] before-quit');

    if (quitting) return;
    quitting = true;

    e.preventDefault();

    await stopBackend({ forceAfterMs: 2000 });
    app.exit(0);
});
