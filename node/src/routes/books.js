const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { readLibrary, writeLibrary } = require('../services/library-store');
const { getScanState, setScanState } = require('../services/scan-state');
const { scanAll, scanAllAsync } = require('../services/scanner');
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

function isBookInEnabledFolder(book, enabledPaths) {
    if (!book?.fullPath) return false;

    return enabledPaths.some(folderPath => {
        const normalizedFolder = path.resolve(folderPath);
        const normalizedBook = path.resolve(book.fullPath);

        return normalizedBook === normalizedFolder
            || normalizedBook.startsWith(normalizedFolder + path.sep);
    });
}

router.get('/api/books', (req, res) => {
    const enabledPaths = getEnabledScanPaths();

    const items = readLibrary()
        .filter(book => !book.invalid)
        .filter(book => isBookInEnabledFolder(book, enabledPaths));

    const result = items.map((b) => ({
        ...b,
        url: `/api/books/file/${encodeURIComponent(b.id)}`
    }));

    res.json(result);
});

router.get('/api/books/file/:id', (req, res) => {
    const id = req.params.id;

    const items = readLibrary();
    const book = items.find(b => b.id === id);

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

router.post('/api/books/:id/invalid', (req, res) => {
    const id = req.params.id;

    const items = readLibrary();
    const book = items.find(b => (b.id || b.fullPath) === id);

    if (!book) {
        return res.status(404).json({ error: 'Book not found' });
    }

    book.invalid = true;
    writeLibrary(items);

    res.json({
        ok: true,
        id,
        invalid: true,
    });
});

async function runScan() {
    let scanState = getScanState();

    try {
        const scanned = await scanAllAsync(getEnabledScanPaths(), {
            onProgress: ({ scannedEntries, foundBooks, currentPath }) => {
                const state = getScanState();

                setScanState({
                    ...state,
                    processed: scannedEntries,
                    total: 0,
                    percent: 0,
                    added: foundBooks,
                    message: currentPath
                        ? `Scanning… ${currentPath}`
                        : `Scanning… found ${foundBooks} books`,
                });
            },
        });

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

        const state = getScanState();

        setScanState({
            ...state,
            added: newBooks.length,
            percent: 100,
            processed: scanned.length,
            total: scanned.length,
            message: `Done. Added ${newBooks.length}`,
        });
    } catch (e) {
        scanState.message = `Error: ${e?.message || e}`;
    } finally {
        const state = getScanState();

        setScanState({
            ...state,
            running: false,
            done: true,
        });
    }
}

router.post('/api/books/:id/cover', upload.single('cover'), (req, res) => {
    const id = req.params.id;
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
    const id = req.params.id;

    let patch;

    try {
        patch = normalizeBookMetaPatch(req.body);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'Nothing to update' });
    }

    const items = readLibrary();
    const book = items.find(b => b.id === id);

    if (!book) return res.status(404).json({ error: 'Book not found' });

    Object.assign(book, patch);

    writeLibrary(items);

    res.json({
        ok: true,
        book,
    });
});

function normalizeBookMetaPatch(body = {}) {
    const patch = {};

    if (body.totalPages !== undefined && body.totalPages !== null) {
        const totalPages = Number(body.totalPages);

        if (!Number.isFinite(totalPages) || totalPages < 1) {
            throw new Error('totalPages must be a positive number');
        }

        patch.totalPages = Math.floor(totalPages);
    }

    if (body.lastOpenedAt !== undefined) {
        if (
            body.lastOpenedAt !== null &&
            (typeof body.lastOpenedAt !== 'string' || Number.isNaN(Date.parse(body.lastOpenedAt)))
        ) {
            throw new Error('lastOpenedAt must be a valid ISO date string or null');
        }

        patch.lastOpenedAt = body.lastOpenedAt;
    }

    if (body.favorite !== undefined) {
        if (typeof body.favorite !== 'boolean') {
            throw new Error('favorite must be a boolean');
        }

        patch.favorite = body.favorite;
    }

    return patch;
}

function markBookInvalid(id) {
    const items = readLibrary();
    const next = items.map(b =>
        b.id === id ? { ...b, invalid: true } : b
    );
    writeLibrary(next);
}

module.exports = router;
