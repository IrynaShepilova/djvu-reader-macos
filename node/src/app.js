// src/app.js
require('dotenv').config({
    path: process.env.NODE_ENV === 'production'
        ? '.env.production'
        : '.env'
});

// libs
const express = require("express");
const cors = require("cors");
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

// modules
const {
    coversDir,
} = require('./config/paths');
const { readLibrary, writeLibrary } = require('./services/library-store');
const { getScanState, setScanState } = require('./services/scan-state');
const { scanAll, checkFolderAvailability } = require('./services/scanner');
const { ensureSettingsFile, addScanFolder, getScanFolders, removeScanFolder, updateScanFolder, updateScanFolderStatus } = require('./services/settings-store');

const app = express();
const PORT = 3000;

// const scanDirs = [
//     path.join(process.env.HOME, 'Downloads'),
//     path.join(process.env.HOME, 'Books'),
// ];

const upload = multer({ storage: multer.memoryStorage() });

ensureSettingsFile();

function coverKeyFromId(id) {
    return crypto.createHash('sha1').update(id).digest('hex');
}

function getEnabledScanPaths() {
    const folders = getScanFolders();

    return folders
        .filter(f => f.enabled)
        .map(f => f.path);
}


// middlewares
app.use(cors());
app.use(express.json());

// test route
// app.get("/", (req, res) => {
//     res.send("📚 Node backend works!");
// });

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

app.get('/api/scan-folders', (req, res) => {
    res.json(getScanFolders());
});

app.post('/api/scan-folders', (req, res) => {
    const { path } = req.body || {};

    if (!path || typeof path !== 'string') {
        return res.status(400).json({ error: 'path is required' });
    }

    const folder = addScanFolder(path);

    if (!folder) {
        return res.status(409).json({ error: 'Folder already exists' });
    }

    res.json({
        ok: true,
        folder,
    });
});

app.post('/api/scan-folders/check/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);

    const folders = getScanFolders();
    const folder = folders.find(f => f.id === id);

    if (!folder) {
        return res.status(404).json({ error: 'Scan folder not found' });
    }

    const result = checkFolderAvailability(folder.path);

    const updated = updateScanFolderStatus(id, {
        status: result.status,
        errorMessage: result.errorMessage,
        lastCheckedAt: new Date().toISOString(),
    });

    res.json({
        ok: true,
        folder: updated,
    });
});

app.patch('/api/scan-folders/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const { enabled } = req.body || {};

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const updated = updateScanFolder(id, { enabled });

    if (!updated) {
        return res.status(404).json({ error: 'Scan folder not found' });
    }

    res.json({
        ok: true,
        folder: updated,
    });
});

app.delete('/api/scan-folders/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);

    const removed = removeScanFolder(id);

    if (removed === null) {
        return res.status(404).json({ error: 'Scan folder not found' });
    }

    if (removed === false) {
        return res.status(400).json({ error: 'Default folders cannot be removed' });
    }

    res.json({
        ok: true,
        folder: removed,
    });
});

// book route
app.get('/api/books', (req, res) => {
    const items = readLibrary();

    const result = items.map((b) => ({
        ...b,
        url: `/api/books/file/${encodeURIComponent(b.id)}`
    }));

    res.json(result);
});


app.get('/api/books/file/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);

    const items = readLibrary();
    const book = items.find(b => (b.id || b.fullPath) === id);

    if (!book || !book.fullPath) {
        return res.status(404).send('Book not found');
    }

    if (!fs.existsSync(book.fullPath)) {
        return res.status(404).send('File missing on disk');
    }

    res.sendFile(book.fullPath);
});

app.post('/api/books/scan', (req, res) => {
    const scanned = scanAll(getEnabledScanPaths());

    const current = readLibrary();

    const existing = new Set(current.map(b => (b.id || b.fullPath).toLowerCase()));
    const newBooks = scanned.filter(b => !existing.has(b.id.toLowerCase()));

    const merged = [...current, ...newBooks];
    writeLibrary(merged);

    res.json({
        added: newBooks.length,
        total: merged.length,
        newBooks: newBooks.map((b, i) => ({ id: current.length + i + 1, ...b }))
    });
});

app.get('/api/books/scan/status', (req, res) => {
    res.json(getScanState());
});

app.post('/api/books/scan/start', async (req, res) => {
    if (getScanState().running) {
        return res.json({ ok: true, alreadyRunning: true });
    }

    setScanState({
        running: true,
        done: false,
        percent: 0,
        processed: 0,
        total: 0,
        added: 0,
        message: 'Starting…'
    });

    setImmediate(() => runScan());

    res.json({ ok: true });
});

async function runScan() {
    let scanState = getScanState();
    try {
        const scanned = scanAll(getEnabledScanPaths());
        const current = readLibrary();

        const key = (b) => (b.id || b.fullPath).toLowerCase();
        const existing = new Set(current.map(key));

        scanState.total = scanned.length;
        scanState.message = 'Scanning files…';

        const newBooks = [];

        for (let i = 0; i < scanned.length; i++) {
            const b = scanned[i];
            scanState.processed = i + 1;

            if (!existing.has(key(b))) {
                existing.add(key(b));
                newBooks.push(b);
            }

            scanState.percent = scanState.total
                ? Math.round((scanState.processed / scanState.total) * 100)
                : 100;

            if (i % 50 === 0) {
                await new Promise(r => setImmediate(r));
            }
        }

        const merged = [...current, ...newBooks];
        writeLibrary(merged);

        scanState.added = newBooks.length;
        scanState.percent = 100;
        scanState.message = `Done. Added ${newBooks.length}`;
    } catch (e) {
        scanState.message = `Error: ${e?.message || e}`;
    } finally {
        scanState.running = false;
        scanState.done = true;
    }
}

app.post('/api/books/:id/cover', upload.single('cover'), (req, res) => {
    const id = decodeURIComponent(req.params.id); // это fullPath
    const items = readLibrary();
    const book = items.find(b => (b.id || b.fullPath) === id);

    if (!book) return res.status(404).json({ error: 'Book not found' });
    if (!req.file?.buffer) return res.status(400).json({ error: 'No cover file' });

    const coverKey = coverKeyFromId(id);
    const coverPath = path.join(coversDir, `${coverKey}.jpg`);

    fs.writeFileSync(coverPath, req.file.buffer);

    const coverUrl = `/api/covers/${coverKey}.jpg`;
    book.cover = coverUrl;
    writeLibrary(items);

    res.json({ ok: true, coverUrl });
});

app.get('/api/covers/:file', (req, res) => {
    const file = req.params.file;
    const full = path.join(coversDir, file);

    if (!fs.existsSync(full)) return res.status(404).end();

    res.setHeader('Content-Type', 'image/jpeg');
    fs.createReadStream(full).pipe(res);
});

app.patch('/api/books/:id/meta', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const { totalPages, lastOpenedAt } = req.body || {};

    const hasTotalPages = totalPages !== undefined && totalPages !== null;
    const hasLastOpenedAt = lastOpenedAt !== undefined;

    if (!hasTotalPages && !hasLastOpenedAt) {
        return res.status(400).json({ error: 'Nothing to update' });
    }

    let normalizedTotalPages;
    if (hasTotalPages) {
        const t = Number(totalPages);
        if (!Number.isFinite(t) || t < 1) {
            return res.status(400).json({ error: 'totalPages must be a positive number' });
        }
        normalizedTotalPages = Math.floor(t);
    }

    if (
        hasLastOpenedAt &&
        lastOpenedAt !== null &&
        (typeof lastOpenedAt !== 'string' || Number.isNaN(Date.parse(lastOpenedAt)))
    ) {
        return res.status(400).json({ error: 'lastOpenedAt must be a valid ISO date string or null' });
    }

    const items = readLibrary();
    const book = items.find(b => (b.id || b.fullPath) === id);

    if (!book) return res.status(404).json({ error: 'Book not found' });

    if (hasTotalPages) {
        book.totalPages = normalizedTotalPages;
    }

    if (hasLastOpenedAt) {
        book.lastOpenedAt = lastOpenedAt;
    }

    writeLibrary(items);

    res.json({
        ok: true,
        id,
        totalPages: book.totalPages ?? null,
        lastOpenedAt: book.lastOpenedAt ?? null,
    });
});

const uiDir = process.env.UI_DIR;

if (uiDir) {
    const indexHtml = path.join(uiDir, 'index.html');

    if (fs.existsSync(indexHtml)) {
        app.use(express.static(uiDir));

        // SPA fallback (do not catch /api)
        app.use((req, res, next) => {
            if (req.path.startsWith('/api/')) return next();
            res.sendFile(indexHtml);
        });
    } else {
        console.warn('[static] index.html not found:', indexHtml);
    }
} else {
    console.warn('[static] UI_DIR is not set; not serving UI');
}

app.listen(PORT, () => {
    console.log(`🚀 Backend running  on http://localhost:${PORT}`);
});
