// src/app.js
require('dotenv').config({
    path: process.env.NODE_ENV === 'production'
        ? '.env.production'
        : '.env'
});


const express = require("express");
const cors = require("cors");
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const scanDirs = [
    path.join(process.env.HOME, 'Downloads'),
    path.join(process.env.HOME, 'Books'),
];

let scanState = {
    running: false,
    done: false,
    percent: 0,
    processed: 0,
    total: 0,
    added: 0,
    message: ''
};

const MAX_SCAN_DEPTH = 3;

const libraryFile = resolvePath(process.env.LIBRARY_PATH) || path.join(os.homedir(), '.djvu-reader', 'library.json');
const coversDir = path.join(path.dirname(libraryFile), 'covers');
ensureDirExists(coversDir);

const upload = multer({ storage: multer.memoryStorage() });

function resolvePath(p) {
    if (!p) return p;
    if (p.startsWith('~')) {
        return path.join(os.homedir(), p.slice(1));
    }
    return p;
}

function coverKeyFromId(id) {
    return crypto.createHash('sha1').update(id).digest('hex');
}


// middlewares
app.use(cors());
app.use(express.json());

function ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function readLibrary() {
    try {
        if (!fs.existsSync(libraryFile)) return [];
        const raw = fs.readFileSync(libraryFile, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeLibrary(items) {
    ensureDirExists(path.dirname(libraryFile));
    fs.writeFileSync(libraryFile, JSON.stringify(items, null, 2), 'utf8');
}

function scanAll() {
    return scanDirs.flatMap(dir => scanFolderRecursive(dir, 0));
}

// test route
app.get("/api/health", (req, res) => {
    res.json({ ok: true });
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
    const scanned = scanAll();

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
    res.json(scanState);
});

app.post('/api/books/scan/start', async (req, res) => {
    if (scanState.running) {
        return res.json({ ok: true, alreadyRunning: true });
    }

    scanState = {
        running: true,
        done: false,
        percent: 0,
        processed: 0,
        total: 0,
        added: 0,
        message: 'Starting…'
    };

    setImmediate(() => runScan());

    res.json({ ok: true });
});

async function runScan() {
    try {
        const scanned = scanAll();
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

function scanFolderRecursive(dir, depth = 0) {
    if (depth > MAX_SCAN_DEPTH) return [];
    if (!fs.existsSync(dir)) return [];

    const result = [];
    let entries;

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {

        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isFile() && /\.(djvu|djv)$/i.test(entry.name)) {
            result.push({
                id: fullPath,
                fullPath,
                title: path.parse(entry.name).name,
                filename: entry.name,
            });
        }

        if (entry.isDirectory()) {
            result.push(...scanFolderRecursive(fullPath, depth + 1));
        }
    }

    return result;
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
    const { totalPages } = req.body || {};

    const t = Number(totalPages);
    if (!Number.isFinite(t) || t < 1) {
        return res.status(400).json({ error: 'totalPages must be a positive number' });
    }

    const items = readLibrary();
    const book = items.find(b => (b.id || b.fullPath) === id);

    if (!book) return res.status(404).json({ error: 'Book not found' });

    book.totalPages = Math.floor(t);

    writeLibrary(items);
    res.json({ ok: true, id, totalPages: book.totalPages });
});

// const angularDist = path.join(__dirname, '..','..', 'angular', 'dist','angular', 'browser');
const angularDist = path.join(__dirname, 'public');
const indexHtml = path.join(angularDist, 'index.html');
if (fs.existsSync(indexHtml)) {
    app.use(express.static(angularDist));

    app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(indexHtml);
    });

} else {
    console.warn('[static] index.html not found:', indexHtml);
}

app.listen(PORT, () => {
    console.log(`🚀 Backend running  on http://localhost:${PORT}`);
});
