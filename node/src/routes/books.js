const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { readLibrary, writeLibrary } = require('../services/library-store');
const { getScanState, setScanState } = require('../services/scan-state');
const { scanAll } = require('../services/scanner');
const { getScanFolders } = require('../services/settings-store');
const { coversDir } = require('../config/paths');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function coverKeyFromId(id) {
    return crypto.createHash('sha1').update(id).digest('hex');
}

function getEnabledScanPaths() {
    return getScanFolders()
        .filter(f => f.enabled)
        .map(f => f.path);
}

router.get('/api/books', (req, res) => {
    const items = readLibrary();

    const result = items.map((b) => ({
        ...b,
        url: `/api/books/file/${encodeURIComponent(b.id)}`
    }));

    res.json(result);
});

router.get('/api/books/file/:id', (req, res) => {
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

router.post('/api/books/scan', (req, res) => {
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

router.get('/api/books/scan/status', (req, res) => {
    res.json(getScanState());
});

router.post('/api/books/scan/start', async (req, res) => {
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

router.post('/api/books/:id/cover', upload.single('cover'), (req, res) => {
    const id = decodeURIComponent(req.params.id);
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

router.get('/api/covers/:file', (req, res) => {
    const file = req.params.file;
    const full = path.join(coversDir, file);

    if (!fs.existsSync(full)) return res.status(404).end();

    res.setHeader('Content-Type', 'image/jpeg');
    fs.createReadStream(full).pipe(res);
});

router.patch('/api/books/:id/meta', (req, res) => {
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

module.exports = router;
